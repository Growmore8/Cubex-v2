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
let CRYPTO_FEED = "BN";   // BN | KR | TD | FH
let FOREX_FEED  = "TD";   // KR | TD | MV | FH
let COMM_FEED   = "TD";   // KR | TD  (commodities = metals + energy)
let IDX_FEED    = "TD";   // TD | FH  (indices)
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
    const ws = new (require("ws"))("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + TD_KEY, { headers: { "Origin": "https://twelvedata.com" } });
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
const CRYPTO_SYM_SET = new Set(["BTCUSD","ETHUSD","BNBUSD","SOLUSD","DOGEUSD","XRPUSD","ADAUSD","AVAXUSD","LINKUSD","LTCUSD","DOTUSD"]);
const INDEX_SYM_SET  = new Set(["US500","US30","US100","GER40","UK100","JP225","HK50","FRA40"]);
const ENERGY_SYM_SET = new Set(["USOIL","UKOIL","NATGAS"]);
function getSymCategory(sym) {
  if (CRYPTO_SYM_SET.has(sym)) return "crypto";
  if (INDEX_SYM_SET.has(sym))  return "indices";
  if (ENERGY_SYM_SET.has(sym)) return "commodities";
  if (/^(XAU|XAG|XPT|XPD|GAU|XAGG)/.test(sym)) return "commodities";
  return "forex";
}
function getCatFeed(cat) {
  if (cat === "crypto")      return CRYPTO_FEED;
  if (cat === "indices")     return IDX_FEED;
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
    if (["BN","KR","TD","FH"].includes(v.cryptoFeed))  CRYPTO_FEED = v.cryptoFeed;
    if (["KR","TD","MV","FH"].includes(v.forexFeed))   FOREX_FEED  = v.forexFeed;
    if (["KR","TD"].includes(v.commFeed))               COMM_FEED   = v.commFeed;
    if (["TD","FH"].includes(v.idxFeed))                IDX_FEED    = v.idxFeed;
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
  for (const [ws, name] of [[tdWs,"TD"],[fhWs,"FH"],[mvWs,"MV"],[bnWs,"BN"],[krWs,"KR"]]) {
    try { if (ws) { ws.removeAllListeners(); ws.close(); } } catch (e) {}
  }
  tdWs = null; fhWs = null; mvWs = null; bnWs = null; krWs = null;
  connectFinnhub();
  connectTD();
  connectBinance();
  connectKraken();
  if (MASSIVE_KEY) connectMassive();
}

const CANDLE_MS = 5000, HISTORY = 300, MONITOR_MS = 2000;
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
  for (const ds of list) {
    if (!state[ds]) continue; // only if present in catalog
    const def = DERIVED[ds];
    if (def.d.some((dep) => g[dep] == null)) continue;
    try { applyDerived(ds, def.f(g)); } catch (e) {}
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
  const rows = await prisma.globalSymbol.findMany({ where: { enabled: true } });
  symbols = rows.map((x) => x.symbol);
  for (const x of rows) {
    const td = toTD(x.symbol, x.category);
    // Finnhub fallback feed (skip derived/calculated symbols)
    const fh = x.feed || (DERIVED_SET.has(x.symbol) ? null : toFinnhub(x.symbol, x.category));
    meta[x.symbol] = { digits: x.digits || 5, contract: contractFor(x.category, x.symbol), feed: fh, td, cat: x.category };
    state[x.symbol] = { price: null, bid: null, candles: [], bucket: 0 };
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
  if (st.bid != null) { redis.set("bid:" + sym, String(st.bid)); realBids[sym] = st.bid; } // real bid for trade execution
  // `price` is the smooth DISPLAY value (lively market watch); `real` is the true
  // feed price (the chart builds its candles from this so they match the market,
  // while the ticker stays smooth). Falls back to the display when no live feed.
  const real = (st.realAt && Date.now() - st.realAt < REAL_TTL && st.target != null) ? st.target : p;
  if (global.__io) global.__io.emit("tick", { symbol: sym, price: p, bid: st.bid ?? null, real, candle });
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
const BN_SYM = {
  BTCUSD: "btcusdt", ETHUSD: "ethusdt", BNBUSD: "bnbusdt", SOLUSD: "solusdt", DOGEUSD: "dogeusdt",
  XRPUSD: "xrpusdt", ADAUSD: "adausdt", AVAXUSD: "avaxusdt", LINKUSD: "linkusdt", LTCUSD: "ltcusdt", DOTUSD: "dotusdt",
};
const BN_TO_SYM = Object.fromEntries(Object.entries(BN_SYM).map(([k, v]) => [v.toUpperCase(), k]));
// Digit overrides for assets where default digits cause pip > price or loss of precision
const BN_DIGITS = { DOGEUSD: 5, SOLUSD: 3, XRPUSD: 4, ADAUSD: 4, DOTUSD: 3, LINKUSD: 3, AVAXUSD: 2, LTCUSD: 2 };
let bnWs = null;
function connectBinance() {
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
        const digits = BN_DIGITS[sym] || (meta[sym] ? meta[sym].digits : 2);
        if (meta[sym]) meta[sym].digits = digits;
        state[sym].bid = r(bid, digits);
        applyPrice(sym, ask, "BN");
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
  // Only connect if at least one category uses Kraken
  if (!["KR"].some(k => [CRYPTO_FEED, FOREX_FEED, COMM_FEED].includes(k))) return;
  if (krWs) { try { krWs.removeAllListeners(); krWs.terminate(); } catch (_) {} krWs = null; }
  if (krPingTimer) { clearInterval(krPingTimer); krPingTimer = null; }
  krWs = new WebSocket("wss://ws.kraken.com");
  krWs.on("open", () => {
    const pairs = [
      ...(FOREX_FEED === "KR" ? KR_FOREX_PAIRS : []),
      ...(COMM_FEED  === "KR" ? KR_METAL_PAIRS : []),
      ...(CRYPTO_FEED=== "KR" ? KR_CRYPTO_PAIRS : []),
    ];
    if (!pairs.length) return;
    krWs.send(JSON.stringify({ event: "subscribe", pair: pairs, subscription: { name: "spread" } }));
    console.log("[KR] connected, subscribed spread for", pairs.length, "pairs");
    // Kraken requires a ping every 30s to keep the connection alive
    krPingTimer = setInterval(() => {
      if (krWs && krWs.readyState === 1) krWs.send(JSON.stringify({ event: "ping" }));
    }, 25000);
  });
  krWs.on("message", (data) => {
    try {
      const m = JSON.parse(data);
      // Log subscription status so we can see which pairs Kraken accepts/rejects
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
          state[sym].bid = r(bid, meta[sym] ? meta[sym].digits : 5);
          applyPrice(sym, ask, "KR");
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
// Docs: https://massive.com/docs/websocket/forex/quotes
// Endpoint: wss://<base>/forex/C?ticker=EUR-USD,GBP-USD&apikey=KEY
// Message:  {"ev":"C","p":"EUR/USD","b":1.0856,"a":1.0858,"t":...}
let mvWs = null;
let MV_BASE_URL = process.env.MASSIVE_WS_URL || "wss://socket.massive.com"; // override via env if different
// Internal symbol → Massive ticker (dash format)
const MV_TICKERS = {
  EURUSD:"EUR-USD",GBPUSD:"GBP-USD",AUDUSD:"AUD-USD",NZDUSD:"NZD-USD",
  USDCAD:"USD-CAD",USDCHF:"USD-CHF",USDJPY:"USD-JPY",
  EURGBP:"EUR-GBP",EURJPY:"EUR-JPY",EURCAD:"EUR-CAD",EURCHF:"EUR-CHF",
  GBPJPY:"GBP-JPY",GBPCHF:"GBP-CHF",AUDJPY:"AUD-JPY",
  AUDNZD:"AUD-NZD",AUDCAD:"AUD-CAD",NZDJPY:"NZD-JPY",
  USDHKD:"USD-HKD",USDSGD:"USD-SGD",USDTRY:"USD-TRY",USDIDR:"USD-IDR",
  USDMXN:"USD-MXN",USDZAR:"USD-ZAR",GBPAUD:"GBP-AUD",GBPCAD:"GBP-CAD",
  GBPNZD:"GBP-NZD",EURNZD:"EUR-NZD",EURAUD:"EUR-AUD",CADCHF:"CAD-CHF",
  CADJPY:"CAD-JPY",CHFJPY:"CHF-JPY",NZDCAD:"NZD-CAD",NZDCHF:"NZD-CHF",
};
// Reverse: "EUR/USD" → "EURUSD"
const MV_MSG_TO_SYM = {};
for (const [sym, tick] of Object.entries(MV_TICKERS)) MV_MSG_TO_SYM[tick.replace("-", "/")] = sym;

function connectMassive() {
  if (!MASSIVE_KEY) return;
  if (mvWs) { try { mvWs.removeAllListeners(); mvWs.terminate(); } catch (_) {} mvWs = null; }
  const tickers = Object.values(MV_TICKERS).join(",");
  const url = `${MV_BASE_URL}/forex/C?ticker=${encodeURIComponent(tickers)}&apikey=${MASSIVE_KEY}`;
  mvWs = new WebSocket(url);
  mvWs.on("open", () => console.log("[MV] connected, streaming", Object.keys(MV_TICKERS).length, "forex pairs"));
  mvWs.on("message", (data) => {
    try {
      const msgs = JSON.parse(data);
      for (const m of (Array.isArray(msgs) ? msgs : [msgs])) {
        if (m.ev === "C" && m.b != null && m.a != null) {
          const sym = MV_MSG_TO_SYM[m.p];
          if (sym && state[sym]) {
            state[sym].bid = r(parseFloat(m.b), meta[sym] ? meta[sym].digits : 5);
            applyPrice(sym, parseFloat(m.a), "MV");
          }
        }
      }
    } catch (e) {}
  });
  mvWs.on("close", () => { console.log("[MV] closed"); recordFeedFailure("MV"); setTimeout(() => { if (MASSIVE_KEY) connectMassive(); }, 5000); });
  mvWs.on("error", (e) => { console.error("[MV]", e.message); recordFeedFailure("MV"); });
}

let tdWs = null;
let tdWsFail200 = 0; // consecutive WS handshake failures
function connectTD() {
  if (!TD_KEY) { console.log("[TD] no key"); return; }
  if (tdWsFail200 >= 5) return; // give up after 5 failed attempts — REST poller covers prices
  // Close previous connection before creating a new one to avoid exhausting the 3-connection limit
  if (tdWs) { try { tdWs.removeAllListeners(); tdWs.terminate(); } catch (_) {} tdWs = null; }
  tdWs = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + TD_KEY, { headers: { "Origin": "https://twelvedata.com" } });
  tdWs.on("open", () => { tdWsFail200 = 0; primaryFailCount = 0; try { const subs = symbols.filter((s) => !DERIVED_SET.has(s)).map((s) => meta[s].td); tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: subs.join(",") } })); } catch (e) {} console.log("[TD] connected, subscribing", symbols.filter((s) => !DERIVED_SET.has(s)).length); });
  tdWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.event === "price" && m.price) { const s = tdToSym[m.symbol]; if (s) { const ask = parseFloat(m.ask || m.price); const bid = parseFloat(m.bid || 0); if (bid > 0 && bid < ask) state[s].bid = r(bid, meta[s].digits); applyPrice(s, ask, "TD"); recordFeedSuccess("TD"); } } } catch (e) {} });
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
    const px = {}; const bids = {};
    for (const s of symbols) { const st = state[s]; if (st && st.price != null) { px[s] = st.price; if (st.bid != null) bids[s] = st.bid; } }
    global.__io.emit("prices", px);
    if (Object.keys(bids).length) global.__io.emit("bids", bids);
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
  for (const sym of symbols) {
    const st = state[sym];
    if (!st || st.price == null) continue;
    if (!isMarketOpen(sym, meta[sym] && meta[sym].cat)) continue; // market closed → freeze price
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

// Spread cache: symbol (with floating support), group, and per-account markups.
// symSpreads: "tenantId:symbol" → { min, max, type }
// grpSpreads: groupId → pips
// accMarkups: accountId → pips
// realBids: symbol → latest real bid from exchange (Kraken/Binance), updated every tick
const symSpreads = {};
const grpSpreads = {};
const accMarkups = {};
const realBids = {};
async function loadSpreads() {
  try {
    const syms = await prisma.symbol.findMany({ select: { tenantId: true, symbol: true, spread: true, spreadType: true, spreadMax: true } });
    const tenantSpreadMap = {}; // tenantId → { symbol → {min,max,type} }
    for (const s of syms) {
      symSpreads[s.tenantId + ":" + s.symbol] = { min: Number(s.spread || 0), max: Number(s.spreadMax || 0), type: s.spreadType || "FLOATING" };
      if (!tenantSpreadMap[s.tenantId]) tenantSpreadMap[s.tenantId] = {};
      tenantSpreadMap[s.tenantId][s.symbol] = { min: Number(s.spread || 0), max: Number(s.spreadMax || 0), type: s.spreadType || "FLOATING" };
    }
    const grps = await prisma.tradeGroup.findMany({ select: { id: true, spread: true, spreadType: true } });
    for (const g of grps) grpSpreads[g.id] = Number(g.spread || 0);
    const accs = await prisma.account.findMany({ select: { id: true, spreadMarkup: true } });
    for (const a of accs) accMarkups[a.id] = Number(a.spreadMarkup || 0);
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
  const pips = getSymSpreadPips(tenantId, symbol) + (grpSpreads[groupId] || 0) + (accMarkups[accountId] || 0);
  const digits = (meta[symbol] && meta[symbol].digits) || 5;
  return pips * Math.pow(10, -(digits - 1));
}
function getBid(tenantId, symbol, groupId, accountId, ask) {
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
    await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: t.accountId, symbol: t.symbol, side: t.type, lots: t.lots, openPrice: t.openPrice, closePrice: price, sl: t.sl, tp: t.tp, pnl, closeReason: reason, openedAt: t.openedAt } });
    await prisma.trade.delete({ where: { id: t.id } });
    await prisma.account.update({ where: { id: t.accountId }, data: { pnl: { increment: pnl } } });
    if (t.account && t.account.userId) {
      const title = reason === "TP" ? "Take Profit hit ✓" : "Stop Loss hit";
      const body = `${t.symbol} ${t.type} closed @ ${price} | P/L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
      await prisma.notification.create({ data: { tenantId: t.account.tenantId, userId: t.account.userId, title, body, type: "TRADE" } }).catch(() => {});
      pushToUser(t.account.userId, { title, body }); // push even if app is closed
      await notifyStaffRaw(t.account.tenantId, { title: (reason === "TP" ? "TP hit" : "SL hit") + " — " + (t.account.login || ""), body, type: "TRADE" }, t.account.managerId);
      await prisma.auditLog.create({ data: { tenantId: t.account.tenantId, action: "trade." + (reason === "TP" ? "tp" : "sl"), detail: (t.account.login || "") + " " + body, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
    }
    io.emit("refresh", {});
    io.emit("refresh", { kind: "notification" }); // make client + staff reload notifs (sound + toast)
    console.log("[" + reason + "]", t.symbol, t.type, Number(t.lots) + "L @ " + price, "P/L", calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots)).toFixed(2));
  } catch (e) { console.error("[tp/sl close]", e); } finally { closing.delete(t.id.toString()); }
}

async function liquidate(acc, list, io) {
  if (liquidating.has(acc.id)) return;
  liquidating.add(acc.id);
  try {
    let total = 0;
    for (const t of list) {
      const ask = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice);
      const price = t.type === "BUY" ? getBid(acc.tenantId, t.symbol, acc.groupId, acc.id, ask) : ask;
      const pnl = calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots));
      total += pnl;
      await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: acc.id, symbol: t.symbol, side: t.type, lots: t.lots, openPrice: t.openPrice, closePrice: price, sl: t.sl, tp: t.tp, pnl: pnl, closeReason: "MC", openedAt: t.openedAt } });
      await prisma.trade.delete({ where: { id: t.id } });
    }
    await prisma.account.update({ where: { id: acc.id }, data: { pnl: { increment: total } } });
    const body = acc.login + " margin call — " + list.length + " trade(s) closed, P/L " + total.toFixed(2);
    if (acc.userId) { await prisma.notification.create({ data: { tenantId: acc.tenantId, userId: acc.userId, title: "Stop out", body: "Positions liquidated at margin call", type: "TRADE" } }).catch(() => {}); pushToUser(acc.userId, { title: "Stop out", body: "Positions liquidated at margin call" }); }
    await notifyStaffRaw(acc.tenantId, { title: "⚠ Margin call — " + acc.login, body, type: "TRADE" }, acc.managerId);
    await prisma.auditLog.create({ data: { tenantId: acc.tenantId, action: "account.liquidated", detail: body, performedBy: "SYSTEM", category: "CLIENT" } }).catch(() => {});
    io.emit("liquidation", { accountId: acc.id, login: acc.login });
    io.emit("refresh", {});
    io.emit("refresh", { kind: "notification" }); // client + staff reload notifs (sound + toast)
    console.log("[MC] liquidated", acc.login, list.length, "trades, total P/L:", total.toFixed(2));
  } catch (e) { console.error("[liquidate]", e); } finally { liquidating.delete(acc.id); }
}
async function monitor(io) {
  try {
    const trades = await prisma.trade.findMany({ include: { account: true } });
    const byAcc = {};
    for (const t of trades) (byAcc[t.accountId] || (byAcc[t.accountId] = { acc: t.account, list: [] })).list.push(t);
    for (const id of Object.keys(byAcc)) {
      const { acc, list } = byAcc[id]; const mc = Number(acc.mcLevel);
      if (!(mc > 0) || acc.doNotLiquidate) continue;
      const balance = Number(acc.deposit) - Number(acc.withdrawal) + Number(acc.credit) + Number(acc.bonus) + Number(acc.pnl);
      let floating = 0;
      const net = {};
      for (const t of list) {
        const m = meta[t.symbol]; if (!m) continue;
        const ask = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice);
        // BUY P/L uses bid (ask − spread); SELL P/L uses ask
        const closePrice = t.type === "BUY" ? getBid(acc.tenantId, t.symbol, acc.groupId, acc.id, ask) : ask;
        floating += calcPnl(t.symbol, t.type, Number(t.openPrice), closePrice, Number(t.lots));
        net[t.symbol] = (net[t.symbol] || 0) + (t.type === "BUY" ? 1 : -1) * Number(t.lots);
      }
      let used = 0;
      for (const sym in net) {
        const nl = Math.abs(net[sym]); if (nl < 1e-9) continue;
        const m = meta[sym]; if (!m) continue;
        const ask = state[sym] && state[sym].price ? state[sym].price : Number((list.find((t) => t.symbol === sym) || {}).openPrice || 0);
        let mg = (nl * m.contract * ask) / acc.leverage; if (/JPY$/i.test(sym)) mg = mg / 100; used += mg;
      }
      if (used <= 0) continue;
      if (((balance + floating) / used) * 100 <= mc) await liquidate(acc, list, io);
    }
    // TP/SL: BUY triggered on bid, SELL triggered on ask (MT5 style)
    for (const t of trades) {
      if (closing.has(t.id.toString())) continue;
      const st = state[t.symbol];
      if (!st || st.price == null) continue;
      const ask = st.price;
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
      // Close at bid (BUY) or ask (SELL)
      if (reason) closeTpSl(t, reason, t.type === "BUY" ? bid : ask, io);
    }
  } catch (e) { console.error("[monitor]", e); }
}

async function checkPending(io) {
  try {
    const pend = await prisma.pendingOrder.findMany({ include: { account: true } });
    for (const o of pend) {
      const st = state[o.symbol];
      if (!st || st.price == null) continue;
      const ask = st.price;
      const bid = getBid(o.account.tenantId, o.symbol, o.account.groupId, o.account.id, ask);
      const trig = Number(o.price);
      if (!trig) continue;
      // BUY orders trigger on ask; SELL orders trigger on bid (MT5 style)
      let fill = false;
      if (o.side === "BUY" && o.kind === "LIMIT") fill = ask <= trig;
      else if (o.side === "BUY" && o.kind === "STOP") fill = ask >= trig;
      else if (o.side === "SELL" && o.kind === "LIMIT") fill = bid >= trig;
      else if (o.side === "SELL" && o.kind === "STOP") fill = bid <= trig;
      if (!fill) continue;
      // BUY opens at ask, SELL opens at bid
      const openPx = o.side === "BUY" ? ask : bid;
      const ticket = await nextTicket(o.account.tenantId);
      await prisma.trade.create({ data: { ticket, accountId: o.accountId, symbol: o.symbol, type: o.side, lots: o.lots, openPrice: openPx, sl: o.sl, tp: o.tp } });
      await prisma.pendingOrder.delete({ where: { id: o.id } });
      const pbody = o.symbol + " " + o.side + " " + Number(o.lots) + " @ " + px;
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
        if (bid > 0 && bid < ask) { state[s].bid = r(bid, meta[s].digits); applyPrice(s, ask, "TD"); }
        else { state[s].bid = null; applyPrice(s, ask, "TD"); }
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
  sub.subscribe("cubex:refresh", "cubex:feeds").catch(() => {});
  sub.on("message", (ch, msg) => {
    if (ch === "cubex:refresh" && global.__io) { try { global.__io.emit("refresh", JSON.parse(msg)); } catch (e) { global.__io.emit("refresh", {}); } }
    else if (ch === "cubex:feeds") { (async () => { await loadFeedConfig(); reconnectFeeds(); console.log("[feed] reloaded from SuperAdmin"); })().catch((e) => console.error("[feed] reload failed:", e.message)); }
    else if (ch === "cubex:spreads") { loadSpreads().catch(() => {}); } // admin changed a spread → reload + push
  });
  sub.subscribe("cubex:spreads").catch(() => {});
  io.on("connection", (socket) => {
    const h = {}; for (const s of symbols) h[s] = state[s].candles; socket.emit("history", h);
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
  if (MASSIVE_KEY) connectMassive();
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
  startStatementCron();
  startTrialCleanup();
  startDemoCleanup();
  startBillingCron();
  purgeOldNotifications();                                  // on boot
  setInterval(purgeOldNotifications, 6 * 60 * 60 * 1000);   // + every 6h
  server.listen(port, () => console.log("> Ready on http://localhost:" + port));
});

