import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/apiKey";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import Redis from "ioredis";

// Shared Redis client — reused across requests to avoid connection-per-request overhead
let _redis: Redis | null = null;
function redisClient(): Redis | null {
  if (!_redis) { try { _redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); } catch { _redis = null; } }
  return _redis;
}

// Cache globalSymbols for 60s — they rarely change and this route can be polled frequently.
let _globalCache: { symbol: string; category: string; digits: number | null }[] = [];
let _globalCacheAt = 0;
async function getCachedGlobals() {
  if (Date.now() - _globalCacheAt < 60_000 && _globalCache.length > 0) return _globalCache;
  _globalCache = await prisma.globalSymbol.findMany({ select: { symbol: true, category: true, digits: true } });
  _globalCacheAt = Date.now();
  return _globalCache;
}

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
  const globals = await getCachedGlobals();

  const merged = globals.map((g) => {
    const t = tenantMap.get(g.symbol);
    return { symbol: g.symbol, category: g.category, spread: t?.spread ?? 0, digits: t?.digits ?? g.digits ?? 5 };
  });

  // Apply symbol filter if requested
  const syms = filterSet ? merged.filter((s) => filterSet.has(s.symbol)) : merged;

  if (!syms.length) return NextResponse.json({ ok: true, prices: {}, ts: Date.now() });

  // Fetch display price, real exchange bid, and real exchange ask from Redis.
  // ask:SYMBOL is only written when the feed provides a real separate ask (Binance/Kraken/Massive).
  const symList = syms.map((s) => s.symbol);
  const rc = redisClient();
  let rawPrices: (string | null)[] = symList.map(() => null);
  let rawBids:   (string | null)[] = symList.map(() => null);
  let rawAsks:   (string | null)[] = symList.map(() => null);
  if (rc) {
    try {
      [rawPrices, rawBids, rawAsks] = await Promise.all([
        rc.mget(symList.map((s) => "price:" + s)),
        rc.mget(symList.map((s) => "bid:"   + s)),
        rc.mget(symList.map((s) => "ask:"   + s)),
      ]);
    } catch {}
  }

  const round = (n: number, d: number) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

  const prices: Record<string, { symbol: string; price: number; bid: number; ask: number; category: string }> = {};
  for (let i = 0; i < syms.length; i++) {
    const s = syms[i];
    const displayPrice = rawPrices[i] != null ? parseFloat(rawPrices[i] as string) : NaN;
    if (!isFinite(displayPrice)) continue; // no live price yet — skip rather than send stale 0
    const digits = s.digits ?? 5;
    const pip = digits >= 3 ? Math.pow(10, -(digits - 1)) : Math.pow(10, -digits);
    const tenantMarkupPips = Number(s.spread) || 0;

    const realBidRaw = rawBids[i] != null ? parseFloat(rawBids[i] as string) : NaN;
    const realAskRaw = rawAsks[i] != null ? parseFloat(rawAsks[i] as string) : NaN;

    let bid: number;
    let ask: number;
    if (isFinite(realBidRaw) && isFinite(realAskRaw) && realAskRaw > realBidRaw) {
      // Real exchange bid/ask available (Binance/Kraken/Massive) — same logic as trade execution
      bid = round(realBidRaw, digits);
      ask = round(realAskRaw + tenantMarkupPips * pip, digits);
    } else {
      // Single-price feed (TwelveData/Finnhub) — construct spread from tenant config
      bid = round(displayPrice, digits);
      ask = round(displayPrice + tenantMarkupPips * pip, digits);
    }
    prices[s.symbol] = { symbol: s.symbol, price: bid, bid, ask, category: s.category };
  }

  return NextResponse.json({ ok: true, prices, ts: Date.now() });
}
