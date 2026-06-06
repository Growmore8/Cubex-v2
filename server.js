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

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const prisma = new PrismaClient();
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";
const TD_KEY = process.env.TWELVEDATA_KEY || process.env.TD_API_KEY || process.env.TD_KEY || "";

const CANDLE_MS = 5000, HISTORY = 300, MONITOR_MS = 2000;
const state = {}, meta = {}, feedToSym = {}, tdToSym = {}, fhLast = {};
let symbols = [];

function r(v, d) { return Number(v.toFixed(d)); }
function bucketStart(ms) { return Math.floor(ms / CANDLE_MS) * CANDLE_MS; }

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
  return 100000;
}
function toTD(sym, cat) {
  if (cat === "crypto" || sym.endsWith("USDT")) return sym.replace(/USDT$/, "") + "/USD";
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
    state[x.symbol] = { price: null, candles: [], bucket: 0 };
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
  if (DERIVED_SET.has(sym)) return; // derived symbols are computed, never fed externally
  // TwelveData is primary; Finnhub is a fallback only when TD hasn't priced recently.
  if (source === "FH" && fhLast["__td_" + sym] && Date.now() - fhLast["__td_" + sym] < 12000) return;
  if (source === "TD") fhLast["__td_" + sym] = Date.now();
  const d = meta[sym].digits, p = r(price, d), st = state[sym];
  st.target = p;
  if (st.price == null) commitPrice(sym, p); // first price for this symbol: show at once
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
  if (global.__io) global.__io.emit("tick", { symbol: sym, price: p, candle });
  recomputeDerived(sym);
}

let fhWs = null;
function connectFinnhub() {
  if (!FINNHUB_KEY) { console.log("[FH] no key"); return; }
  fhWs = new WebSocket("wss://ws.finnhub.io?token=" + FINNHUB_KEY);
  fhWs.on("open", () => { let n = 0; for (const s of symbols) { const f = meta[s].feed; if (!f) continue; try { fhWs.send(JSON.stringify({ type: "subscribe", symbol: f })); n++; } catch (e) {} } console.log("[FH] connected, subscribed", n); });
  fhWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.type === "trade" && m.data) for (const tk of m.data) { const s = feedToSym[tk.s]; if (s) applyPrice(s, parseFloat(tk.p), "FH"); } } catch (e) {} });
  fhWs.on("close", () => { setTimeout(connectFinnhub, 5000); });
  fhWs.on("error", (e) => console.error("[FH]", e.message));
}
let tdWs = null;
function connectTD() {
  if (!TD_KEY) { console.log("[TD] no key"); return; }
  tdWs = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + TD_KEY);
  tdWs.on("open", () => { try { const subs = symbols.filter((s) => !DERIVED_SET.has(s)).map((s) => meta[s].td); tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: subs.join(",") } })); } catch (e) {} console.log("[TD] connected, subscribing", symbols.filter((s) => !DERIVED_SET.has(s)).length); });
  tdWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.event === "price" && m.price) { const s = tdToSym[m.symbol]; if (s) applyPrice(s, parseFloat(m.price), "TD"); } } catch (e) {} });
  tdWs.on("close", () => { setTimeout(connectTD, 5000); });
  tdWs.on("error", (e) => console.error("[TD]", e.message));
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
    const d = (meta[sym] && meta[sym].digits) || 2;
    const step = Math.pow(10, -d);
    let np;
    if (st.target != null && st.target !== st.price) {
      // Walk toward the latest true (or computed) price one point at a time. Only
      // a very large gap (a genuine fast move) is allowed to snap, to bound lag.
      const gapPts = Math.round((st.target - st.price) / step);
      np = Math.abs(gapPts) > 200 ? st.target : r(st.price + Math.sign(gapPts) * step, d);
    } else if (!DERIVED_SET.has(sym)) {
      // Base symbol caught up to its real price: idle jitter with momentum so the
      // last digit keeps ticking instead of freezing.
      if (st.drift == null) st.drift = Math.random() < 0.5 ? -1 : 1;
      const rr = Math.random();
      if (rr < 0.12) st.drift = -st.drift; // reverse direction
      else if (rr < 0.30) continue;        // pause this tick (no change)
      np = r(st.price + st.drift * step, d);
    } else {
      continue; // derived symbol caught up: hold until a base moves it again
    }
    if (np > 0) commitPrice(sym, np);
  }
}

// Shared P&L: $1/pip/lot for forex (USD quote); USD-base converted via rate;
// metals/crypto/indices keep contract model. Mirrors src/lib/trademath.ts.
function calcPnl(symbol, type, openPrice, price, lots) {
  const sym = String(symbol || "");
  const dir = type === "BUY" ? 1 : -1;
  const diff = (price - openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  if (isFx) {
    const pip = /JPY$/i.test(sym) ? 0.01 : 0.0001;
    let pf = (diff / pip) * lots;
    if (/^USD/i.test(sym)) pf = pf / (price || 1);
    return pf;
  }
  const m = meta[sym] || { contract: 100000 };
  return diff * lots * m.contract;
}
async function liquidate(acc, list, io) {
  let total = 0;
  for (const t of list) {
    const price = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice);
    const pnl = calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots));
    total += pnl;
    await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: acc.id, symbol: t.symbol, side: t.type, lots: t.lots, openPrice: t.openPrice, closePrice: price, sl: t.sl, tp: t.tp, pnl: pnl, closeReason: "MC", openedAt: t.openedAt } });
    await prisma.trade.delete({ where: { id: t.id } });
  }
  await prisma.account.update({ where: { id: acc.id }, data: { pnl: { increment: total } } });
  if (acc.userId) await prisma.notification.create({ data: { tenantId: acc.tenantId, userId: acc.userId, title: "Stop out", body: "Positions liquidated at margin call" } }).catch(() => {});
  io.emit("liquidation", { accountId: acc.id, login: acc.login });
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
        const price = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice);
        floating += calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots));
        net[t.symbol] = (net[t.symbol] || 0) + (t.type === "BUY" ? 1 : -1) * Number(t.lots); // hedged net lots
      }
      // used margin charged on |net| volume per symbol (full hedge => 0)
      let used = 0;
      for (const sym in net) {
        const nl = Math.abs(net[sym]); if (nl < 1e-9) continue;
        const m = meta[sym]; if (!m) continue;
        const price = state[sym] && state[sym].price ? state[sym].price : Number((list.find((t) => t.symbol === sym) || {}).openPrice || 0);
        let mg = (nl * m.contract * price) / acc.leverage; if (/JPY$/i.test(sym)) mg = mg / 100; used += mg;
      }
      if (used <= 0) continue;
      if (((balance + floating) / used) * 100 <= mc) await liquidate(acc, list, io);
    }
  } catch (e) {}
}

async function checkPending(io) {
  try {
    const pend = await prisma.pendingOrder.findMany({ include: { account: true } });
    for (const o of pend) {
      const st = state[o.symbol];
      if (!st || st.price == null) continue;
      const px = st.price, trig = Number(o.price);
      if (!trig) continue;
      let fill = false;
      if (o.side === "BUY" && o.kind === "LIMIT") fill = px <= trig;
      else if (o.side === "BUY" && o.kind === "STOP") fill = px >= trig;
      else if (o.side === "SELL" && o.kind === "LIMIT") fill = px >= trig;
      else if (o.side === "SELL" && o.kind === "STOP") fill = px <= trig;
      if (!fill) continue;
      const ticket = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      await prisma.trade.create({ data: { ticket, accountId: o.accountId, symbol: o.symbol, type: o.side, lots: o.lots, openPrice: px, sl: o.sl, tp: o.tp } });
      await prisma.pendingOrder.delete({ where: { id: o.id } });
      if (o.account && o.account.userId) await prisma.notification.create({ data: { tenantId: o.account.tenantId, userId: o.account.userId, title: "Pending order filled", body: o.symbol + " " + o.side + " " + Number(o.lots) + " @ " + px } }).catch(() => {});
      io.emit("refresh", {});
    }
  } catch (e) {}
}
// REST price poller — TD WebSocket only streams a subset of symbols on most
// plans, so we batch-poll /price for every base symbol. One request covers all;
// derived symbols recompute automatically from the base prices.
async function pollChunk(chunk) {
  // chunk: array of internal symbols. Map to TD symbols (dedupe), fetch, apply.
  const tdByInternal = {};
  for (const s of chunk) tdByInternal[s] = meta[s].td;
  const uniqTd = Array.from(new Set(chunk.map((s) => meta[s].td)));
  try {
    const url = "https://api.twelvedata.com/price?symbol=" + encodeURIComponent(uniqTd.join(",")) + "&apikey=" + TD_KEY;
    const res = await fetch(url);
    const data = await res.json();
    if (!data) return;
    // Single-symbol response: { price: "..." }
    if (data.price && uniqTd.length === 1) {
      for (const s of chunk) if (meta[s].td === uniqTd[0]) applyPrice(s, parseFloat(data.price), "TD");
      return;
    }
    for (const s of chunk) {
      const entry = data[meta[s].td];
      if (entry && entry.price) { const p = parseFloat(entry.price); if (p > 0) applyPrice(s, p, "TD"); }
    }
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

app.prepare().then(async () => {
  try { await loadCatalog(); } catch (e) { console.error('[feed] catalog load failed:', e.message); }
  const server = createServer((req, res) => handle(req, res));
  const io = new Server(server, { path: "/socket.io" });
  global.__io = io;
  const sub = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  sub.subscribe("cubex:refresh").catch(() => {});
  sub.on("message", (ch, msg) => { if (ch === "cubex:refresh" && global.__io) { try { global.__io.emit("refresh", JSON.parse(msg)); } catch (e) { global.__io.emit("refresh", {}); } } });
  io.on("connection", (socket) => { const h = {}; for (const s of symbols) h[s] = state[s].candles; socket.emit("history", h); });
  await seedFromRedis();        // resume last-known prices (survives restarts)
  connectFinnhub();
  connectTD();
  pollPrices();
  setTimeout(ensureSeeded, 8000); // after feeds connect, seed anything still unpriced
  setInterval(pollPrices, 5000);
  setInterval(microTick, 140);
  setInterval(() => monitor(io), MONITOR_MS);
  setInterval(() => checkPending(io), 2000);
  server.listen(port, () => console.log("> Ready on http://localhost:" + port));
});

