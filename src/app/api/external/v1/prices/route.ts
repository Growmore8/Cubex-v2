import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/apiKey";
import { rateLimit } from "@/lib/rateLimit";
import { livePrices } from "@/lib/livePrices";
import { prisma } from "@/lib/prisma";

// Public, read-only, server-to-server endpoint.
// GET /api/external/v1/prices
// GET /api/external/v1/prices?symbols=AAPL,EURUSD,XAUUSD   (filter to specific symbols)
// Header: x-api-key: ck_live_xxxxxxxx  (or Authorization: Bearer ...)
//
// Returns live prices for all enabled symbols the tenant has configured.
// Price source is whatever CubeX feed is active (Massive/TD/Finnhub) — fully
// automatic. SA changes a feed → prices here change too. No hardcoding.
//
// Response:
// {
//   "ok": true,
//   "prices": {
//     "EURUSD":   { "price": 1.08520, "bid": 1.08520, "ask": 1.08522, "symbol": "EURUSD", "category": "forex" },
//     "AAPL":     { "price": 283.50,  "bid": 283.50,  "ask": 283.52,  "symbol": "AAPL",   "category": "stocks" },
//     "XAUUSD":   { "price": 3245.50, "bid": 3245.50, "ask": 3246.00, "symbol": "XAUUSD", "category": "commodities" }
//   },
//   "ts": 1719648000000
// }

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });

  if (!rateLimit(`apikey:prices:${auth.keyId}`, 300, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = new URL(req.url);
  const filterParam = url.searchParams.get("symbols");
  const filterSet = filterParam ? new Set(filterParam.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

  // Get tenant's configured symbols (for spread overrides)
  const tenantSymbols = await prisma.symbol.findMany({
    where: { tenantId: auth.tenantId },
    select: { symbol: true, category: true, spread: true, digits: true },
  });
  const tenantMap = new Map(tenantSymbols.map((s) => [s.symbol, s]));

  // Merge with ALL globalSymbols — so Growth Capital (and any tenant) gets prices
  // for every symbol in the catalog, not just ones they've traded.
  // Tenant config takes priority for spread/digits; globalSymbol fills the rest.
  const globals = await prisma.globalSymbol.findMany({
    select: { symbol: true, category: true, digits: true },
  });

  const merged = globals.map((g) => {
    const t = tenantMap.get(g.symbol);
    return { symbol: g.symbol, category: g.category, spread: t?.spread ?? 0, digits: t?.digits ?? g.digits ?? 5 };
  });

  // Apply symbol filter if requested
  const syms = filterSet ? merged.filter((s) => filterSet.has(s.symbol)) : merged;

  if (!syms.length) return NextResponse.json({ ok: true, prices: {}, ts: Date.now() });

  // Fetch all live prices from Redis in one call — feed-agnostic
  const raw = await livePrices(syms.map((s) => s.symbol));

  const round = (n: number, d: number) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

  const prices: Record<string, { symbol: string; price: number; bid: number; ask: number; category: string }> = {};
  for (const s of syms) {
    const price = raw[s.symbol];
    if (price == null) continue; // no live price yet — skip rather than send stale 0
    const digits = s.digits ?? 5;
    const pip = Math.pow(10, -(digits - 1));
    const spreadPips = Number(s.spread) || 0;
    const bid = round(price, digits);
    const ask = round(price + spreadPips * pip, digits);
    prices[s.symbol] = { symbol: s.symbol, price: bid, bid, ask, category: s.category };
  }

  return NextResponse.json({ ok: true, prices, ts: Date.now() });
}
