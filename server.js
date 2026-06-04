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

function applyDerived(sym, price) {
  const st = state[sym]; if (!st || !price || !isFinite(price) || price <= 0) return;
  const d = (meta[sym] && meta[sym].digits) || 2, p = r(price, d), now = Date.now(), b = bucketStart(now);
  let candle = st.candles[st.candles.length - 1];
  if (!candle || b !== st.bucket) { candle = { time: Math.floor(b / 1000), open: p, high: p, low: p, close: p }; st.candles.push(candle); if (st.candles.length > HISTORY) st.candles.shift(); st.bucket = b; }
  else { candle.high = Math.max(candle.high, p); candle.low = Math.min(candle.low, p); candle.close = p; }
  st.price = p;
  redis.set("price:" + sym, String(p));
  if (global.__io) global.__io.emit("tick", { symbol: sym, price: p, candle });
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
    meta[x.symbol] = { digits: x.digits || 5, contract: contractFor(x.category, x.symbol), feed: fh, td };
    state[x.symbol] = { price: null, candles: [], bucket: 0 };
    if (fh) feedToSym[fh] = x.symbol;
    tdToSym[td] = x.symbol;
  }
  console.log("[feed] catalog loaded:", symbols.length, "symbols");
}

function applyPrice(sym, price, source) {
  if (!state[sym] || !price || isNaN(price) || price <= 0) return;
  if (DERIVED_SET.has(sym)) return; // derived symbols are computed, never fed externally
  // TwelveData is primary; Finnhub is a fallback only when TD hasn't priced recently.
  if (source === "FH" && fhLast["__td_" + sym] && Date.now() - fhLast["__td_" + sym] < 12000) return;
  if (source === "TD") fhLast["__td_" + sym] = Date.now();
  const d = meta[sym].digits, p = r(price, d), st = state[sym], now = Date.now(), b = bucketStart(now);
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
      let floating = 0, used = 0;
      for (const t of list) { const m = meta[t.symbol]; if (!m) continue; const price = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice); floating += calcPnl(t.symbol, t.type, Number(t.openPrice), price, Number(t.lots)); let mg = (Number(t.lots) * m.contract * price) / acc.leverage; if (/JPY$/i.test(t.symbol)) mg = mg / 100; used += mg; }
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
  connectFinnhub();
  connectTD();
  pollPrices();
  setInterval(pollPrices, 5000);
  setInterval(() => monitor(io), MONITOR_MS);
  setInterval(() => checkPending(io), 2000);
  server.listen(port, () => console.log("> Ready on http://localhost:" + port));
});

