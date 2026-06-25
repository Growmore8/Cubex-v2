import { prisma } from "@/lib/prisma";

// 1 pip = 10^-(digits-1). e.g. EURUSD digits=5 → pip=0.0001; XAUUSD digits=2 → pip=0.1
export function pipForDigits(digits: number): number {
  return Math.pow(10, -(digits - 1));
}

// Floating spread: widens during off-market hours (outside 08:00-17:00 UTC Mon-Fri).
export function computeFloatingSpread(base: number, max: number, type: string): number {
  if (type !== "FLOATING" || max <= base) return base;
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = now.getUTCHours();
  const isPeak = day >= 1 && day <= 5 && hour >= 8 && hour < 17;
  return isPeak ? base : base + (max - base);
}

// Total spread in pips: symbol (fixed or floating) + group markup + account markup.
export async function getSpreadPips(
  tenantId: string,
  symbol: string,
  groupId: string | null | undefined,
  accountId?: string | null,
): Promise<number> {
  const [sym, grp, acc] = await Promise.all([
    prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { spread: true, spreadType: true, spreadMax: true } }).catch(() => null),
    groupId ? prisma.tradeGroup.findUnique({ where: { id: groupId }, select: { spread: true } }).catch(() => null) : null,
    accountId ? prisma.account.findUnique({ where: { id: accountId }, select: { spreadMarkup: true } }).catch(() => null) : null,
  ]);
  const symPips = computeFloatingSpread(Number(sym?.spread ?? 0), Number(sym?.spreadMax ?? 0), sym?.spreadType ?? "FIXED");
  return symPips + Number(grp?.spread ?? 0) + Number(acc?.spreadMarkup ?? 0);
}

// Spread converted to price units.
export function spreadPrice(pips: number, digits: number): number {
  return pips * pipForDigits(digits);
}

// Bid = ask − spread. Market-maker model: ask = raw feed price.
export async function getBidPrice(tenantId: string, symbol: string, groupId: string | null | undefined, ask: number, digits: number, accountId?: string | null): Promise<number> {
  const pips = await getSpreadPips(tenantId, symbol, groupId, accountId);
  return ask - spreadPrice(pips, digits);
}
