import { redis } from "@/lib/redis";

export async function getPrice(symbol: string): Promise<number | null> {
  try {
    const v = await redis.get("price:" + symbol);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

// Real bid from exchange feed (Massive/Binance/Kraken). Null for single-price feeds (TD/FH).
export async function getBid(symbol: string): Promise<number | null> {
  try {
    const v = await redis.get("bid:" + symbol);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

// Real ask from exchange feed (Massive/Binance/Kraken). Null for single-price feeds (TD/FH).
export async function getAsk(symbol: string): Promise<number | null> {
  try {
    const v = await redis.get("ask:" + symbol);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

// FX rate: how many USD = 1 unit of `currency`.
// EUR → EURUSD price, GBP → GBPUSD price, USD → 1.
// Used to convert USD P&L into the account's base currency.
export async function getAccountFxRate(currency?: string | null): Promise<number> {
  if (!currency || currency === "USD") return 1;
  if (currency === "EUR") return (await getPrice("EURUSD")) || 1;
  if (currency === "GBP") return (await getPrice("GBPUSD")) || 1;
  return 1;
}
