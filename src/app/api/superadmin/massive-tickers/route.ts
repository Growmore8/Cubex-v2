import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Cache 1 hour — Massive ticker list changes rarely
let cache: { t: number; tickers: MvTicker[] } | null = null;

interface MvTicker {
  symbol: string;    // our internal symbol (EURUSD, BTCUSD)
  display: string;   // display name (EUR/USD)
  name: string;      // full name (Euro / US Dollar)
  category: string;  // "forex" | "crypto"
  digits: number;
}

// Guess decimal digits for a forex pair
function forexDigits(sym: string): number {
  if (/JPY|HUF|KRW|IDR|VND|CLP|COP|PKR|NGN|TZS|UGX|RWF/.test(sym)) return 3;
  if (/TRY|MXN|ZAR|RUB/.test(sym)) return 4;
  return 5;
}

// Fetch all pages of a Massive REST endpoint
async function fetchAll(baseUrl: string, apiKey: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = `${baseUrl}?active=true&limit=1000&apikey=${apiKey}`;
  while (url) {
    const r: Response = await fetch(url, { cache: "no-store" });
    if (!r.ok) break;
    const d: any = await r.json();
    if (Array.isArray(d.results)) all.push(...d.results);
    // Polygon.io-style pagination
    url = d.next_url ? `${d.next_url}&apikey=${apiKey}` : null;
  }
  return all;
}

async function buildTickerList(apiKey: string): Promise<MvTicker[]> {
  const [fxRaw, cryptoRaw] = await Promise.all([
    fetchAll("https://api.massive.com/v2/reference/forex/tickers", apiKey),
    fetchAll("https://api.massive.com/v2/reference/crypto/tickers", apiKey),
  ]);

  const tickers: MvTicker[] = [];

  for (const t of fxRaw) {
    // Massive forex tickers may come as "C:EURUSD" or plain "EURUSD"
    const raw: string = (t.ticker || t.symbol || "").replace(/^C:/, "").toUpperCase();
    if (!raw || raw.length < 6) continue;
    const base = (t.base_currency_symbol || raw.slice(0, 3)).toUpperCase();
    const quote = (t.currency_symbol || raw.slice(3)).toUpperCase();
    const isMetal = /^(XAU|XAG|XPT|XPD)/.test(base);
    tickers.push({
      symbol: raw,
      display: `${base}/${quote}`,
      name: t.name || `${base} / ${quote}`,
      category: isMetal ? "commodities" : "forex",
      digits: forexDigits(raw),
    });
  }

  for (const t of cryptoRaw) {
    // Massive crypto tickers may come as "X:BTCUSD" or plain "BTCUSD"
    const raw: string = (t.ticker || t.symbol || "").replace(/^X:/, "").toUpperCase();
    if (!raw || raw.length < 4) continue;
    const base = (t.base_currency_symbol || raw.slice(0, raw.length - 3)).toUpperCase();
    const quote = (t.currency_symbol || "USD").toUpperCase();
    tickers.push({
      symbol: raw,
      display: `${base}/${quote}`,
      name: t.name || t.base_currency_name || base,
      category: "crypto",
      digits: 2,
    });
  }

  return tickers;
}

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const rec = await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null);
  const mv: string = ((rec?.value as any)?.massiveKey || process.env.MASSIVE_KEY || "").trim();
  if (!mv) return NextResponse.json({ ok: false, error: "No Massive API key configured. Add it in Market Data Feeds first." });

  // Return cached list if fresh
  if (cache && Date.now() - cache.t < 3_600_000) {
    const existing = await prisma.globalSymbol.findMany({ select: { symbol: true } });
    const existingSet = new Set(existing.map((e) => e.symbol));
    return NextResponse.json({ ok: true, tickers: cache.tickers, existing: [...existingSet], cached: true });
  }

  try {
    const tickers = await buildTickerList(mv);
    cache = { t: Date.now(), tickers };
    const existing = await prisma.globalSymbol.findMany({ select: { symbol: true } });
    const existingSet = new Set(existing.map((e) => e.symbol));
    return NextResponse.json({ ok: true, tickers, existing: [...existingSet] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed to fetch tickers" }, { status: 500 });
  }
}

// Add selected tickers to the global symbol catalog
export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { tickers }: { tickers: MvTicker[] } = await req.json();
    if (!Array.isArray(tickers) || !tickers.length) return NextResponse.json({ ok: false, error: "No tickers provided" });

    let added = 0, skipped = 0;
    for (const t of tickers) {
      if (!t.symbol) { skipped++; continue; }
      const existing = await prisma.globalSymbol.findFirst({ where: { symbol: t.symbol } });
      if (existing) { skipped++; continue; }
      await prisma.globalSymbol.create({
        data: { symbol: t.symbol, display: t.display, category: t.category, digits: t.digits, enabled: true },
      });
      added++;
    }
    return NextResponse.json({ ok: true, added, skipped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 500 });
  }
}
