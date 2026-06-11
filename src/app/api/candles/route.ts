import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Feed keys come from the SuperAdmin Feeds UI (DB), falling back to env.
async function feedKeys(): Promise<{ td: string; fh: string }> {
  let td = process.env.TWELVEDATA_KEY || process.env.TD_API_KEY || process.env.TD_KEY || "";
  let fh = process.env.FINNHUB_KEY || "";
  try {
    const rec = await prisma.setting.findUnique({ where: { key: "feeds" } });
    const v: any = (rec && rec.value) || {};
    if (typeof v.tdKey === "string" && v.tdKey.trim()) td = v.tdKey.trim();
    if (typeof v.finnhubKey === "string" && v.finnhubKey.trim()) fh = v.finnhubKey.trim();
  } catch {}
  return { td, fh };
}

const INTERVAL: Record<string, string> = {
  "1M": "1min", "5M": "5min", "15M": "15min", "30M": "30min", "1H": "1h", "4H": "4h", "1D": "1day",
};
// Finnhub candle resolution (forex/stock) — used for symbols with an OANDA feed.
const FH_RES: Record<string, string> = { "1M": "1", "5M": "5", "15M": "15", "30M": "30", "1H": "60", "4H": "60", "1D": "D" };

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
    const out = d.t.map((t: number, i: number) => ({ time: t, open: Number(d.o[i]), high: Number(d.h[i]), low: Number(d.l[i]), close: Number(d.c[i]) }))
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

// Short in-memory cache (custom server is long-lived) so symbol switches and
// multiple users don't refetch the provider every time — much faster loads.
const candleCache = new Map<string, { t: number; candles: any[]; source?: string }>();
const CACHE_MS = 20000;

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "";
  const tf = url.searchParams.get("tf") || "1M";
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });

  const ckey = symbol + "|" + tf;
  const hit = candleCache.get(ckey);
  if (hit && Date.now() - hit.t < CACHE_MS) return NextResponse.json({ ok: true, candles: hit.candles, source: hit.source, cached: true });

  let feed: string | null = null;
  try { const gs = await prisma.globalSymbol.findUnique({ where: { symbol } }); feed = gs?.feed || null; } catch {}
  const { td: TD_KEY, fh: FH_KEY } = await feedKeys();

  // For symbols on a Finnhub (OANDA) feed, use Finnhub's OHLC first; fall back to TD.
  if (feed && feed.includes(":")) {
    const fh = await finnhubCandles(feed, tf, FH_KEY);
    if (fh && fh.length) {
      fh.sort((a, b) => a.time - b.time);
      const seen = new Set<number>();
      const clean = fh.filter((c) => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
      candleCache.set(ckey, { t: Date.now(), candles: clean, source: "finnhub" });
      return NextResponse.json({ ok: true, candles: clean, source: "finnhub" });
    }
  }

  const tdSym = tdSymbol(symbol, feed);
  const interval = INTERVAL[tf] || "1min";
  // ~1500 bars: fast first paint while still giving plenty of scrollback.
  const api = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${interval}&outputsize=1500&order=ASC&timezone=UTC&format=JSON&apikey=${TD_KEY}`;

  try {
    const r = await fetch(api, { cache: "no-store" });
    const d = await r.json();
    if (!d || d.status === "error" || !Array.isArray(d.values)) {
      return NextResponse.json({ ok: false, error: d?.message || "No data", candles: [] });
    }
    // TD returns datetime strings; convert to unix seconds OHLC, ascending
    const candles = d.values.map((v: any) => {
      const dt: string = String(v.datetime);
      const iso = dt.includes(" ") ? dt.replace(" ", "T") + "Z" : dt + "T00:00:00Z"; // date-only for 1day
      return {
        time: Math.floor(new Date(iso).getTime() / 1000),
        open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
      };
    }).filter((c: any) => isFinite(c.time) && isFinite(c.close));
    // Defensive: ascending + de-duplicated by time (lightweight-charts requires it)
    candles.sort((a: any, b: any) => a.time - b.time);
    const seen = new Set<number>();
    const clean = candles.filter((c: any) => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
    candleCache.set(ckey, { t: Date.now(), candles: clean });
    return NextResponse.json({ ok: true, candles: clean });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Fetch failed", candles: [] });
  }
}
