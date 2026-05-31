import { redis } from "@/lib/redis";

export async function getPrice(symbol: string): Promise<number | null> {
  const v = await redis.get("price:" + symbol);
  return v == null ? null : Number(v);
}
