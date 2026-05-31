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
const TD_KEY = process.env.TWELVEDATA_KEY || "";

const CANDLE_MS = 5000, HISTORY = 300, MONITOR_MS = 2000;
const state = {}, meta = {}, feedToSym = {}, tdToSym = {}, fhLast = {};
let symbols = [];

function r(v, d) { return Number(v.toFixed(d)); }
function bucketStart(ms) { return Math.floor(ms / CANDLE_MS) * CANDLE_MS; }
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

async function loadCatalog() {
  const rows = await prisma.globalSymbol.findMany({ where: { enabled: true } });
  symbols = rows.map((x) => x.symbol);
  for (const x of rows) {
    const td = toTD(x.symbol, x.category);
    meta[x.symbol] = { digits: x.digits || 5, contract: contractFor(x.category, x.symbol), feed: x.feed || null, td };
    state[x.symbol] = { price: null, candles: [], bucket: 0 };
    if (x.feed) feedToSym[x.feed] = x.symbol;
    tdToSym[td] = x.symbol;
  }
  console.log("[feed] catalog loaded:", symbols.length, "symbols");
}

function applyPrice(sym, price, source) {
  if (!state[sym] || !price || isNaN(price) || price <= 0) return;
  if (source === "TD" && fhLast[sym] && Date.now() - fhLast[sym] < 6000) return; // prefer Finnhub
  if (source === "FH") fhLast[sym] = Date.now();
  const d = meta[sym].digits, p = r(price, d), st = state[sym], now = Date.now(), b = bucketStart(now);
  let candle = st.candles[st.candles.length - 1];
  if (!candle || b !== st.bucket) {
    candle = { time: Math.floor(b / 1000), open: p, high: p, low: p, close: p };
    st.candles.push(candle); if (st.candles.length > HISTORY) st.candles.shift(); st.bucket = b;
  } else { candle.high = Math.max(candle.high, p); candle.low = Math.min(candle.low, p); candle.close = p; }
  st.price = p;
  redis.set("price:" + sym, String(p));
  if (global.__io) global.__io.emit("tick", { symbol: sym, price: p, candle });
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
  tdWs.on("open", () => { try { tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: symbols.map((s) => meta[s].td).join(",") } })); } catch (e) {} console.log("[TD] connected, subscribing", symbols.length); });
  tdWs.on("message", (data) => { try { const m = JSON.parse(data); if (m.event === "price" && m.price) { const s = tdToSym[m.symbol]; if (s) applyPrice(s, parseFloat(m.price), "TD"); } } catch (e) {} });
  tdWs.on("close", () => { setTimeout(connectTD, 5000); });
  tdWs.on("error", (e) => console.error("[TD]", e.message));
}

async function liquidate(acc, list, io) {
  let total = 0;
  for (const t of list) {
    const m = meta[t.symbol] || { contract: 100000, digits: 5 };
    const price = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice);
    const dir = t.type === "BUY" ? 1 : -1, pnl = (price - Number(t.openPrice)) * dir * Number(t.lots) * m.contract;
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
      for (const t of list) { const m = meta[t.symbol]; if (!m) continue; const price = state[t.symbol] && state[t.symbol].price ? state[t.symbol].price : Number(t.openPrice); const dir = t.type === "BUY" ? 1 : -1; floating += (price - Number(t.openPrice)) * dir * Number(t.lots) * m.contract; used += (Number(t.lots) * m.contract * price) / acc.leverage; }
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
  setInterval(() => monitor(io), MONITOR_MS);
  setInterval(() => checkPending(io), 2000);
  server.listen(port, () => console.log("> Ready on http://localhost:" + port));
});

