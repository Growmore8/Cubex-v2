const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const Redis = require("ioredis");
const WebSocket = require("ws");
const { PrismaClient } = require("@prisma/client");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());
const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

const jwt = require("jsonwebtoken");
const webpush = require("web-push");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "";
let FINNHUB_KEY = process.env.FINNHUB_KEY || "";

// ── Realtime presence: derive identity from the session cookie on every socket
// (all sockets a tab opens carry it). When the LAST socket for a client stays
// gone past a short grace window we treat it as a real logout — works even when
// the app is killed / network drops and the pagehide beacon never fires.
const PRESENCE_GRACE_MS = 20000;
const presence = new Map(); // userId -> { count, info, offTimer }
function cookieVal(raw, name) {
  if (!raw) return null;
  for (const part of String(raw).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function sessionFromSocket(socket) {
  try {
    const token = cookieVal(socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie, "cubex_session");
    if (!token || !JWT_SECRET) return null;
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (e) { return null; }
}
async function presenceMarkOnline(info) {
  await prisma.user.update({ where: { id: info.sub }, data: { lastSeenAt: new Date() } }).catch(() => {});
}
async function presenceMarkOffline(info) {
  try {
    // Flip the online dot off immediately by back-dating lastSeenAt past the window.
    await prisma.user.update({ where: { id: info.sub }, data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) } }).catch(() => {});
    if (info.role === "MANAGER") {
      // Manager closed the terminal -> tenant admins + superadmins (no managerId).
      await prisma.auditLog.create({
        data: { tenantId: info.tenantId, action: "auth.disconnect", detail: `MANAGER "${info.name}" went offline (terminal closed)`, performedBy: info.email || info.name || "manager", category: "MANAGER" },
      }).catch(() => {});
      await notifyStaffRaw(info.tenantId, { title: "Manager offline", body: `${info.name} closed the terminal`, type: "LOGIN" }, null);
    } else {
      // Client closed the app -> tenant admins + owning manager + superadmins.
      const acc = await prisma.account.findFirst({ where: { tenantId: info.tenantId, userId: info.sub }, select: { login: true, managerId: true } });
      await prisma.auditLog.create({
        data: { tenantId: info.tenantId, action: "auth.disconnect", detail: `CLIENT "${info.name}" (${acc && acc.login || ""}) went offline (app / tab closed)`, performedBy: info.email || info.name || "client", category: "CLIENT" },
      }).catch(() => {});
      await notifyStaffRaw(info.tenantId, { title: "Client offline", body: `${info.name} (${acc && acc.login || ""}) closed the app`, type: "LOGIN" }, acc && acc.managerId);
    }
    if (global.__io) global.__io.emit("refresh", {});
  } catch (e) { console.error("[presenceMarkOffline]", e); }
}
function presenceConnect(socket, info) {
  socket.data = socket.data || {};
  socket.data.presenceUid = info.sub;
  const p = presence.get(info.sub);
  if (p) { p.count++; if (p.offTimer) { clearTimeout(p.offTimer); p.offTimer = null; } }
  else { presence.set(info.sub, { count: 1, info }); }
  presenceMarkOnline(info);
}
function presenceDisconnect(socket) {
  const uid = socket.data && socket.data.presenceUid;
  if (!uid) return;
  const p = presence.get(uid);
  if (!p) return;
  p.count--;
  if (p.count > 0) return;
  // Last socket gone — wait out the grace window (covers reloads / brief drops).
  p.offTimer = setTimeout(() => { presence.delete(uid); presenceMarkOffline(p.info); }, PRESENCE_GRACE_MS);
}
let TD_KEY = process.env.TWELVEDATA_KEY || process.env.TD_API_KEY || process.env.TD_KEY || "";
let MASSIVE_KEY = process.env.MASSIVE_KEY || "";
// ── Per-category feed selection ──
// Each asset class can use a different WebSocket provider independently.
let CRYPTO_FEED = "BN";   // BN | KR | TD | FH | MV
let FOREX_FEED  = "TD";   // KR | TD | MV | FH
let COMM_FEED   = "TD";   // KR | TD | MV  (commodities = metals + energy)
let IDX_FEED    = "TD";   // TD | FH  (indices)
let STOCK_FEED  = "TD";   // TD | FH  (US + Indian stocks via TwelveData paid)
// TD is always the intended primary. FH/MV are secondary fallbacks only.
// When TD fails → switch to FH. Background probe tests TD every 2 min → auto-return when TD recovers.
let PRIMARY = "TD";
let manualPrimaryOverride = null; // set by SuperAdmin card click
let primaryFailCount = 0;
let tdRecoveryTimer = null; // background probe: tests TD WebSocket, returns when healthy
const PRIMARY_FAIL_THRESHOLD = 10;
global.__PRIMARY = PRIMARY;
function setPrimary(feed) { PRIMARY = feed; global.__PRIMARY = feed; }
function recordFeedSuccess(feed) { if (feed === PRIMARY) { primaryFailCount = 0; } }

// Persist an error event to DB and emit via socket
function logFeedError(category, provider, errorType, message) {
  console.error(`[${provider}][${category}] ${errorType}: ${message}`);
  prisma.feedErrorLog.create({ data: { category, provider, errorType, message } }).catch(() => {});
  if (global.__io) global.__io.emit("feed-error", { category, provider, errorType, message, ts: Date.now() });
}

// Background probe: try a TD WebSocket handshake. If it succeeds → TD is back → restore it as primary.
function startTdRecoveryProbe() {
  if (tdRecoveryTimer) return; // already probing
  if (!TD_KEY) return;
  console.log("[TD] starting recovery probe every 2min...");
  tdRecoveryTimer = setInterval(() => {
    if (PRIMARY === "TD") { clearInterval(tdRecoveryTimer); tdRecoveryTimer = null; return; } // already recovered
    const ws = new (require("ws"))("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + TD_KEY);
    let resolved = false;
    const done = (ok) => { if (resolved) return; resolved = true; try { ws.removeAllListeners(); ws.terminate(); } catch {} if (ok) {
      console.log("[TD] recovery probe succeeded → restoring TD as primary");
      clearInterval(tdRecoveryTimer); tdRecoveryTimer = null;
      const prev = PRIMARY; setPrimary("TD"); primaryFailCount = 0; tdWsFail200 = 0;
      prisma.feedFailoverLog.create({ data: { fromFeed: prev, toFeed: "TD", reason: "TD recovered — auto-restored from recovery probe" } }).catch(() => {});
      if (global.__io) global.__io.emit("feed-failover", { from: prev, to: "TD", ts: Date.now() });
      connectTD(); // reconnect TD WebSocket
    }};
    const t = setTimeout(() => done(false), 8000);
    ws.on("open", () => { clearTimeout(t); done(true); });
    ws.on("error", () => { clearTimeout(t); done(false); });
  }, 2 * 60 * 1000); // probe every 2 minutes
}

function recordFeedFailure(feed) {
  if (feed !== PRIMARY) return;
  primaryFailCount++;
  const threshold = manualPrimaryOverride ? 30 : PRIMARY_FAIL_THRESHOLD;
  if (primaryFailCount >= threshold) {
    // Always prefer FH as fallback; fall back to MV if no FH key
    const next = FINNHUB_KEY ? "FH" : (MASSIVE_KEY ? "MV" : PRIMARY);
    if (next === PRIMARY) { primaryFailCount = 0; return; }
    const prev = PRIMARY;
    const reason = `${prev} failed ${primaryFailCount}x → switching to ${next} (will auto-restore when ${prev} recovers)`;
    console.warn("[feed] AUTO-FAILOVER:", reason);
    setPrimary(next); primaryFailCount = 0;
    prisma.feedFailoverLog.create({ data: { fromFeed: prev, toFeed: next, reason } }).catch(() => {});
    if (global.__io) global.__io.emit("feed-failover", { from: prev, to: next, ts: Date.now() });
    // If TD was primary → start background probe to auto-restore when TD comes back
    if (prev === "TD") startTdRecoveryProbe();
  }
}

// Determine which category a symbol belongs to (for per-category feed routing)
// Uses catalog meta first (accurate for any symbol), falls back to heuristics.
const INDEX_SYM_SET  = new Set(["US500","US30","US100","GER40","UK100","JP225","HK50","FRA40"]);
const ENERGY_SYM_SET = new Set(["USOIL","UKOIL","NATGAS"]);
function getSymCategory(sym) {
  if (meta[sym] && meta[sym].cat) return meta[sym].cat; // catalog is authoritative
  if (INDEX_SYM_SET.has(sym))  return "indices";
  if (ENERGY_SYM_SET.has(sym)) return "commodities";
  if (/^(XAU|XAG|XPT|XPD|GAU|XAGG)/.test(sym)) return "commodities";
  return "forex";
}
function getCatFeed(cat) {
  if (cat === "crypto")      return CRYPTO_FEED;
  if (cat === "indices")     return IDX_FEED;
  if (cat === "stocks")      return STOCK_FEED;
  if (cat === "commodities") return COMM_FEED;
  return FOREX_FEED;
}
// Price display mode:
//   DEFAULT (smoothed)  — the real feed sets each symbol's TARGET; the display
//     crawls toward it one pip at a time (4100.31 -> .32 -> .33) and jitters the
//     last digit when caught up, so movement is smooth/fast AND the level tracks
//     the real market. Best UX (market watch, chart, P&L all move every pip).
//   EXACT (REALTIME_EXACT=1) — snap to each real tick and hold between them, so
//     candles are byte-exact to the feed but movement looks "steppy/slow".
let REAL_EXACT = process.env.REALTIME_EXACT === "1";
const REAL_TTL = 20000; // a fed symbol holds its real price for this long before synthetic fallback
function recomputeExact() { REAL_EXACT = process.env.REALTIME_EXACT === "1"; }
// Load feed keys + primary from the DB (SuperAdmin UI). DB overrides env.
async function loadFeedConfig() {
  try {
    const rec = await prisma.setting.findUnique({ where: { key: "feeds" } });
    const v = (rec && rec.value) || {};
    if (typeof v.tdKey === "string" && v.tdKey.trim()) TD_KEY = v.tdKey.trim();
    if (typeof v.finnhubKey === "string" && v.finnhubKey.trim()) FINNHUB_KEY = v.finnhubKey.trim();
    if (typeof v.massiveKey === "string" && v.massiveKey.trim()) MASSIVE_KEY = v.massiveKey.trim();
    if (["BN","KR","TD","FH","MV"].includes(v.cryptoFeed)) CRYPTO_FEED = v.cryptoFeed;
    if (["KR","TD","MV","FH"].includes(v.forexFeed))       FOREX_FEED  = v.forexFeed;
    if (["KR","TD","MV"].includes(v.commFeed))              COMM_FEED   = v.commFeed;
    if (["TD","FH"].includes(v.idxFeed))                IDX_FEED    = v.idxFeed;
    if (["FH","TD"].includes(v.stockFeed))              STOCK_FEED  = v.stockFeed;
    // Manual primary override (saved by SuperAdmin) or auto-pick best available
    if (["TD","FH","MV","BN","KR"].includes(v.manualPrimary)) {
      manualPrimaryOverride = v.manualPrimary;
      setPrimary(v.manualPrimary);
      primaryFailCount = 0;
    } else {
      manualPrimaryOverride = null;
      // TD is always preferred primary — FH/MV are secondary only
      setPrimary(TD_KEY ? "TD" : (FINNHUB_KEY ? "FH" : PRIMARY));
    }
  } catch (e) { console.error("[feed] config load failed:", e.message); }
  recomputeExact();
  console.log("[feed] config:", { td: !!TD_KEY, fh: !!FINNHUB_KEY, mv: !!MASSIVE_KEY, crypto: CRYPTO_FEED, forex: FOREX_FEED, comm: COMM_FEED, idx: IDX_FEED });
}
// Tear down and re-open all feed sockets with current keys (after a config change).
function reconnectFeeds() {
  for (const ws of [tdWs, fhWs, mvWs, mvCryptoWs, bnWs, krWs]) {
    try { if (ws) { ws.removeAllListeners(); ws.close(); } } catch (e) {}
  }
  tdWs = null; fhWs = null; mvWs = null; mvCryptoWs = null; bnWs = null; krWs = null;
  connectFinnhub();
  connectTD();
  connectBinance();
  connectKraken();
  if (MASSIVE_KEY) { connectMassive(); connectMassiveCrypto(); }
}

const CANDLE_MS = 5000, HISTORY = 100, MONITOR_MS = 3000;
const state = {}, meta = {}, feedToSym = {}, tdToSym = {}, fhLast = {};
let symbols = [];

function r(v, d) { return Number(v.toFixed(d)); }
function bucketStart(ms) { return Math.floor(ms / CANDLE_MS) * CANDLE_MS; }

// Short, per-tenant sequential trade ticket (matches src/services/trade.service.ts).
async function nextTicket(tenantId) {
  const c = await prisma.counter.upsert({
    where: { tenantId_name: { tenantId, name: "ticket" } },
    create: { tenantId, name: "ticket", nextVal: 1000001n },
    update: { nextVal: { increment: 1 } },
  });
  return c.nextVal;
}

// ── Derived (calculated) symbols: metal crosses + grams ──
// Computed from base XAU/XAG + FX rates on each base tick. 1 troy oz = 31.1035 g.
const OZ = 31.1035;
const DERIVED = {
  XAUEUR: { d: ["XAUUSD", "EURUSD"], f: (g) => g.XAUUSD / g.EURUSD },
  XAUGBP: { d: ["XAUUSD", "GBPUSD"], f: (g) => g.XAUUSD / g.GBPUSD },
  XAUAUD: { d: ["XAUUSD", "AUDUSD"], f: (g) => g.XAUUSD / g.AUDUSD },
  XAUNZD: { d: ["XAUUSD", "NZDUSD"], f: (g) => g.XAUUSD / g.NZDUSD },
  XAUJPY: { d: ["XAUUSD", "USDJPY"], f: (g) => g.XAUUSD * g.USDJPY },
  XAUCAD: { d: ["XAUUSD", "USDCAD"], f: (g) => g.XAUUSD * g.USDCAD },
  XAUCHF: { d: ["XAUUSD", "USDCHF"], f: (g) => g.XAUUSD * g.USDCHF },
  XAUHKD: { d: ["XAUUSD", "USDHKD"], f: (g) => g.XAUUSD * g.USDHKD },
  XAUSGD: { d: ["XAUUSD", "USDSGD"], f: (g) => g.XAUUSD * g.USDSGD },
  XAUXAG: { d: ["XAUUSD", "XAGUSD"], f: (g) => g.XAUUSD / g.XAGUSD },
  XAGAUD: { d: ["XAGUSD", "AUDUSD"], f: (g) => g.XAGUSD / g.AUDUSD },
  XAGCAD: { d: ["XAGUSD", "USDCAD"], f: (g) => g.XAGUSD * g.USDCAD },
  XAGCHF: { d: ["XAGUSD", "USDCHF"], f: (g) => g.XAGUSD * g.USDCHF },
  XAGEUR: { d: ["XAGUSD", "EURUSD"], f: (g) => g.XAGUSD / g.EURUSD },
  XAGGBP: { d: ["XAGUSD", "GBPUSD"], f: (g) => g.XAGUSD / g.GBPUSD },
  XAGTRY: { d: ["XAGUSD", "USDTRY"], f: (g) => g.XAGUSD * g.USDTRY },
  GAUUSD: { d: ["XAUUSD"], f: (g) => g.XAUUSD / OZ },
  GAUEUR: { d: ["XAUUSD", "EURUSD"], f: (g) => (g.XAUUSD / g.EURUSD) / OZ },
  GAUGBP: { d: ["XAUUSD", "GBPUSD"], f: (g) => (g.XAUUSD / g.GBPUSD) / OZ },
  GAUIDR: { d: ["XAUUSD", "USDIDR"], f: (g) => (g.XAUUSD * g.USDIDR) / OZ },
  GAUTRY: { d: ["XAUUSD", "USDTRY"], f: (g) => (g.XAUUSD * g.USDTRY) / OZ },
  XAGGUSD: { d: ["XAGUSD"], f: (g) => g.XAGUSD / OZ },
  XAGGEUR: { d: ["XAGUSD", "EURUSD"], f: (g) => (g.XAGUSD / g.EURUSD) / OZ },
  XAGGTRY: { d: ["XAGUSD", "USDTRY"], f: (g) => (g.XAGUSD * g.USDTRY) / OZ },
};
const DERIVED_SET = new Set(Object.keys(DERIVED));
const derivedByDep = {};
for (const ds in DERIVED) for (const dep of DERIVED[ds].d) (derivedByDep[dep] = derivedByDep[dep] || []).push(ds);

// A derived symbol's computed value becomes its TARGET; microTick walks the
// displayed price toward it one point at a time, just like base symbols, so
// metal crosses / grams crawl smoothly instead of snapping to each recompute.
function applyDerived(sym, price) {
  const st = state[sym]; if (!st || !price || !isFinite(price) || price <= 0) return;
  const p = r(price, (meta[sym] && meta[sym].digits) || 2);
  st.target = p;
  if (st.price == null) commitPrice(sym, p); // first value: show at once
}
function recomputeDerived(base) {
  const list = derivedByDep[base]; if (!list) return;
  const g = {}; for (const k in state) g[k] = state[k].price;
  // Build an ask-price map: use exchange ask where available, else fall back to bid price.
  // This lets derived-pair formulas produce a real derived ask so clients see a live spread.
  const gAsk = {}; for (const k in state) gAsk[k] = state[k].ask ?? state[k].price;
  for (const ds of list) {
    if (!state[ds]) continue; // only if present in catalog
    const def = DERIVED[ds];
    if (def.d.some((dep) => g[dep] == null)) continue;
    try {
      const bidPrice = def.f(g);
      applyDerived(ds, bidPrice);
      const digs = (meta[ds] && meta[ds].digits) || 2;
      // In MT5 model price = bid. Set state.bid so trade execution and Redis have it.
      state[ds].bid = r(bidPrice, digs);
      // Propagate ask to derived symbol so commitPrice emits real=ask for live spread.
      if (def.d.every((dep) => gAsk[dep] != null)) {
        const da = def.f(gAsk);
        if (da && isFinite(da) && da > 0) {
          state[ds].ask = r(da, digs);
          state[ds].realAt = Date.now();
        }
      }
    } catch (e) {}
  }
}
function contractFor(cat, sym) {
  if (sym === "XAGUSD") return 5000;
  if (cat === "metals") return 100;
  if (cat === "crypto") return 1;
  if (cat === "stocks" || cat === "indices") return 1;
  if (cat === "energy") return 100;
  return 100000;
}
const TD_INDEX_MAP = { US500: "SPX", US30: "DJI", US100: "IXIC", GER40: "DAX", UK100: "FTSE", JP225: "NI225", HK50: "HSI", FRA40: "CAC" };
const TD_ENERGY_MAP = { USOIL: "WTI/USD", UKOIL: "BCO/USD", NATGAS: "NATGAS/USD" };
function toTD(sym, cat) {
  if (cat === "crypto" || sym.endsWith("USDT")) return sym.replace(/USDT?$/, "") + "/USD";
  if (cat === "indices" && TD_INDEX_MAP[sym]) return TD_INDEX_MAP[sym];
  if (cat === "energy" && TD_ENERGY_MAP[sym]) return TD_ENERGY_MAP[sym];
  if (sym.length === 6 || /^(XAU|XAG|XPT|XPD)/.test(sym)) return sym.slice(0, 3) + "/" + sym.slice(3);
  return sym;
}
// Finnhub feed symbol (fallback feed): forex via OANDA, crypto via BINANCE, metals via OANDA, stocks plain.
function toFinnhub(sym, cat) {
  const s = sym.toUpperCase();
  if (cat === "crypto" || s.endsWith("USDT")) return "BINANCE:" + s.replace(/USDT$/, "").replace(/USD$/, "") + "USDT";
  if (/^(XAU|XAG|XPT|XPD)/.test(s) && s.length === 6) return "OANDA:" + s.slice(0, 3) + "_" + s.slice(3);
  if (cat === "forex" && s.length === 6) return "OANDA:" + s.slice(0, 3) + "_" + s.slice(3);
  if (cat === "stocks") return s;
  return null; // indices/derived: no Finnhub feed
}

async function loadCatalog() {
  // Load ALL symbols (not just enabled) so prices stream to Redis regardless.
  // The enabled flag only controls market-watch visibility — it must not cut off
  // the external prices API that tenants like Growth Capital depend on.
  const rows = await prisma.globalSymbol.findMany({});
  symbols = rows.map((x) => x.symbol);
  for (const x of rows) {
    // Finnhub feed — use stored override (e.g. "NSE:RELIANCE") or auto-derive
    const fh = x.feed || (DERIVED_SET.has(x.symbol) ? null : toFinnhub(x.symbol, x.category));
    // TwelveData feed — if Finnhub feed has BSE:/NSE: prefix, convert for TD:
    //   "NSE:RELIANCE" → "RELIANCE:NSE"  |  "BSE:TCS" → "TCS:BSE"
    let td;
    if (x.feed && /^(NSE|BSE):/.test(x.feed)) {
      const [exch, sym] = x.feed.split(":");
      td = sym + ":" + exch;
    } else {
      td = toTD(x.symbol, x.category);
    }
    meta[x.symbol] = { digits: x.digits || 5, contract: contractFor(x.category, x.symbol), feed: fh, td, cat: x.category, enabled: x.enabled !== false };
    state[x.symbol] = { price: null, bid: null, ask: null, candles: [], bucket: 0 };
    if (fh) feedToSym[fh] = x.symbol;
    tdToSym[td] = x.symbol;
  }
  console.log("[feed] catalog loaded:", symbols.length, "symbols");
}

// Real-feed entry point. Instead of snapping the display straight to the true
// price (which makes the last digits jump by several points at once), we record
// the true price as a TARGET. microTick() then walks the displayed price toward
// it one point at a time, so every symbol's last decimal crawls smoothly.
function applyPrice(sym, price, source) {
  if (!state[sym] || !price || isNaN(price) || price <= 0) return;
  if (DERIVED_SET.has(sym)) return;
  // Per-category feed routing: preferred feed for this symbol's category wins.
  // Any other source is accepted only when the preferred feed has been silent >12s.
  const cat = getSymCategory(sym);
  const preferred = getCatFeed(cat);
  const src = source === "FH-Q" ? "FH" : source; // normalize
  const pk = "__prim_" + sym;
  if (src !== preferred) {
    if (fhLast[pk] && Date.now() - fhLast[pk] < 12000) return; // preferred feed still active
  } else {
    fhLast[pk] = Date.now();
  }
  const d = meta[sym].digits, p = r(price, d), st = state[sym];
  st.target = p;
  st.realAt = Date.now();
  // Disabled symbols: write price directly to Redis (for external API) but skip
  // the smooth display walk and socket.io emit — no market watch client needs ticks for them.
  if (!meta[sym].enabled) { st.price = p; redis.set("price:" + sym, String(p)); return; }
  if (REAL_EXACT) commitPrice(sym, p);
  else if (st.price == null) commitPrice(sym, p);
}

// Commit an actual DISPLAY price: update the forming candle, cache it, broadcast
// the tick, and recompute any derived symbols that depend on this one.
function commitPrice(sym, p) {
  const st = state[sym]; if (!st) return;
  const now = Date.now(), b = bucketStart(now);
  let candle = st.candles[st.candles.length - 1];
  if (!candle || b !== st.bucket) {
    candle = { time: Math.floor(b / 1000), open: p, high: p, low: p, close: p };
    st.candles.push(candle); if (st.candles.length > HISTORY) st.candles.shift(); st.bucket = b;
  } else { candle.high = Math.max(candle.high, p); candle.low = Math.min(candle.low, p); candle.close = p; }
  st.price = p;
  redis.set("price:" + sym, String(p));
  if (st.bid != null) { redis.set("bid:" + sym, String(st.bid)); realBids[sym] = st.bid; }
  if (st.ask != null) { redis.set("ask:" + sym, String(st.ask)); } // real exchange ask for trade execution
  // MT5 model: `price` is the smoothed BID (primary chart price).
  // `real` carries the exchange ASK so clients can compute the live spread (ask − bid).
  // Falls back to null when no live feed data within REAL_TTL.
  // For derived symbols st.bid is never set by a feed — in MT5 model price IS bid, so fall back to p.
  const emitBid = st.bid ?? p;
  // real = exchange ASK. Only emit when within TTL and spread is positive vs the actual bid
  // (not vs the smoothed display price p, which can wander slightly above the real bid
  // and make real - p negative, falsely suppressing the spread).
  const rawReal = (st.realAt && Date.now() - st.realAt < REAL_TTL && st.ask != null) ? st.ask : null;
  const real = (rawReal != null && rawReal > emitBid) ? rawReal : null;
  if (global.__io) global.__io.emit("tick", { symbol: sym, price: p, bid: emitBid, real, candle });
  recomputeDerived(sym);
}

let fhWs = null;
function connectFinnhub() {
  if (!FINNHUB_KEY) { console.log("[FH] no key"); return; }
  fhWs = new WebSocket("wss://ws.finnhub.io?token=" + FINNHUB_KEY);
  fhWs.on("open", () => { let n = 0; for (const s of symbols) { const f = meta[s].feed; if (!f) continue; try { fhWs.send(JSON.stringify({ type: "subscribe", symbol: f })); n++; } catch (e) {} } console.log("[FH] connected, subscribed", n); });
  fhWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.type === "trade" && m.data) for (const tk of m.data) { const s = feedToSym[tk.s]; if (s) applyPrice(s, parseFloat(tk.p), "FH"); } } catch (e) {} });
  fhWs.on("close", () => { setTimeout(connectFinnhub, 5000); });
  fhWs.on("error", (e) => { logFeedError("system", "FH", "WS_ERROR", e.message); });
}
// Finnhub Quote endpoint — real current price (c) for each Finnhub-fed symbol.
// Seeds the live price on boot and acts as a fallback between WebSocket trades.
async function pollFinnhubQuotes() {
  if (!FINNHUB_KEY) return;
  const fed = symbols.filter((s) => meta[s] && meta[s].feed);
  for (const s of fed) {
    try {
      const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(meta[s].feed) + "&token=" + FINNHUB_KEY);
      const d = await r.json();
      if (d && typeof d.c === "number" && d.c > 0) applyPrice(s, d.c, "FH-Q");
    } catch (e) { /* ignore per-symbol quote errors */ }
  }
}

// ── Binance WebSocket — free real bid/ask for crypto (no API key needed) ──
// Built dynamically from the catalog so any crypto symbol added in SuperAdmin
// is automatically subscribed — no server.js edit required.
let BN_SYM = {};    // BTCUSD → "btcusdt"
let BN_TO_SYM = {}; // "BTCUSDT" → "BTCUSD"
function buildBinanceMaps() {
  BN_SYM = {}; BN_TO_SYM = {};
  for (const sym of symbols) {
    if (!meta[sym] || meta[sym].cat !== "crypto") continue;
    // BTCUSD → btcusdt  |  BTCUSDT → btcusdt (pass-through)
    let ticker = null;
    if (sym.endsWith("USDT")) ticker = sym.toLowerCase();
    else if (sym.endsWith("USD")) ticker = sym.slice(0, -3).toLowerCase() + "usdt";
    if (!ticker) continue;
    BN_SYM[sym] = ticker;
    BN_TO_SYM[ticker.toUpperCase()] = sym;
  }
}
let bnWs = null;
function connectBinance() {
  buildBinanceMaps();
  if (Object.keys(BN_SYM).length === 0) { console.log("[BN] no crypto symbols in catalog"); return; }
  const streams = Object.values(BN_SYM).map((s) => s + "@bookTicker").join("/");
  bnWs = new WebSocket("wss://stream.binance.com:9443/stream?streams=" + streams);
  bnWs.on("open", () => console.log("[BN] connected, book ticker:", Object.keys(BN_SYM).join(",")));
  bnWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      const d = msg.data || msg; // combined stream wraps payload in .data
      if (!d.s || !d.b || !d.a) return;
      const sym = BN_TO_SYM[d.s.toUpperCase()];
      if (!sym || !state[sym]) return;
      const bid = parseFloat(d.b), ask = parseFloat(d.a);
      if (bid > 0 && ask > 0 && ask > bid) {
        // Store RAW unrounded bid/ask so commitPrice comparison (rawReal > emitBid) works
        // for small-value tokens (e.g. STRKUSD $0.01) where rounding to digits=2 would
        // collapse both values to the same number and suppress the real ask.
        state[sym].bid = bid;
        state[sym].ask = ask;
        state[sym].realAt = Date.now(); // required for commitPrice to emit real=ask (live spread)
        applyPrice(sym, bid, "BN"); // price only accepted when BN preferred (MV guard inside)
      }
    } catch (e) {}
  });
  bnWs.on("close", () => setTimeout(connectBinance, 5000));
  bnWs.on("error", (e) => console.error("[BN]", e.message));
}

// ── Kraken WebSocket — free real bid/ask for forex + metals + crypto ──
// Docs: https://docs.kraken.com/websockets/
// Endpoint: wss://ws.kraken.com  (no auth required)
// Spread message: [channelID, [bid, ask, ts, bidSize, askSize], "spread", "EUR/USD"]
const KR_PAIR_TO_SYM = {
  "EUR/USD":"EURUSD","GBP/USD":"GBPUSD","AUD/USD":"AUDUSD","NZD/USD":"NZDUSD",
  "USD/CAD":"USDCAD","USD/CHF":"USDCHF","USD/JPY":"USDJPY","EUR/GBP":"EURGBP",
  "EUR/JPY":"EURJPY","EUR/CAD":"EURCAD","EUR/CHF":"EURCHF","GBP/JPY":"GBPJPY",
  "GBP/CHF":"GBPCHF","AUD/JPY":"AUDJPY","AUD/NZD":"AUDNZD","AUD/CAD":"AUDCAD",
  "NZD/JPY":"NZDJPY","USD/HKD":"USDHKD","USD/SGD":"USDSGD","USD/TRY":"USDTRY",
  "USD/MXN":"USDMXN","GBP/AUD":"GBPAUD","GBP/CAD":"GBPCAD","GBP/NZD":"GBPNZD",
  "EUR/NZD":"EURNZD","EUR/AUD":"EURAUD","CAD/CHF":"CADCHF","CAD/JPY":"CADJPY",
  "CHF/JPY":"CHFJPY","NZD/CAD":"NZDCAD","NZD/CHF":"NZDCHF",
  // Metals
  "XAU/USD":"XAUUSD","XAG/USD":"XAGUSD",
  // Crypto (Kraken uses XBT for Bitcoin)
  "XBT/USD":"BTCUSD","ETH/USD":"ETHUSD","SOL/USD":"SOLUSD","XRP/USD":"XRPUSD",
  "ADA/USD":"ADAUSD","DOT/USD":"DOTUSD","LINK/USD":"LINKUSD","AVAX/USD":"AVAXUSD",
  "LTC/USD":"LTCUSD","DOGE/USD":"DOGEUSD",
};
const KR_FOREX_PAIRS  = ["EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/CAD","USD/CHF","USD/JPY","EUR/GBP","EUR/JPY","EUR/CAD","EUR/CHF","GBP/JPY","GBP/CHF","AUD/JPY","AUD/NZD","AUD/CAD","NZD/JPY","USD/HKD","USD/SGD","USD/TRY","USD/MXN","GBP/AUD","GBP/CAD","GBP/NZD","EUR/NZD","EUR/AUD","CAD/CHF","CAD/JPY","CHF/JPY","NZD/CAD","NZD/CHF"];
const KR_METAL_PAIRS  = ["XAU/USD","XAG/USD"];
const KR_CRYPTO_PAIRS = ["XBT/USD","ETH/USD","SOL/USD","XRP/USD","ADA/USD","DOT/USD","LINK/USD","AVAX/USD","LTC/USD","DOGE/USD"];
let krWs = null;
let krPingTimer = null;
function connectKraken() {
  // Kraken runs as a FREE supplemental bid/ask source even when not the assigned primary feed.
  // Rule: skip only when Massive is already covering the same category (Massive is better/paid).
  // Binance is always better for crypto so skip KR crypto when BN or MV is the crypto feed.
  const needsForex  = FOREX_FEED  !== "MV";
  const needsMetals = COMM_FEED   !== "MV";
  const needsCrypto = CRYPTO_FEED !== "BN" && CRYPTO_FEED !== "MV";
  if (!needsForex && !needsMetals && !needsCrypto) {
    console.log("[KR] not needed — Massive/Binance covers all Kraken categories");
    return;
  }
  if (krWs) { try { krWs.removeAllListeners(); krWs.terminate(); } catch (_) {} krWs = null; }
  if (krPingTimer) { clearInterval(krPingTimer); krPingTimer = null; }
  krWs = new WebSocket("wss://ws.kraken.com");
  krWs.on("open", () => {
    const pairs = [
      ...(needsForex  ? KR_FOREX_PAIRS  : []),
      ...(needsMetals ? KR_METAL_PAIRS  : []),
      ...(needsCrypto ? KR_CRYPTO_PAIRS : []),
    ];
    krWs.send(JSON.stringify({ event: "subscribe", pair: pairs, subscription: { name: "spread" } }));
    console.log("[KR] connected, subscribed spread for", pairs.length, "pairs");
    krPingTimer = setInterval(() => {
      if (krWs && krWs.readyState === 1) krWs.send(JSON.stringify({ event: "ping" }));
    }, 25000);
  });
  krWs.on("message", (data) => {
    try {
      const m = JSON.parse(data);
      if (m.event === "subscriptionStatus") {
        if (m.status === "error") {
          console.warn(`[KR] subscription rejected for ${m.pair}: ${m.errorMessage}`);
          logFeedError("system", "KR", "SUBSCRIBE_ERROR", `${m.pair}: ${m.errorMessage}`);
        } else {
          console.log(`[KR] subscription ${m.status}: ${m.pair} (${m.subscription?.name})`);
        }
      }
      // Spread message: [channelID, [bid, ask, ts, bidSize, askSize], "spread", "EUR/USD"]
      if (Array.isArray(m) && m[2] === "spread") {
        const pair = m[3];
        const sym = KR_PAIR_TO_SYM[pair];
        if (!sym || !state[sym]) return;
        const bid = parseFloat(m[1][0]), ask = parseFloat(m[1][1]);
        if (bid > 0 && ask > 0 && bid < ask) {
          // Sanity-check: reject only forex/crypto spreads wider than 0.5% —
          // those are stale limit orders in Kraken's illiquid FX book (e.g.
          // USD/JPY 381-pip spread). Metals (XAU/XAG) are capped at 100%
          // effectively = no cap: Kraken actively trades XAU/USD and XAG/USD
          // and their natural spread can be legitimately wide.
          const pctSpread = (ask - bid) / bid;
          const isMetal = /^(XAU|XAG|XPT|XPD)/.test(sym);
          const spreadOk = isMetal || pctSpread < 0.005;
          // Store RAW unrounded bid/ask so commitPrice comparison works correctly
          state[sym].bid = bid;
          if (spreadOk) {
            state[sym].ask = ask;
            // Always mark realAt so commitPrice emits real=ask (live spread for clients).
            // applyPrice's preferred-feed guard prevents KR from overriding TD/MV prices.
            state[sym].realAt = Date.now();
          }
          applyPrice(sym, bid, "KR");
        }
      }
    } catch (e) {}
  });
  krWs.on("close", () => {
    if (krPingTimer) { clearInterval(krPingTimer); krPingTimer = null; }
    logFeedError("system", "KR", "WS_CONNECT", "Kraken WebSocket closed, reconnecting in 5s");
    setTimeout(connectKraken, 5000);
  });
  krWs.on("error", (e) => {
    logFeedError("system", "KR", "WS_ERROR", e.message);
  });
}

// ── Massive.com WebSocket — forex real bid/ask ──
// Protocol: connect → send auth → on auth_success send subscribe → receive "C" events
// Auth:      {"action":"auth","params":"API_KEY"}
// Subscribe: {"action":"subscribe","params":"C.*"}  (or "C.EURUSD" for specific pair)
// Message:   {"ev":"C","p":"EURUSD","b":1.0856,"a":1.0858,"t":...}  — p = pair code (no slash)
let mvWs = null;
let MV_BASE_URL = process.env.MASSIVE_WS_URL || "wss://socket.massive.com"; // override via env if different
// Set of symbols delivered via Massive forex feed (C.* channel) — pair code = internal symbol name
// Metals (XAU/USD etc.) are treated as forex pairs by Massive and included in C.*
const MV_SYMBOLS = new Set([
  "EURUSD","GBPUSD","AUDUSD","NZDUSD","USDCAD","USDCHF","USDJPY",
  "EURGBP","EURJPY","EURCAD","EURCHF","GBPJPY","GBPCHF","AUDJPY",
  "AUDNZD","AUDCAD","NZDJPY","USDHKD","USDSGD","USDTRY","USDIDR",
  "USDMXN","USDZAR","GBPAUD","GBPCAD","GBPNZD","EURNZD","EURAUD","CADCHF",
  "CADJPY","CHFJPY","NZDCAD","NZDCHF",
  // Metals — included as forex pairs in C.*
  "XAUUSD","XAGUSD","XPTUSD","XPDUSD",
]);

function connectMassive() {
  if (!MASSIVE_KEY) return;
  if (mvWs) { try { mvWs.removeAllListeners(); mvWs.terminate(); } catch (_) {} mvWs = null; }
  const url = `${MV_BASE_URL}/forex`;
  mvWs = new WebSocket(url);
  mvWs.on("open", () => {
    console.log("[MV] connected, authenticating...");
    mvWs.send(JSON.stringify({ action: "auth", params: MASSIVE_KEY }));
  });
  mvWs.on("message", (data) => {
    try {
      const msgs = JSON.parse(data);
      for (const m of (Array.isArray(msgs) ? msgs : [msgs])) {
        if (m.ev === "status") {
          if (m.status === "auth_success" || m.message === "authenticated") {
            console.log("[MV] authenticated, subscribing to C.*");
            mvWs.send(JSON.stringify({ action: "subscribe", params: "C.*" }));
            recordFeedSuccess("MV");
          } else if (m.status === "auth_failed") {
            console.error("[MV] auth failed:", m.message);
            recordFeedFailure("MV");
          }
        } else if (m.ev === "C" && m.b != null && m.a != null) {
          // m.p is the pair code e.g. "EURUSD" — strip any slash just in case
          const sym = m.p ? m.p.replace("/", "") : null;
          if (sym && state[sym]) {
            state[sym].bid = r(parseFloat(m.b), meta[sym] ? meta[sym].digits : 5);
            state[sym].ask = r(parseFloat(m.a), meta[sym] ? meta[sym].digits : 5);
            state[sym].realAt = Date.now(); // mark fresh so commitPrice emits real=ask even if MV is not primary
            applyPrice(sym, parseFloat(m.b), "MV"); // MT5: smooth toward BID
          }
        }
      }
    } catch (e) {}
  });
  mvWs.on("close", () => { console.log("[MV] closed"); recordFeedFailure("MV"); setTimeout(() => { if (MASSIVE_KEY) connectMassive(); }, 5000); });
  mvWs.on("error", (e) => { console.error("[MV]", e.message); recordFeedFailure("MV"); });
}

// ── Massive.com WebSocket — crypto real bid/ask (separate /crypto feed) ──
// Subscribe: {"action":"subscribe","params":"XQ.*"}  (XQ = eXchange Quotes, bid/ask)
// Message:   {"ev":"XQ","p":"BTCUSD","b":65000.00,"a":65001.00,...}
let mvCryptoWs = null;
function connectMassiveCrypto() {
  if (!MASSIVE_KEY || CRYPTO_FEED !== "MV") return;
  if (mvCryptoWs) { try { mvCryptoWs.removeAllListeners(); mvCryptoWs.terminate(); } catch (_) {} mvCryptoWs = null; }
  mvCryptoWs = new WebSocket(`${MV_BASE_URL}/crypto`);
  mvCryptoWs.on("open", () => {
    console.log("[MV-C] connected, authenticating...");
    mvCryptoWs.send(JSON.stringify({ action: "auth", params: MASSIVE_KEY }));
  });
  mvCryptoWs.on("message", (data) => {
    try {
      const msgs = JSON.parse(data);
      for (const m of (Array.isArray(msgs) ? msgs : [msgs])) {
        if (m.ev === "status") {
          if (m.status === "auth_success" || m.message === "authenticated") {
            // XT.* = crypto quotes stream (bid/ask). XQ.* has no data on this plan.
            console.log("[MV-C] authenticated, subscribing to XT.*");
            mvCryptoWs.send(JSON.stringify({ action: "subscribe", params: "XT.*" }));
            recordFeedSuccess("MV");
          } else if (m.status === "auth_failed") {
            console.error("[MV-C] auth failed:", m.message);
            recordFeedFailure("MV");
          } else {
            console.log("[MV-C] status:", m.status, m.message || "");
          }
        } else if (m.ev === "XT" && m.pair != null && m.p != null) {
          // XT = crypto quotes. c:[1] = bid update, c:[2] = ask update, p = price.
          // Each message updates one side of the book.
          const raw = String(m.pair).replace(/[-/]/g, ""); // "BTC-USD" → "BTCUSD"
          const sym = state[raw] ? raw : (state[raw + "T"] ? raw + "T" : null);
          const price = parseFloat(m.p);
          if (sym && state[sym] && price > 0) {
            const digits = meta[sym] ? meta[sym].digits : 2;
            const cond = Array.isArray(m.c) ? m.c[0] : m.c;
            if (cond === 1) {
              state[sym].bid = r(price, digits);
              applyPrice(sym, price, "MV");
            } else if (cond === 2) {
              state[sym].ask = r(price, digits);
              state[sym].realAt = Date.now();
            } else {
              // Unknown condition — use as price only
              applyPrice(sym, price, "MV");
            }
          }
        } else if ((m.ev === "XQ" || m.ev === "XA") && (m.bp != null || m.b != null) && (m.ap != null || m.a != null)) {
          // XQ/XA = exchange quotes with bid/ask (if plan ever unlocks them)
          const bid = parseFloat(m.bp ?? m.b ?? 0);
          const ask = parseFloat(m.ap ?? m.a ?? 0);
          const raw = m.p ? String(m.p).replace(/[-/]/g, "") : null;
          const sym = raw && state[raw] ? raw : (raw && state[raw + "T"] ? raw + "T" : null);
          if (sym && state[sym] && bid > 0 && ask > 0 && ask >= bid) {
            const digits = meta[sym] ? meta[sym].digits : 2;
            state[sym].bid = r(bid, digits);
            state[sym].ask = r(ask, digits);
            state[sym].realAt = Date.now();
            applyPrice(sym, bid, "MV");
          } else if (raw && !sym) {
            console.log("[MV-C] no sym match:", raw);
          }
        } else if (m.ev && m.ev !== "status") {
          // Log first few unknown events to see what Massive crypto actually sends
          if (!global._mvCryptoUnkAt || Date.now() - global._mvCryptoUnkAt < 15000) {
            if (!global._mvCryptoUnkAt) global._mvCryptoUnkAt = Date.now();
            console.log("[MV-C] unknown ev=" + m.ev + ":", JSON.stringify(m).slice(0, 120));
          }
        }
      }
    } catch (e) {}
  });
  mvCryptoWs.on("close", () => { console.log("[MV-C] closed"); recordFeedFailure("MV"); setTimeout(() => { if (MASSIVE_KEY && CRYPTO_FEED === "MV") connectMassiveCrypto(); }, 5000); });
  mvCryptoWs.on("error", (e) => { console.error("[MV-C]", e.message); recordFeedFailure("MV"); });
}

let tdWs = null;
let tdWsFail200 = 0; // consecutive WS handshake failures
function connectTD() {
  if (!TD_KEY) { console.log("[TD] no key"); return; }
  // Skip WS if no asset class uses TD for live prices (REST/candles still use TD key separately)
  if (FOREX_FEED !== "TD" && CRYPTO_FEED !== "TD" && COMM_FEED !== "TD" && IDX_FEED !== "TD" && STOCK_FEED !== "TD") {
    console.log("[TD] WS not needed — all live feeds on other providers");
    return;
  }
  if (tdWsFail200 >= 5) return; // give up after 5 failed attempts — REST poller covers prices
  // Close previous connection before creating a new one to avoid exhausting the 3-connection limit
  if (tdWs) { try { tdWs.removeAllListeners(); tdWs.terminate(); } catch (_) {} tdWs = null; }
  // No Origin header — TD docs don't require it and spoofing their domain can trigger rejection
  tdWs = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + TD_KEY);
  tdWs.on("open", () => {
    tdWsFail200 = 0; primaryFailCount = 0;
    try {
      // Only subscribe symbols whose feed category uses TD — avoids sending 350+ symbols
      // when Massive/BN covers forex/crypto and TD is only needed for stocks/indices
      const tdSyms = symbols.filter((s) => !DERIVED_SET.has(s) && getCatFeed(meta[s]?.cat) === "TD");
      const subs = tdSyms.map((s) => meta[s].td).filter(Boolean);
      if (subs.length) tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: subs.join(",") } }));
      console.log("[TD] connected, subscribing", subs.length, "symbols (TD-assigned categories only)");
    } catch (e) {}
  });
  tdWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.event === "price" && m.price) { const s = tdToSym[m.symbol]; if (s) { const ask = parseFloat(m.ask || m.price); const bid = parseFloat(m.bid || 0); const hasBid = bid > 0 && bid < ask; if (hasBid) { state[s].bid = r(bid, meta[s].digits); state[s].ask = r(ask, meta[s].digits); } applyPrice(s, hasBid ? bid : ask, "TD"); recordFeedSuccess("TD"); } } } catch (e) {} });
  tdWs.on("close", () => {
    // Exponential backoff: 5s → 15s → 30s → 60s → 120s to avoid rate-limit 200 responses
    const delay = tdWsFail200 === 0 ? 5000 : Math.min(120000, 5000 * Math.pow(2, tdWsFail200));
    if (tdWsFail200 < 5) setTimeout(connectTD, delay);
    else console.warn("[TD] gave up after 5 failures — REST poller covering prices");
  });
  tdWs.on("error", (e) => {
    tdWsFail200++;
    logFeedError("system", "TD", "WS_ERROR", e.message);
    recordFeedFailure("TD");
  });
}

// Micro-tick simulation: between real feed updates, move each symbol's price by
// EXACTLY ONE point (the last decimal) every MICRO_MS, so the last digit crawls
// smoothly like MT5 (e.g. 63961.50 -> 63961.51 -> 63961.52) instead of jumping
// several digits at once. Each symbol keeps a "drift" direction with momentum so
// it trends for a while, then occasionally reverses or pauses. Real feed updates
// (TD/FH) still override these whenever they arrive.
// Resume last-known prices from Redis on boot so symbols animate immediately
// (and survive restarts) instead of waiting for the first live tick.
async function seedFromRedis() {
  for (const sym of symbols) {
    if (DERIVED_SET.has(sym)) continue;
    const st = state[sym]; if (!st || st.price != null) continue;
    try { const v = await redis.get("price:" + sym); const p = v != null ? parseFloat(v) : NaN; if (p > 0) { commitPrice(sym, r(p, meta[sym].digits)); st.target = st.price; } } catch (e) {}
  }
}
// A plausible starting price by category, so symbols the data feed can't supply
// still tick instead of sitting frozen at "...". Real feed/target overrides it.
function seedPriceFor(sym) {
  const cat = (meta[sym] && meta[sym].cat) || "forex";
  const s = sym.toUpperCase();
  if (cat === "metals" || /^XAU/.test(s)) return /^XAG/.test(s) ? 28 : 2350;
  if (cat === "crypto") return s.startsWith("BTC") ? 64000 : s.startsWith("ETH") ? 3400 : 100;
  if (cat === "indices") return 15000;
  if (cat === "stocks") return 150;
  if (/JPY$/.test(s)) return 150; // forex JPY pairs
  return 1.1; // generic forex
}
// After the feeds have had a chance to connect, give anything still unpriced a
// synthetic seed so every symbol moves.
function ensureSeeded() {
  for (const sym of symbols) {
    if (DERIVED_SET.has(sym)) continue;
    const st = state[sym]; if (!st || st.price != null) continue;
    commitPrice(sym, r(seedPriceFor(sym), meta[sym].digits));
  }
  // Broadcast a full snapshot so clients connected before seeding pick up all prices at once.
  if (global.__io) {
    const px = {};
    for (const s of symbols) { const st = state[s]; if (st && st.price != null) px[s] = st.price; }
    global.__io.emit("prices", px);
  }
}

// Is the symbol's market open right now? Crypto = 24/7; forex & metals close on the
// weekend (Fri 21:00 UTC → Sun 21:00 UTC); stocks/indices trade weekday US hours.
// When closed, prices are frozen (no jitter, no feed walk) so they don't drift.
function isMarketOpen(sym, cat) {
  const s = String(sym || "").toUpperCase();
  const c = String(cat || "").toLowerCase();
  // Crypto: 24/7
  if (c === "crypto" || /USDT$/.test(s) || /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC|DOT|AVAX|TRX|LINK|SHIB|MATIC|UNI)/.test(s)) return true;
  const now = new Date();
  const day = now.getUTCDay();   // 0=Sun … 6=Sat
  const h = now.getUTCHours();
  // Stocks / indices: weekday US session
  if (c === "stocks" || c === "indices") {
    if (day === 0 || day === 6) return false;
    return h >= 13 && h < 21;
  }
  // Forex & metals: weekend close — ONLY for confirmed fx/metals (don't freeze
  // unknown/uncategorized symbols, or the whole watch can look frozen).
  const isFx = c === "forex" || c === "metals" || /^(XAU|XAG|XPT|XPD)/.test(s) || /^[A-Z]{6}$/.test(s);
  if (isFx) {
    if (day === 6) return false;                 // Saturday
    if (day === 0 && h < 21) return false;        // Sunday before 21:00 UTC
    if (day === 5 && h >= 21) return false;        // Friday after 21:00 UTC
    return true;
  }
  return true; // unknown category/symbol → keep moving
}

function microTick() {
  // Compute time-based market-open checks once per tick (not once per symbol × 200)
  const _day = new Date().getUTCDay(), _h = new Date().getUTCHours();
  const _fxClosed = _day === 6 || (_day === 0 && _h < 21) || (_day === 5 && _h >= 21);
  const _stockOpen = _day >= 1 && _day <= 5 && _h >= 13 && _h < 21;
  for (const sym of symbols) {
    const st = state[sym];
    if (!st || st.price == null) continue;
    if (!meta[sym].enabled) continue; // disabled → no socket.io ticks, Redis already updated via applyPrice
    // Fast market-open check using pre-computed day/hour
    const cat = meta[sym].cat;
    if (cat === "stocks" || cat === "indices") { if (!_stockOpen) continue; }
    else if (cat !== "crypto" && !/USDT$/i.test(sym)) { if (_fxClosed) continue; }
    // Exact real-time mode: a symbol with a fresh real tick holds it (the feed
    // drives the candle). Don't add synthetic walk/jitter on top, so candles
    // match the real market. After REAL_TTL of silence, resume synthetic so it
    // never looks frozen (feed gap / illiquid period).
    if (REAL_EXACT && st.realAt && Date.now() - st.realAt < REAL_TTL) continue;
    const d = (meta[sym] && meta[sym].digits) || 2;
    const step = Math.pow(10, -d);
    const tgt = st.target != null ? st.target : st.price; // real (or computed) anchor
    const gapPts = Math.round((tgt - st.price) / step);
    const ag = Math.abs(gapPts);
    let np;
    if (ag > 3) {
      // Far from the real price → catch up: small moves crawl, bigger real moves
      // catch up proportionally (so it tracks the market without lag), huge snaps.
      const mv = ag > 400 ? gapPts : Math.sign(gapPts) * Math.ceil(ag / 6);
      np = st.price + mv * step;
    } else if (!DERIVED_SET.has(sym)) {
      // Near the real price → WANDER one point each tick with momentum, bounded to
      // a small band around the real anchor. This keeps the last digit moving every
      // tick (real-time feel on market watch / chart / P&L) WITHOUT snapping back
      // into a tight two-value loop. Real feed updates re-anchor `tgt` continuously.
      const band = step * 3;
      if (st.drift == null) st.drift = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.08) st.drift = -st.drift; // occasional reversal (trends)
      np = st.price + st.drift * step;
      if (np > tgt + band) { np = tgt + band; st.drift = -1; }
      else if (np < tgt - band) { np = tgt - band; st.drift = 1; }
    } else {
      continue; // derived symbol caught up: hold until a base moves it again
    }
    np = r(np, d);
    if (np > 0 && np !== st.price) commitPrice(sym, np);
  }
}

// Spread cache: symbol (with floating support), group, per-account markups, and per-client-per-symbol overrides.
// symSpreads:    "tenantId:symbol"  → { min, max, type }
// grpSpreads:    groupId            → pips
// accMarkups:    accountId          → pips  (account-wide additive markup)
// accSymOverrides: "accountId:symbol" → pips (absolute override — highest priority; 0 = zero spread)
// realBids:      symbol             → latest real bid from exchange (Kraken/Binance)
const symSpreads = {};
const grpSpreads = {};
const accMarkups = {};
const accSymOverrides = {};
const realBids = {};
async function loadSpreads() {
  try {
    const [syms, grps, accs, symOvRows] = await Promise.all([
      prisma.symbol.findMany({ select: { tenantId: true, symbol: true, spread: true, spreadType: true, spreadMax: true } }),
      prisma.tradeGroup.findMany({ select: { id: true, spread: true, spreadType: true } }),
      prisma.account.findMany({ where: { spreadMarkup: { gt: 0 } }, select: { id: true, spreadMarkup: true } }),
      prisma.accountSymbolOverride.findMany({ where: { spreadOverride: { not: null } }, select: { accountId: true, symbol: true, spreadOverride: true } }),
    ]);
    const tenantSpreadMap = {}; // tenantId → { symbol → {min,max,type} }
    for (const s of syms) {
      symSpreads[s.tenantId + ":" + s.symbol] = { min: Number(s.spread || 0), max: Number(s.spreadMax || 0), type: s.spreadType || "FLOATING" };
      if (!tenantSpreadMap[s.tenantId]) tenantSpreadMap[s.tenantId] = {};
      tenantSpreadMap[s.tenantId][s.symbol] = { min: Number(s.spread || 0), max: Number(s.spreadMax || 0), type: s.spreadType || "FLOATING" };
    }
    for (const g of grps) grpSpreads[g.id] = Number(g.spread || 0);
    for (const a of accs) accMarkups[a.id] = Number(a.spreadMarkup);
    // Clear and repopulate per-client-per-symbol overrides
    for (const k in accSymOverrides) delete accSymOverrides[k];
    for (const r of symOvRows) accSymOverrides[r.accountId + ":" + r.symbol] = Number(r.spreadOverride);
    // Push spread updates to all connected clients — each tenant gets its own data
    if (global.__io) {
      for (const [tenantId, spreads] of Object.entries(tenantSpreadMap)) {
        global.__io.to("t:" + tenantId).emit("sym-spreads", spreads);
      }
    }
  } catch (e) { console.error("[spreads] load failed", e); }
}
// Compute floating or fixed symbol spread in pips.
function getSymSpreadPips(tenantId, symbol) {
  const s = symSpreads[tenantId + ":" + symbol];
  if (!s) return 0;
  if (s.type !== "FLOATING" || s.max <= s.min) return s.min;
  const h = new Date().getUTCHours(), d = new Date().getUTCDay();
  const isPeak = d >= 1 && d <= 5 && h >= 8 && h < 17;
  return isPeak ? s.min : s.min + (s.max - s.min);
}
function getSpreadPrice(tenantId, symbol, groupId, accountId) {
  // Per-client-per-symbol override is absolute — bypasses symbol + group entirely
  if (accountId) {
    const ov = accSymOverrides[accountId + ":" + symbol];
    if (ov !== undefined) {
      const digits = (meta[symbol] && meta[symbol].digits) || 5;
      return ov * Math.pow(10, -(digits - 1));
    }
  }
  const pips = getSymSpreadPips(tenantId, symbol) + (grpSpreads[groupId] || 0) + (accMarkups[accountId] || 0);
  const digits = (meta[symbol] && meta[symbol].digits) || 5;
  return pips * Math.pow(10, -(digits - 1));
}
function getBid(tenantId, symbol, groupId, accountId, ask) {
  // Per-client-per-symbol override: always use fixed spread (ignores FLOATING type)
  if (accountId && accSymOverrides[accountId + ":" + symbol] !== undefined) {
    return ask - getSpreadPrice(tenantId, symbol, groupId, accountId);
  }
  const s = symSpreads[tenantId + ":" + symbol];
  if (s && s.type === "FLOATING") {
    const rb = realBids[symbol];
    if (rb != null && rb > 0 && rb < ask) {
      // ECN model: bid = real exchange bid − group/account markup pips
      const grpPips = grpSpreads[groupId] || 0;
      const accPips = accMarkups[accountId] || 0;
      const digits = (meta[symbol] && meta[symbol].digits) || 5;
      const pip = Math.pow(10, -(digits - 1));
      return Math.max(0, rb - (grpPips + accPips) * pip);
    }
    // No real bid yet (feed not connected) — zero spread fallback
    return ask;
  }
  // FIXED: configured pips
  return ask - getSpreadPrice(tenantId, symbol, groupId, accountId);
}

// Shared P&L: $1/pip/lot for forex (USD quote); USD-base converted via rate;
// metals/crypto/indices keep contract model. Mirrors src/lib/trademath.ts.
function calcPnl(symbol, type, openPrice, price, lots) {
  const sym = String(symbol || "");
  const dir = type === "BUY" ? 1 : -1;
  const diff = (price - openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  const m = meta[sym] || { contract: 100000 };
  let pf = diff * lots * m.contract;
  if (isFx && /^USD/i.test(sym)) pf = pf / (price || 1);
  return pf;
}
const liquidating = new Set(); // guard: prevent double-liquidation of same account
const closing = new Set();    // guard: prevent double-close of same trade (TP/SL)
// Risk alert cooldown — key: "accountId:condition", value: last-alert timestamp.
// Prevents spamming the same alert every 3s when an account is in a prolonged risk state.
const riskCooldown = new Map();
const RISK_COOL_MS = 5 * 60 * 1000; // 5-minute gap between repeat alerts per account per condition

// Mirror of notification.service.notifyStaff for the server runtime (CommonJS):
// tenant admins + the owning manager + ALL SuperAdmins. Realtime delivery rides
// the existing io.emit("refresh") which makes open desks reload their notifs.
// Housekeeping: keep only the last 7 days of notifications (delete older).
async function purgeOldNotifications() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const r = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (r.count) console.log("[notif-cleanup] deleted", r.count, "notifications older than 7 days");
  } catch (e) { console.error("[notif-cleanup]", e); }
}

async function notifyStaffRaw(tenantId, opts, managerId) {
  try {
    const or = [{ role: "ADMIN" }];
    if (managerId) or.push({ id: managerId, role: "MANAGER" });
    const staff = await prisma.user.findMany({ where: { tenantId, OR: or }, select: { id: true } });
    const supers = await prisma.user.findMany({ where: { role: "SUPERADMIN" }, select: { id: true } });
    const seen = new Set();
    const recips = [...staff, ...supers].filter((u) => (seen.has(u.id) ? false : seen.add(u.id)));
    if (!recips.length) return;
    await prisma.notification.createMany({ data: recips.map((u) => ({ tenantId, userId: u.id, title: opts.title, body: opts.body || null, type: opts.type || "NOTICE" })) });
    for (const u of recips) pushToUser(u.id, { title: opts.title, body: opts.body });
  } catch (e) { console.error("[notifyStaffRaw]", e); }
}

// Web push (mirrors src/lib/push.ts) so clients/staff get TP/SL/MC/pending alerts
// even when the app is fully CLOSED. No-op until VAPID keys are configured.
let pushReady = false;
function ensurePush() {
  if (pushReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  try { webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@cubex.io", pub, priv); pushReady = true; return true; } catch { return false; }
}
async function pushToUser(userId, payload) {
  if (!userId || !ensurePush()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const data = JSON.stringify({ title: payload.title, body: payload.body || "", url: payload.url || "/client" });
    for (const sub of subs) {
      try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data); }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {}); }
    }
  } catch (e) { console.error("[push]", e); }
}

async function closeTpSl(t, reason, price, io) {
  if (closing.has(t.id.toString())) return;
  closing.add(t.id.toString());
  try {
    const pnl = calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots));
    const swap = Number(t.swap ?? 0);
    // Convert USD P&L and swap to the account's base currency before crediting.
    const cur = t.account?.currency;
    const fxRate = cur === 'EUR' ? (state['EURUSD']?.price || 1) : cur === 'GBP' ? (state['GBPUSD']?.price || 1) : 1;
    const cs = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
    const pnlAcc = pnl / fxRate;
    const swapAcc = swap / fxRate;
    await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: t.accountId, symbol: t.symbol, side: t.type, lots: t.lots, openPrice: t.openPrice, closePrice: price, sl: t.sl, tp: t.tp, pnl: pnlAcc, swap: swapAcc, commission: t.commission ?? 0, comment: t.comment || null, closeReason: reason, openedAt: t.openedAt } });
    await prisma.trade.delete({ where: { id: t.id } });
    await prisma.account.update({ where: { id: t.accountId }, data: { pnl: { increment: pnlAcc + swapAcc } } });
    if (t.account && t.account.userId) {
      const title = reason === "TP" ? "Take Profit hit ✓" : "Stop Loss hit";
      const body = `${t.symbol} ${t.type} closed @ ${price} | P/L ${pnlAcc >= 0 ? "+" : ""}${cs}${Math.abs(pnlAcc).toFixed(2)}`;
      await prisma.notification.create({ data: { tenantId: t.account.tenantId, userId: t.account.userId, title, body, type: "TRADE" } }).catch(() => {});
      pushToUser(t.account.userId, { title, body }); // push even if app is closed
      await notifyStaffRaw(t.account.tenantId, { title: (reason === "TP" ? "TP hit" : "SL hit") + " — " + (t.account.login || ""), body, type: "TRADE" }, t.account.managerId);
      await prisma.auditLog.create({ data: { tenantId: t.account.tenantId, action: "trade." + (reason === "TP" ? "tp" : "sl"), detail: (t.account.login || "") + " " + body, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
    }
    io.emit("refresh", {});
    io.emit("refresh", { kind: "notification" }); // make client + staff reload notifs (sound + toast)
    console.log("[" + reason + "]", t.symbol, t.type, Number(t.lots) + "L @ " + price, "P/L (USD)", pnl.toFixed(2));
  } catch (e) { console.error("[tp/sl close]", e); } finally { closing.delete(t.id.toString()); }
}

async function liquidate(acc, list, io) {
  if (liquidating.has(acc.id)) return;
  liquidating.add(acc.id);
  try {
    const liqFxRate = acc.currency === 'EUR' ? (state['EURUSD']?.price || 1) : acc.currency === 'GBP' ? (state['GBPUSD']?.price || 1) : 1;
    const liqCs = acc.currency === 'EUR' ? '€' : acc.currency === 'GBP' ? '£' : '$';
    let total = 0; // accumulated in account currency
    for (const t of list) {
      const _lst = state[t.symbol];
      const _lra = (_lst && _lst.ask > 0) ? _lst.ask : null;
      const ask = _lra ?? ((_lst?.price || Number(t.openPrice)) + getSpreadPrice(acc.tenantId, t.symbol, acc.groupId, acc.id));
      const price = t.type === "BUY" ? getBid(acc.tenantId, t.symbol, acc.groupId, acc.id, ask) : ask;
      const pnl = calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots));
      const swapAmt = Number(t.swap ?? 0);
      const pnlAcc = pnl / liqFxRate;
      const swapAcc = swapAmt / liqFxRate;
      total += pnlAcc + swapAcc;
      await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: acc.id, symbol: t.symbol, side: t.type, lots: t.lots, openPrice: t.openPrice, closePrice: price, sl: t.sl, tp: t.tp, pnl: pnlAcc, swap: swapAcc, commission: t.commission ?? 0, comment: t.comment || null, closeReason: "MC", openedAt: t.openedAt } });
      await prisma.trade.delete({ where: { id: t.id } });
    }
    await prisma.account.update({ where: { id: acc.id }, data: { pnl: { increment: total } } });
    const body = acc.login + " margin call — " + list.length + " trade(s) closed, P/L " + liqCs + Math.abs(total).toFixed(2);
    if (acc.userId) { await prisma.notification.create({ data: { tenantId: acc.tenantId, userId: acc.userId, title: "Stop out", body: "Positions liquidated at margin call", type: "TRADE" } }).catch(() => {}); pushToUser(acc.userId, { title: "Stop out", body: "Positions liquidated at margin call" }); }
    await notifyStaffRaw(acc.tenantId, { title: "⚠ Margin call — " + acc.login, body, type: "TRADE" }, acc.managerId);
    await prisma.auditLog.create({ data: { tenantId: acc.tenantId, action: "account.liquidated", detail: body, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
    io.emit("liquidation", { accountId: acc.id, login: acc.login });
    io.emit("refresh", {});
    io.emit("refresh", { kind: "notification" }); // client + staff reload notifs (sound + toast)
    console.log("[MC] liquidated", acc.login, list.length, "trades, total P/L:", total.toFixed(2));
  } catch (e) { console.error("[liquidate]", e); } finally { liquidating.delete(acc.id); }
}
let _monitorRunning = false;
async function monitor(io) {
  if (_monitorRunning) return; // skip if previous run hasn't finished
  _monitorRunning = true;
  try {
    const trades = await prisma.trade.findMany({ include: { account: true } });
    const byAcc = {};
    for (const t of trades) (byAcc[t.accountId] || (byAcc[t.accountId] = { acc: t.account, list: [] })).list.push(t);
    for (const id of Object.keys(byAcc)) {
      const { acc, list } = byAcc[id]; const mc = Number(acc.mcLevel);
      if (!(mc > 0) || acc.doNotLiquidate) continue;
      // Skip liquidation check when all traded symbols have closed markets
      if (list.every((t) => !isMarketOpen(t.symbol, meta[t.symbol] && meta[t.symbol].cat))) continue;
      const balance = Number(acc.deposit) - Number(acc.withdrawal) + Number(acc.credit) + Number(acc.bonus) + Number(acc.pnl);
      // FX rate converts account-currency balance to USD for margin level (floating/used are USD).
      const monFxRate = acc.currency === 'EUR' ? (state['EURUSD']?.price || 1) : acc.currency === 'GBP' ? (state['GBPUSD']?.price || 1) : 1;
      const monCs = acc.currency === 'EUR' ? '€' : acc.currency === 'GBP' ? '£' : '$';
      const balanceUSD = balance * monFxRate;
      let floating = 0;
      const net = {};
      // Build symbol→openPrice Map once to avoid O(n) list.find() inside inner loop
      const symOpen = new Map(list.map((t) => [t.symbol, Number(t.openPrice)]));
      for (const t of list) {
        const m = meta[t.symbol]; if (!m) continue;
        const _mst = state[t.symbol];
        const _mra = (_mst && _mst.ask > 0) ? _mst.ask : null;
        const ask = _mra ?? ((_mst?.price || Number(t.openPrice)) + getSpreadPrice(acc.tenantId, t.symbol, acc.groupId, acc.id));
        const closePrice = t.type === "BUY" ? getBid(acc.tenantId, t.symbol, acc.groupId, acc.id, ask) : ask;
        floating += calcPnl(t.symbol, t.type, Number(t.openPrice), closePrice, Number(t.lots));
        net[t.symbol] = (net[t.symbol] || 0) + (t.type === "BUY" ? 1 : -1) * Number(t.lots);
      }
      let used = 0;
      for (const sym in net) {
        const nl = Math.abs(net[sym]); if (nl < 1e-9) continue;
        const m = meta[sym]; if (!m) continue;
        const ask = state[sym] && state[sym].price ? state[sym].price : (symOpen.get(sym) || 0);
        let mg = (nl * m.contract * ask) / acc.leverage; if (/JPY$/i.test(sym)) mg = mg / 100; used += mg;
      }
      if (used <= 0) continue;
      const mlvl = ((balanceUSD + floating) / used) * 100;
      if (mlvl <= mc) {
        await liquidate(acc, list, io);
      } else {
        // Risk alerts: warn staff proactively before liquidation occurs.
        // Convert USD values to account currency for human-readable alert text.
        const equityAcc = (balanceUSD + floating) / monFxRate;
        const usedAcc = used / monFxRate;
        const floatingAcc = floating / monFxRate;
        const now = Date.now();

        // Alert 1: margin level falling below 150% (account approaching stop-out)
        const kMargin = acc.id + ":margin-warn";
        if (mlvl < 150) {
          if (!riskCooldown.has(kMargin) || now - riskCooldown.get(kMargin) > RISK_COOL_MS) {
            riskCooldown.set(kMargin, now);
            const body = acc.login + " margin level at " + mlvl.toFixed(0) + "% (S/O at " + mc + "%) — equity " + monCs + equityAcc.toFixed(2) + ", used margin " + monCs + usedAcc.toFixed(2);
            await notifyStaffRaw(acc.tenantId, { title: "⚠ Low Margin — " + acc.login, body, type: "RISK" }, acc.managerId);
            io.emit("refresh", { kind: "notification" });
          }
        } else {
          riskCooldown.delete(kMargin); // condition cleared — reset so next breach re-alerts immediately
        }

        // Alert 2: floating loss exceeds 20% of account balance (in account currency)
        const kFloat = acc.id + ":float-loss";
        if (balance > 0 && floatingAcc < 0 && (-floatingAcc / balance) * 100 > 20) {
          if (!riskCooldown.has(kFloat) || now - riskCooldown.get(kFloat) > RISK_COOL_MS) {
            riskCooldown.set(kFloat, now);
            const pct = ((-floatingAcc / balance) * 100).toFixed(1);
            const body = acc.login + " floating loss " + pct + "% of balance — " + monCs + (-floatingAcc).toFixed(2) + " unrealised loss on " + monCs + balance.toFixed(2) + " balance";
            await notifyStaffRaw(acc.tenantId, { title: "⚠ High Floating Loss — " + acc.login, body, type: "RISK" }, acc.managerId);
            io.emit("refresh", { kind: "notification" });
          }
        } else {
          riskCooldown.delete(kFloat);
        }
      }
    }
    // TP/SL: BUY triggered on bid, SELL triggered on ask (MT5 style)
    // Skip when market is closed — prices are frozen, so TP/SL must not fire on weekend.
    for (const t of trades) {
      if (closing.has(t.id.toString())) continue;
      if (!isMarketOpen(t.symbol, meta[t.symbol] && meta[t.symbol].cat)) continue;
      const st = state[t.symbol];
      if (!st || st.price == null) continue;
      // Use real exchange ask when available; otherwise construct from display BID + configured spread
      const realAsk = (st.ask != null && st.ask > 0) ? st.ask : null;
      const ask = realAsk ?? (st.price + getSpreadPrice(t.account.tenantId, t.symbol, t.account.groupId, t.account.id));
      const bid = getBid(t.account.tenantId, t.symbol, t.account.groupId, t.account.id, ask);
      const sl = Number(t.sl), tp = Number(t.tp);
      let reason = null;
      if (t.type === "BUY") {
        if (tp > 0 && bid >= tp) reason = "TP";
        else if (sl > 0 && bid <= sl) reason = "SL";
      } else {
        if (tp > 0 && ask <= tp) reason = "TP";
        else if (sl > 0 && ask >= sl) reason = "SL";
      }
      // Trailing stop: adjust SL as price moves in favour
      const trailDist = Number(t.trailingStop);
      if (!reason && trailDist > 0) {
        if (t.type === "BUY") {
          const newSl = bid - trailDist;
          if (newSl > Number(t.sl)) {
            if (bid <= newSl) { reason = "SL"; }
            else { await prisma.trade.update({ where: { id: t.id }, data: { sl: newSl } }).catch(() => {}); }
          }
        } else {
          const newSl = ask + trailDist;
          if (newSl < Number(t.sl) || Number(t.sl) === 0) {
            if (ask >= newSl) { reason = "SL"; }
            else { await prisma.trade.update({ where: { id: t.id }, data: { sl: newSl } }).catch(() => {}); }
          }
        }
      }
      // Close at exact TP/SL price level, not the current market price (which may have moved past it)
      if (reason) {
        const closePrice = reason === "TP" ? tp : reason === "SL" ? sl : (t.type === "BUY" ? bid : ask);
        closeTpSl(t, reason, closePrice, io);
      }
    }
  } catch (e) { console.error("[monitor]", e); } finally { _monitorRunning = false; }
}

async function checkPending(io) {
  try {
    const pend = await prisma.pendingOrder.findMany({ include: { account: true } });
    const now = new Date();
    for (const o of pend) {
      // GTD expiry: auto-cancel when expiresAt has passed
      if (o.expiresAt && now > o.expiresAt) {
        await prisma.pendingOrder.delete({ where: { id: o.id } });
        const expBody = o.symbol + " " + o.side + " " + Number(o.lots) + " @ " + Number(o.price) + " expired (GTD)";
        if (o.account?.userId) { await prisma.notification.create({ data: { tenantId: o.account.tenantId, userId: o.account.userId, title: "Pending order expired", body: expBody, type: "TRADE" } }).catch(() => {}); pushToUser(o.account.userId, { title: "Pending order expired", body: expBody }); }
        await prisma.auditLog.create({ data: { tenantId: o.account.tenantId, action: "order.expired", detail: (o.account.login || "") + " " + expBody, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
        if (global.__io) global.__io.emit("refresh", {});
        continue;
      }
      const st = state[o.symbol];
      if (!st || st.price == null) continue;
      const _pra = (st.ask != null && st.ask > 0) ? st.ask : null;
      const ask = _pra ?? (st.price + getSpreadPrice(o.account.tenantId, o.symbol, o.account.groupId, o.account.id));
      const bid = getBid(o.account.tenantId, o.symbol, o.account.groupId, o.account.id, ask);
      const trig = Number(o.price);
      if (!trig) continue;
      // BUY orders trigger on ask; SELL orders trigger on bid (MT5 style)
      let fill = false;
      if (o.side === "BUY"  && o.kind === "LIMIT")      fill = ask <= trig;
      else if (o.side === "BUY"  && o.kind === "STOP")  fill = ask >= trig;
      else if (o.side === "SELL" && o.kind === "LIMIT") fill = bid >= trig;
      else if (o.side === "SELL" && o.kind === "STOP")  fill = bid <= trig;
      // STOP_LIMIT: stop price hit → place limit at stopLimit price
      else if (o.kind === "STOP_LIMIT") {
        const stopHit = o.side === "BUY" ? ask >= trig : bid <= trig;
        if (stopHit) {
          const limitPx = Number(o.stopLimit) || trig;
          // Convert to a LIMIT order at limitPx
          await prisma.pendingOrder.update({ where: { id: o.id }, data: { kind: o.side === "BUY" ? "LIMIT" : "LIMIT", price: limitPx } }).catch(() => {});
        }
        continue;
      }
      if (!fill) continue;
      // BUY opens at ask, SELL opens at bid
      const openPx = o.side === "BUY" ? ask : bid;
      // Commission on pending fill
      const symForComm = await prisma.symbol.findFirst({ where: { tenantId: o.account.tenantId, symbol: o.symbol }, select: { commissionPerLot: true } }).catch(() => null);
      const pendComm = Number(o.lots) * Number(symForComm?.commissionPerLot ?? 0);
      const ticket = await nextTicket(o.account.tenantId);
      await prisma.trade.create({ data: { ticket, accountId: o.accountId, symbol: o.symbol, type: o.side, lots: o.lots, openPrice: openPx, sl: o.sl, tp: o.tp, commission: pendComm, comment: o.comment || null } });
      if (pendComm > 0) await prisma.account.update({ where: { id: o.accountId }, data: { pnl: { decrement: pendComm } } }).catch(() => {});
      await prisma.pendingOrder.delete({ where: { id: o.id } });
      const pbody = o.symbol + " " + o.side + " " + Number(o.lots) + " @ " + openPx;
      if (o.account && o.account.userId) { await prisma.notification.create({ data: { tenantId: o.account.tenantId, userId: o.account.userId, title: "Pending order filled", body: pbody, type: "TRADE" } }).catch(() => {}); pushToUser(o.account.userId, { title: "Pending order filled", body: pbody }); }
      await notifyStaffRaw(o.account.tenantId, { title: "Pending filled — " + (o.account.login || ""), body: pbody, type: "TRADE" }, o.account.managerId);
      await prisma.auditLog.create({ data: { tenantId: o.account.tenantId, action: "order.filled", detail: (o.account.login || "") + " " + pbody, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
      io.emit("refresh", {});
      io.emit("refresh", { kind: "notification" }); // client + staff reload notifs (sound + toast)
    }
  } catch (e) { console.error("[checkPending]", e); }
}
// REST price poller — TD WebSocket only streams a subset of symbols on most
// plans, so we batch-poll /price for every base symbol. One request covers all;
// derived symbols recompute automatically from the base prices.
async function pollChunk(chunk) {
  const uniqTd = Array.from(new Set(chunk.map((s) => meta[s].td)));
  try {
    // Use /quote (Pro plan) to get bid+ask where available; falls back to close/price
    const url = "https://api.twelvedata.com/quote?symbol=" + encodeURIComponent(uniqTd.join(",")) + "&apikey=" + TD_KEY;
    const res = await fetch(url);
    const data = await res.json();
    if (!data) return;
    const applyEntry = (s, entry) => {
      if (!entry) return;
      const ask = parseFloat(entry.ask || entry.close || entry.price || 0);
      const bid = parseFloat(entry.bid || 0);
      if (ask > 0) {
        const hasBid = bid > 0 && bid < ask;
        if (hasBid) { state[s].bid = r(bid, meta[s].digits); state[s].ask = r(ask, meta[s].digits); }
        // do NOT null bid here — Kraken/Binance real bid must be preserved
        applyPrice(s, hasBid ? bid : ask, "TD"); // MT5: smooth toward BID when available
      }
    };
    if (uniqTd.length === 1) { for (const s of chunk) if (meta[s].td === uniqTd[0]) applyEntry(s, data); return; }
    for (const s of chunk) applyEntry(s, data[meta[s].td]);
  } catch (e) { /* transient — Finnhub WS covers the gap */ }
}
async function pollPrices() {
  if (!TD_KEY) return;
  const base = symbols.filter((s) => !DERIVED_SET.has(s));
  if (!base.length) return;
  // Chunk so one bad symbol / plan batch-limit can't blank the whole feed.
  const CHUNK = 20;
  for (let i = 0; i < base.length; i += CHUNK) {
    await pollChunk(base.slice(i, i + CHUNK));
  }
}

// ── Statement email scheduler ──
// Ticks once per clock hour and calls the internal cron route, which decides per
// client (in their local time) whether it's the Monday 06:00 (weekly) or 1st 06:00
// (monthly) send window. Runs in-process against this same server.
const CRON_SECRET = process.env.CRON_SECRET || "";
async function statementCronTick() {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/cron/statements", {
      method: "POST",
      headers: CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {},
    });
    const d = await res.json().catch(() => ({}));
    if (d && (d.weekly || d.monthly)) console.log("[statements] sent", d.weekly || 0, "weekly,", d.monthly || 0, "monthly");
  } catch (e) { /* transient — retried next hour */ }
}
// ── Price Alerts ─────────────────────────────────────────────────────────────
async function checkPriceAlerts(io) {
  try {
    const alerts = await prisma.priceAlert.findMany({ where: { triggered: false }, include: { account: true } });
    for (const al of alerts) {
      const st = state[al.symbol];
      if (!st || st.price == null) continue;
      const price = st.price;
      const hit = al.condition === "ABOVE" ? price >= Number(al.price) : price <= Number(al.price);
      if (!hit) continue;
      await prisma.priceAlert.update({ where: { id: al.id }, data: { triggered: true } });
      const body = `${al.symbol} ${al.condition === "ABOVE" ? "rose above" : "fell below"} ${Number(al.price)}${al.note ? " — " + al.note : ""}`;
      if (al.account?.userId) {
        await prisma.notification.create({ data: { tenantId: al.tenantId, userId: al.account.userId, title: "Price alert triggered", body, type: "TRADE" } }).catch(() => {});
        pushToUser(al.account.userId, { title: "Price alert triggered", body });
        // Send branded email — fire-and-forget via internal route
        fetch("http://127.0.0.1:" + port + "/api/internal/alert-fire", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {}) },
          body: JSON.stringify({ tenantId: al.tenantId, userId: al.account.userId, holderName: al.account.name || "Trader", symbol: al.symbol, condition: al.condition, price: Number(al.price), note: al.note }),
        }).catch(() => {});
      }
      if (io) io.emit("refresh", { kind: "notification" });
    }
  } catch (e) { console.error("[alerts]", e); }
}

// ── Swap Daily Cron ───────────────────────────────────────────────────────────
// Runs at 00:00 UTC. Charges swapLong (BUY) or swapShort (SELL) pips × pip value × lots.
// Triple on Wednesday (covers Sat+Sun, MT5 standard).
async function swapCronTick() {
  try {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) { console.log("[swap] weekend — skipping"); return; }
    const isWed = day === 3; // Wednesday UTC
    const multiplier = isWed ? 3 : 1;
    // Only process tenants where swap is enabled
    const tenants = await prisma.tenant.findMany({ where: { swapEnabled: true }, select: { id: true } });
    const tenantIds = new Set(tenants.map((t) => t.id));
    if (!tenantIds.size) return;
    const trades = await prisma.trade.findMany({ where: { account: { tenantId: { in: Array.from(tenantIds) } } }, include: { account: true } });
    // Pre-load all symbol swap rates in one query — eliminates N+1 (one DB call per trade → one total)
    const symRows = await prisma.symbol.findMany({
      where: { tenantId: { in: Array.from(tenantIds) } },
      select: { tenantId: true, symbol: true, swapLong: true, swapShort: true, digits: true },
    });
    const symMap = new Map(symRows.map((s) => [s.tenantId + ":" + s.symbol, s]));
    const { Prisma: PrismaClient } = require("@prisma/client");
    for (const t of trades) {
      if (t.account.swapFree) continue;
      const sym = symMap.get(t.account.tenantId + ":" + t.symbol);
      if (!sym) continue;
      const swapRate = t.type === "BUY" ? Number(sym.swapLong) : Number(sym.swapShort);
      if (swapRate === 0) continue;
      const pip = Math.pow(10, -(sym.digits - 1));
      const price = state[t.symbol]?.price ?? Number(t.openPrice);
      const m = meta[t.symbol];
      const contract = m ? m.contract : 100000;
      const swapAmt = swapRate * pip * Number(t.lots) * contract * multiplier;
      await prisma.trade.update({ where: { id: t.id }, data: { swap: { increment: new PrismaClient.Decimal(swapAmt) } } }).catch(() => {});
    }
    console.log("[swap] processed", trades.length, "trades, multiplier:", multiplier);
  } catch (e) { console.error("[swap]", e); }
}
function startSwapCron(io) {
  // Schedule to run at next 00:00 UTC then every 24h
  const now = new Date();
  const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const msToMidnight = nextMidnightUTC.getTime() - now.getTime();
  setTimeout(() => { swapCronTick(); setInterval(swapCronTick, 24 * 60 * 60 * 1000); }, msToMidnight);
  console.log("[swap] cron scheduled, next run in", Math.round(msToMidnight / 60000), "min");
}

function startStatementCron() {
  statementCronTick(); // catch the current hour on boot
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
  setTimeout(() => { statementCronTick(); setInterval(statementCronTick, 60 * 60 * 1000); }, Math.max(1000, msToNextHour));
}
// Daily cleanup of expired demo trials (past the grace period).
async function trialCleanupTick() {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/cron/trial-cleanup", { method: "POST", headers: CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {} });
    const d = await res.json().catch(() => ({}));
    if (d && d.deleted) console.log("[trials] cleaned up", d.deleted, "expired demo tenant(s)");
  } catch (e) { /* transient — retried next day */ }
}
function startTrialCleanup() {
  setTimeout(trialCleanupTick, 5 * 60 * 1000);
  setInterval(trialCleanupTick, 24 * 60 * 60 * 1000);
}

// Daily billing cron: auto-generate invoices 2 days before subscription expiry
// and suspend tenants with overdue unpaid invoices.
async function billingCronTick() {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/cron/billing", { method: "POST", headers: CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {} });
    const d = await res.json().catch(() => ({}));
    if (d && (d.generated || d.suspended)) console.log("[billing] invoices-generated=" + (d.generated || 0) + " tenants-suspended=" + (d.suspended || 0));
  } catch (e) { /* transient — retried next day */ }
}
function startBillingCron() {
  setTimeout(billingCronTick, 3 * 60 * 1000); // 3 min after boot
  setInterval(billingCronTick, 24 * 60 * 60 * 1000); // then daily
}

// Daily cleanup of expired demo accounts (DEMO type, expiresAt < now).
// Writes ExpiredAccount history, notifies the client, then hard-deletes.
// Also sends 3-day and 1-day advance warnings.
async function demoCleanupTick() {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/cron/demo-cleanup", { method: "POST", headers: CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {} });
    const d = await res.json().catch(() => ({}));
    if (d && (d.deleted || d.warned)) console.log("[demo-cleanup] deleted=" + (d.deleted || 0) + " warned=" + (d.warned || 0));
  } catch (e) { /* transient — retried next day */ }
}
function startDemoCleanup() {
  setTimeout(demoCleanupTick, 7 * 60 * 1000); // 7 min after boot (after trial cleanup)
  setInterval(demoCleanupTick, 24 * 60 * 60 * 1000); // then daily
}

app.prepare().then(async () => {
  try { await loadCatalog(); } catch (e) { console.error('[feed] catalog load failed:', e.message); }
  try { await loadSpreads(); setInterval(loadSpreads, 60000); } catch (e) { console.error('[spreads] initial load failed:', e.message); }
  const server = createServer((req, res) => handle(req, res));
  const io = new Server(server, { path: "/socket.io" });
  global.__io = io;
  const sub = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  sub.subscribe("cubex:refresh", "cubex:feeds", "cubex:catalog", "cubex:spreads").catch(() => {});
  sub.on("message", (ch, msg) => {
    if (ch === "cubex:refresh" && global.__io) { try { global.__io.emit("refresh", JSON.parse(msg)); } catch (e) { global.__io.emit("refresh", {}); } }
    else if (ch === "cubex:feeds") { (async () => { await loadFeedConfig(); reconnectFeeds(); console.log("[feed] reloaded from SuperAdmin"); })().catch((e) => console.error("[feed] reload failed:", e.message)); }
    else if (ch === "cubex:catalog") { loadCatalog().then(() => console.log("[feed] catalog hot-reloaded:", symbols.length, "symbols")).catch((e) => console.error("[feed] catalog reload failed:", e.message)); }
    else if (ch === "cubex:spreads") { loadSpreads().catch(() => {}); }
  });
  io.on("connection", (socket) => {
    // Only send enabled symbols — disabled stocks have no market-watch clients
    const h = {}; for (const s of symbols) { if (meta[s]?.enabled) h[s] = state[s].candles; } socket.emit("history", h);
    // Snapshot of current prices so clients (incl. for FROZEN/closed markets) know the
    // latest price immediately — open positions then show their real last P&L, not 0.
    const px = {}; for (const s of symbols) { const st = state[s]; if (st && st.price != null) px[s] = st.price; }
    socket.emit("prices", px);
    // Presence tracking + tenant room — CLIENT and MANAGER sessions count toward online/offline
    const sess = sessionFromSocket(socket);
    if (sess && sess.tenantId) {
      socket.join("t:" + sess.tenantId); // tenant room for spread + refresh broadcasts
      // Send current spread data immediately on connect so client has fresh spreads
      const tenantSpreads = {};
      for (const [k, v] of Object.entries(symSpreads)) {
        if (k.startsWith(sess.tenantId + ":")) tenantSpreads[k.slice(sess.tenantId.length + 1)] = v;
      }
      if (Object.keys(tenantSpreads).length) socket.emit("sym-spreads", tenantSpreads);
      if (sess.role === "CLIENT" || sess.role === "MANAGER") {
        presenceConnect(socket, sess);
        socket.on("disconnect", () => presenceDisconnect(socket));
      }
    }
  });
  await seedFromRedis();        // resume last-known prices (survives restarts)
  await loadFeedConfig();       // keys + primary from SuperAdmin (DB overrides env)
  connectBinance();    // crypto real bid/ask — free, no key
  connectKraken();     // forex + metals real bid/ask — free, no key
  connectFinnhub();
  connectTD();
  if (MASSIVE_KEY) { connectMassive(); connectMassiveCrypto(); }
  // Delay initial REST poll so WS can connect and subscribe first (avoids rate-limit spike on boot)
  setTimeout(pollPrices, 15000);
  setTimeout(pollFinnhubQuotes, 10000);
  setTimeout(ensureSeeded, 4000); // after feeds connect, seed anything still unpriced
  // REST poll is a fallback only — WebSocket handles real-time. Poll slowly to stay under rate limit.
  // 57 symbols × 1 credit = 57 credits per call. At 60s: 57/min → leaves ~550/min for WS + overhead.
  setInterval(pollPrices, 60000);
  setInterval(pollFinnhubQuotes, 30000); // Quote fallback so prices stay real if the WS is quiet
  setInterval(microTick, 140);
  setInterval(() => monitor(io), MONITOR_MS);
  setInterval(() => checkPending(io), 2000);
  setInterval(() => checkPriceAlerts(io), 5000); // price alert monitor every 5s
  startSwapCron(io);
  startStatementCron();
  startTrialCleanup();
  startDemoCleanup();
  startBillingCron();
  purgeOldNotifications();                                  // on boot
  setInterval(purgeOldNotifications, 6 * 60 * 60 * 1000);   // + every 6h
  server.listen(port, () => console.log("> Ready on http://localhost:" + port));
});

