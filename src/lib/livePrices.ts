import Redis from "ioredis";
import { prisma } from "@/lib/prisma";

// Live prices are published to Redis by the feed (server.js: `price:SYMBOL`).
// Server-side consumers (statements / reports) read them to show running P&L.
let _redis: Redis | null = null;
function client(): Redis | null {
  if (!_redis) { try { _redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); } catch { _redis = null; } }
  return _redis;
}

export async function livePrices(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const uniq = Array.from(new Set(symbols.filter(Boolean)));
  if (!uniq.length) return out;
  const c = client(); if (!c) return out;
  try {
    const vals = await c.mget(uniq.map((s) => "price:" + s));
    uniq.forEach((s, i) => { const n = vals[i] != null ? parseFloat(vals[i] as string) : NaN; if (isFinite(n)) out[s] = n; });
  } catch {}
  return out;
}

// Live prices + per-symbol category (for the contract size in pnlFor) for a set
// of trade symbols within a tenant — the context needed to compute running P&L.
export async function runningContext(tenantId: string, symbols: string[]): Promise<{ prices: Record<string, number>; catOf: Record<string, string> }> {
  const uniq = Array.from(new Set(symbols.filter(Boolean)));
  const prices = await livePrices(uniq);
  const catOf: Record<string, string> = {};
  if (uniq.length) {
    const rows = await prisma.symbol.findMany({ where: { tenantId, symbol: { in: uniq } }, select: { symbol: true, category: true } });
    for (const r of rows) catOf[r.symbol] = r.category;
  }
  return { prices, catOf };
}
