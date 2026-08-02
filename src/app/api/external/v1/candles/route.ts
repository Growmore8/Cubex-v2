import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/apiKey";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

// Map standard interval strings to internal tf codes
const INTERVAL_MAP: Record<string, string> = {
  "1m": "1M", "5m": "5M", "15m": "15M", "30m": "30M",
  "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W",
  // also accept uppercase
  "1M": "1M", "5M": "5M", "15M": "15M", "30M": "30M",
  "1H": "1H", "4H": "4H", "1D": "1D", "1W": "1W",
};

const TD_INTERVAL: Record<string, string> = {
  "1M": "1min", "5M": "5min", "15M": "15min", "30M": "30min",
  "1H": "1h", "4H": "4h", "1D": "1day", "1W": "1week",
};

const FH_RES: Record<string, string> = {
  "1M": "1", "5M": "5", "15M": "15", "30M": "30",
  "1H": "60", "4H": "60", "1D": "D", "1W": "W",
};

const MV_TF: Record<string, { mult: number; span: string; msPerBar: number }> = {
  "1M":  { mult: 1,  span: "minute", msPerBar: 60_000 },
  "5M":  { mult: 5,  span: "minute", msPerBar: 300_000 },
  "15M": { mult: 15, span: "minute", msPerBar: 900_000 },
  "30M": { mult: 30, span: "minute", msPerBar: 1_800_000 },
  "1H":  { mult: 1,  span: "hour",   msPerBar: 3_600_000 },
  "4H":  { mult: 4,  span: "hour",   msPerBar: 14_400_000 },
  "1D":  { mult: 1,  span: "day",    msPerBar: 86_400_000 },
  "1W":  { mult: 1,  span: "week",   msPerBar: 604_800_000 },
};

function tdSymbol(sym: string, feed?: string | null): string {
  if (feed && feed.includes("/") && !feed.includes(":")) return feed;
  const s = sym.toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return s.slice(0, 3) + "/" + s.slice(3);
  if (/^(XAU|XAG|XPT|XPD)/.test(s) && s.length >= 6) return s.slice(0, 3) + "/" + s.slice(3);
  if (s.endsWith("USDT")) return s.replace("USDT", "") + "/USD";
  if (s.endsWith("USD") && s.length > 3 && !/^[A-Z]{6}$/.test(s)) return s.slice(0, s.length - 3) + "/USD";
  return s;
}

function mvTicker(symbol: string, cat: string): string | null {
  const s = symbol.toUpperCase();
  if (cat === "crypto") {
    const base = s.endsWith("USDT") ? s.slice(0, -1) : s;
    return `X:${base}`;
  }
  if (cat === "forex" || cat === "commodities") return `C:${s}`;
  return null;
}

function dedupe(arr: any[]) {
  arr.sort((a, b) => a.time - b.time);
  const seen = new Set<number>();
  return arr.filter((c) => isFinite(c.time) && isFinite(c.close) && !seen.has(c.time) && seen.add(c.time));
}

async function getFeedKeys() {
  let td = process.env.TWELVEDATA_KEY || process.env.TD_API_KEY || process.env.TD_KEY || "";
  let fh = process.env.FINNHUB_KEY || "";
  let mv = process.env.MASSIVE_KEY || "";
  let primary = "TD";
  try {
    const rec = await prisma.setting.findUnique({ where: { key: "feeds" } });
    const v: any = (rec && rec.value) || {};
    if (typeof v.tdKey === "string" && v.tdKey.trim()) td = v.tdKey.trim();
    if (typeof v.finnhubKey === "string" && v.finnhubKey.trim()) fh = v.finnhubKey.trim();
    if (typeof v.massiveKey === "string" && v.massiveKey.trim()) mv = v.massiveKey.trim();
    if (v.primary === "TD" || v.primary === "FH") primary = v.primary;
  } catch {}
  return { td, fh, mv, primary };
}

// Public, read-only, server-to-server OHLC endpoint.
// GET /api/external/v1/candles?symbol=EURUSD&interval=1h
// GET /api/external/v1/candles?symbol=XAUUSD&interval=1d&limit=200
// Header: x-api-key: ck_live_xxxxxxxx
//
// Intervals: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w
// limit: number of bars (default 500, max 1000)
//
// Response:
// {
//   "ok": true,
//   "symbol": "EURUSD",
//   "interval": "1h",
//   "candles": [
//     { "time": 1719648000, "open": 1.08450, "high": 1.08620, "low": 1.08380, "close": 1.08520, "volume": 0 },
//     ...
//   ]
// }
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });

  if (!rateLimit(`apikey:candles:${auth.keyId}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  const intervalParam = url.searchParams.get("interval") || "1h";
  const tf = INTERVAL_MAP[intervalParam];
  const limit = Math.min(1000, Math.max(50, Number(url.searchParams.get("limit") || 500)));

  if (!symbol) return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  if (!tf) {
    return NextResponse.json({
      ok: false,
      error: `Invalid interval "${intervalParam}". Supported: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w`,
    }, { status: 400 });
  }

  const [gs, { td: TD_KEY, fh: FH_KEY, mv: MV_KEY, primary }] = await Promise.all([
    prisma.globalSymbol.findUnique({ where: { symbol } }).catch(() => null),
    getFeedKeys(),
  ]);
  const feed = gs?.feed || null;
  const cat = gs?.category || "";

  const getMassive = async (): Promise<any[] | null> => {
    if (!MV_KEY) return null;
    const ticker = mvTicker(symbol, cat);
    if (!ticker) return null;
    const { mult, span, msPerBar } = MV_TF[tf] || MV_TF["1M"];
    const toMs = Date.now();
    const fromMs = toMs - Math.ceil(limit * msPerBar * 1.3);
    const api = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${mult}/${span}/${fromMs}/${toMs}?sort=asc&limit=${limit}&apikey=${MV_KEY}`;
    try {
      const d = await (await fetch(api, { cache: "no-store" })).json();
      if (!d || d.status === "ERROR" || !Array.isArray(d.results) || !d.results.length) return null;
      const out = d.results.map((r: any) => ({
        time: Math.floor(r.t / 1000), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v ?? 0),
      })).filter((c: any) => isFinite(c.time) && isFinite(c.close));
      return dedupe(out).length ? dedupe(out) : null;
    } catch { return null; }
  };

  const getTD = async (): Promise<any[] | null> => {
    if (!TD_KEY) return null;
    const tdSym = tdSymbol(symbol, feed);
    const interval = TD_INTERVAL[tf] || "1h";
    const api = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${interval}&outputsize=${limit}&order=ASC&timezone=UTC&format=JSON&apikey=${TD_KEY}`;
    try {
      const d = await (await fetch(api, { cache: "no-store" })).json();
      if (!d || d.status === "error" || !Array.isArray(d.values)) return null;
      const out = d.values.map((v: any) => {
        const dt = String(v.datetime);
        const iso = dt.includes(" ") ? dt.replace(" ", "T") + "Z" : dt + "T00:00:00Z";
        return { time: Math.floor(new Date(iso).getTime() / 1000), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume ?? 0) };
      });
      const clean = dedupe(out);
      return clean.length ? clean : null;
    } catch { return null; }
  };

  const getFH = async (): Promise<any[] | null> => {
    if (!feed || !feed.includes(":") || !FH_KEY) return null;
    const res = FH_RES[tf === "4H" ? "1H" : tf] || "1";
    const secPer: Record<string, number> = { "1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400 };
    const to = Math.floor(Date.now() / 1000);
    const from = to - (secPer[res] || 60) * limit;
    const kind = feed.startsWith("OANDA:") ? "forex" : "stock";
    const api = `https://finnhub.io/api/v1/${kind}/candle?symbol=${encodeURIComponent(feed)}&resolution=${res}&from=${from}&to=${to}&token=${FH_KEY}`;
    try {
      const r = await fetch(api, { cache: "no-store" });
      const d = await r.json();
      if (!d || d.s !== "ok" || !Array.isArray(d.t)) return null;
      const raw = d.t.map((t: number, i: number) => ({ time: t, open: Number(d.o[i]), high: Number(d.h[i]), low: Number(d.l[i]), close: Number(d.c[i]), volume: Number(d.v?.[i] ?? 0) }))
        .filter((c: any) => isFinite(c.time) && isFinite(c.close));
      if (tf !== "4H") return dedupe(raw);
      const buckets = new Map<number, any>();
      for (const c of raw) {
        const bucket = Math.floor(c.time / 14400) * 14400;
        if (!buckets.has(bucket)) buckets.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
        else { const b = buckets.get(bucket)!; b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low); b.close = c.close; b.volume = (b.volume ?? 0) + (c.volume ?? 0); }
      }
      return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    } catch { return null; }
  };

  const order: (() => Promise<any[] | null>)[] = [];
  if (MV_KEY && (cat === "forex" || cat === "commodities" || cat === "crypto")) order.push(getMassive);
  if (primary === "FH") { order.push(getFH); order.push(getTD); }
  else { order.push(getTD); order.push(getFH); }

  for (const fn of order) {
    const candles = await fn();
    if (candles && candles.length) {
      return NextResponse.json({ ok: true, symbol, interval: intervalParam, candles });
    }
  }

  return NextResponse.json({ ok: false, error: "No candle data available for this symbol", symbol, interval: intervalParam, candles: [] });
}
