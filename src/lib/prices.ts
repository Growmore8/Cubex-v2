import { redis } from "@/lib/redis";

export async function getPrice(symbol: string): Promise<number | null> {
  try {
    const v = await redis.get("price:" + symbol);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

// Real bid from Binance/Kraken feed. Null when only price feed available (TD/FH).
export async function getBid(symbol: string): Promise<number | null> {
  try {
    const v = await redis.get("bid:" + symbol);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}
