import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Feed keys — module-level cache (30s TTL) to avoid a DB round-trip on every candle request
let _feedCache: { v: { td: string; fh: string; mv: string; primary: string }; t: number } | null = null;
async function feedKeys(): Promise<{ td: string; fh: string; mv: string; primary: string }> {
  if (_feedCache && Date.now() - _feedCache.t < 30_000) return _feedCache.v;
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
  const result = { td, fh, mv, primary };
  _feedCache = { v: result, t: Date.now() };
  return result;
}

const INTERVAL: Record<string, string> = {
  "1M": "1min", "5M": "5min", "15M": "15min", "30M": "30min", "1H": "1h", "4H": "4h", "1D": "1day", "1W": "1week",
};
// Finnhub candle resolution (forex/stock) — used for symbols with an OANDA feed.
const FH_RES: Record<string, string> = { "1M": "1", "5M": "5", "15M": "15", "30M": "30", "1H": "60", "4H": "60", "1D": "D" };

// Massive REST API — Polygon.io-compatible aggregate bars
// Forex/metals: C:EURUSD  |  Crypto: X:BTCUSD
// URL: https://api.massive.com/v2/aggs/ticker/{ticker}/range/{mult}/{span}/{from_ms}/{to_ms}?sort=asc&limit=N&apikey=KEY
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

function mvTicker(symbol: string, cat: string): string | null {
  const s = symbol.toUpperCase();
  if (cat === "crypto") {
    // BTCUSDT → X:BTCUSD  |  BTCUSD → X:BTCUSD
    const base = s.endsWith("USDT") ? s.slice(0, -1) : s; // strip trailing T
    return `X:${base}`;
  }
  if (cat === "forex" || cat === "commodities") {
    return `C:${s}`; // EURUSD → C:EURUSD, XAUUSD → C:XAUUSD
  }
  return null; // indices/stocks — Massive not used for history
}

// Finnhub OHLC for an OANDA-fed symbol (e.g. OANDA:EUR_USD). Returns candles or null.
async function finnhubCandles(feed: string, tf: string, fhKey: string): Promise<any[] | null> {
  if (!fhKey) return null;
  const res = FH_RES[tf] || "1";
  const secPer: Record<string, number> = { "1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400 };
  const to = Math.floor(Date.now() / 1000);
  const from = to - (secPer[res] || 60) * 5000; // ~5000 bars back
  const kind = feed.startsWith("OANDA:") ? "forex" : "stock";
  const api = `https://finnhub.io/api/v1/${kind}/candle?symbol=${encodeURIComponent(feed)}&resolution=${res}&from=${from}&to=${to}&token=${fhKey}`;
  try {
    const r = await fetch(api, { cache: "no-store" });
    const d = await r.json();
    if (!d || d.s !== "ok" || !Array.isArray(d.t)) return null;
    const out = d.t.map((t: number, i: number) => ({ time: t, open: Number(d.o[i]), high: Number(d.h[i]), low: Number(d.l[i]), close: Number(d.c[i]), volume: Number(d.v?.[i] ?? 0) }))
      .filter((c: any) => isFinite(c.time) && isFinite(c.close));
    return out.length ? out : null;
  } catch { return null; }
}

// Map an internal symbol (e.g. "XAUUSD", "GBPUSD", "BTCUSD") to a Twelve Data symbol.
function tdSymbol(sym: string, feed?: string | null): string {
  // Only honor `feed` if it is actually a TwelveData symbol (e.g. "XAU/USD").
  // The catalog stores Finnhub feeds here (e.g. "OANDA:XAU_USD"), which TD
  // rejects — those must be ignored so we fall back to the derived mapping.
  if (feed && feed.includes("/") && !feed.includes(":")) return feed;
  const s = sym.toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return s.slice(0, 3) + "/" + s.slice(3); // FX / metals pair
  if (/^(XAU|XAG|XPT|XPD)/.test(s) && s.length >= 6) return s.slice(0, 3) + "/" + s.slice(3);
  if (s.endsWith("USDT")) return s.replace("USDT", "") + "/USD";
  if (s.endsWith("USD") && s.length > 3 && !/^[A-Z]{6}$/.test(s)) return s.slice(0, s.length - 3) + "/USD";
  return s; // stocks/indices as-is
}

// In-memory cache keyed by symbol|tf. TTL scales with TF:
// 1M→45s, 5M→2min, 15M→4min, 30M→6min, 1H/4H→10min, 1D/1W→30min
const candleCache = new Map<string, { t: number; candles: any[]; source?: string }>();
const CACHE_TTL: Record<string,number> = {
  "1M":45000,"5M":120000,"15M":240000,"30M":360000,
  "1H":600000,"4H":600000,"1D":1800000,"1W":1800000,
};
function cacheTtl(tf:string){ return CACHE_TTL[tf] ?? 120000; }

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "";
  const tf = url.searchParams.get("tf") || "1M";
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });

  // Optional: fetch candles ending before a given unix timestamp (for "load more" scroll)
  const beforeSec = url.searchParams.get("before");
  const endDateParam = beforeSec ? `&end_date=${new Date(Number(beforeSec) * 1000).toISOString().replace("T", " ").slice(0, 19)}` : "";

  // limit: how many bars to fetch. Default 500 for initial load (fast), 2000 for load-more.
  const limit = Math.min(5000, Math.max(50, Number(url.searchParams.get("limit") || (beforeSec ? 2000 : 500))));

  const ckey = symbol + "|" + tf + "|" + limit + (beforeSec ? "|b" + beforeSec : "");
  const hit = candleCache.get(ckey);
  if (hit && Date.now() - hit.t < cacheTtl(tf)) return NextResponse.json({ ok: true, candles: hit.candles, source: hit.source, cached: true });

  // Parallelise the two DB calls — feedKeys is cached after first hit
  let feed: string | null = null;
  let cat = "";
  const [gs, { td: TD_KEY, fh: FH_KEY, mv: MV_KEY, primary }] = await Promise.all([
    prisma.globalSymbol.findUnique({ where: { symbol } }).catch(() => null),
    feedKeys(),
  ]);
  feed = gs?.feed || null;
  cat  = gs?.category || "";

  const dedupe = (arr: any[]) => { arr.sort((a, b) => a.time - b.time); const seen = new Set<number>(); return arr.filter((c) => isFinite(c.time) && isFinite(c.close) && !seen.has(c.time) && seen.add(c.time)); };

  // Massive REST — 10+ years of forex, metals, crypto history
  const getMassive = async (): Promise<any[] | null> => {
    if (!MV_KEY) return null;
    const ticker = mvTicker(symbol, cat);
    if (!ticker) return null;
    const { mult, span, msPerBar } = MV_TF[tf] || MV_TF["1M"];
    const toMs = beforeSec ? Number(beforeSec) * 1000 : Date.now();
    const fromMs = toMs - Math.ceil(limit * msPerBar * 1.3); // 30% buffer for market gaps
    const api = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${mult}/${span}/${fromMs}/${toMs}?sort=asc&limit=${limit}&apikey=${MV_KEY}`;
    try {
      const d = await (await fetch(api, { cache: "no-store" })).json();
      if (!d || d.status === "ERROR" || !Array.isArray(d.results) || !d.results.length) return null;
      const out = d.results.map((r: any) => ({
        time: Math.floor(r.t / 1000), // Massive returns ms → convert to seconds
        open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c),
        volume: Number(r.v ?? 0),
      })).filter((c: any) => isFinite(c.time) && isFinite(c.close));
      const clean = dedupe(out);
      return clean.length ? clean : null;
    } catch { return null; }
  };

  // Twelve Data time_series.
  const getTD = async (): Promise<any[] | null> => {
    if (!TD_KEY) return null;
    const tdSym = tdSymbol(symbol, feed);
    const interval = INTERVAL[tf] || "1min";
    const api = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${interval}&outputsize=${limit}&order=ASC&timezone=UTC&format=JSON${endDateParam}&apikey=${TD_KEY}`;
    try {
      const d = await (await fetch(api, { cache: "no-store" })).json();
      if (!d || d.status === "error" || !Array.isArray(d.values)) return null;
      const out = d.values.map((v: any) => { const dt = String(v.datetime); const iso = dt.includes(" ") ? dt.replace(" ", "T") + "Z" : dt + "T00:00:00Z"; return { time: Math.floor(new Date(iso).getTime() / 1000), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume ?? 0) }; });
      const clean = dedupe(out);
      return clean.length ? clean : null;
    } catch { return null; }
  };
  // Finnhub (OANDA) — only when the symbol has a Finnhub feed.
  // Finnhub has no 4H resolution; fetch 1H and aggregate into 4H buckets.
  const getFH = async (): Promise<any[] | null> => {
    if (!feed || !feed.includes(":")) return null;
    const fh = await finnhubCandles(feed, tf === "4H" ? "1H" : tf, FH_KEY);
    if (!fh || !fh.length) return null;
    if (tf !== "4H") return dedupe(fh);
    // Aggregate 1H → 4H: bucket by floor(time / 14400) * 14400
    const buckets = new Map<number, any>();
    for (const c of fh) {
      const bucket = Math.floor(c.time / 14400) * 14400;
      if (!buckets.has(bucket)) buckets.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
      else { const b = buckets.get(bucket)!; b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low); b.close = c.close; b.volume = (b.volume ?? 0) + (c.volume ?? 0); }
    }
    const out = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    return out.length ? out : null;
  };

  // Priority: Massive first (deep history, real quotes) → TD → FH
  // Massive only applies to forex, metals, and crypto (not stocks/indices)
  const order: (() => Promise<any[] | null>)[] = [];
  if (MV_KEY && (cat === "forex" || cat === "commodities" || cat === "crypto")) order.push(getMassive);
  if (primary === "FH") { order.push(getFH); order.push(getTD); }
  else { order.push(getTD); order.push(getFH); }

  for (const fn of order) {
    const candles = await fn();
    if (candles && candles.length) { candleCache.set(ckey, { t: Date.now(), candles }); return NextResponse.json({ ok: true, candles }); }
  }
  return NextResponse.json({ ok: false, error: "No data", candles: [] });
}
