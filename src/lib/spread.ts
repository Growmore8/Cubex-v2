import { prisma } from "@/lib/prisma";

// 1 pip = 10^-(digits-1). e.g. EURUSD digits=5 → pip=0.0001; XAUUSD digits=2 → pip=0.1
export function pipForDigits(digits: number): number {
  return Math.pow(10, -(digits - 1));
}

// Total spread in pips: per-symbol spread + group markup.
export async function getSpreadPips(tenantId: string, symbol: string, groupId: string | null | undefined): Promise<number> {
  const [sym, grp] = await Promise.all([
    prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { spread: true, digits: true } }).catch(() => null),
    groupId ? prisma.tradeGroup.findUnique({ where: { id: groupId }, select: { spread: true } }).catch(() => null) : null,
  ]);
  return Number(sym?.spread ?? 0) + Number(grp?.spread ?? 0);
}

// Spread converted to price units.
export function spreadPrice(pips: number, digits: number): number {
  return pips * pipForDigits(digits);
}

// Bid = ask − spread. Market-maker model: ask = raw feed price.
export async function getBidPrice(tenantId: string, symbol: string, groupId: string | null | undefined, ask: number, digits: number): Promise<number> {
  const pips = await getSpreadPips(tenantId, symbol, groupId);
  return ask - spreadPrice(pips, digits);
}
