import { prisma } from "@/lib/prisma";

// 1 pip = 10^-(digits-1). e.g. EURUSD digits=5 → pip=0.0001; XAUUSD digits=2 → pip=0.1
export function pipForDigits(digits: number): number {
  return Math.pow(10, -(digits - 1));
}

// Total spread in pips for execution:
//   FIXED symbol  → sym.spread is the total spread (bid = ask − totalPips)
//   FLOATING symbol → sym.spread is a markup added on top of the live exchange bid
// Group and account spreads are always additive pip markups on top of the symbol spread.
export async function getSpreadPips(
  tenantId: string,
  symbol: string,
  groupId: string | null | undefined,
  accountId?: string | null,
): Promise<number> {
  const [sym, grp, acc] = await Promise.all([
    prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { spread: true } }).catch(() => null),
    groupId ? prisma.tradeGroup.findUnique({ where: { id: groupId }, select: { spread: true, spreadType: true } }).catch(() => null) : null,
    accountId ? prisma.account.findUnique({ where: { id: accountId }, select: { spreadMarkup: true } }).catch(() => null) : null,
  ]);
  // FIXED group = apply markup. FLOATING group = live exchange spread, no extra markup. Default FIXED.
  const grpMarkup = (grp?.spreadType ?? "FIXED") === "FIXED" ? Number(grp?.spread ?? 0) : 0;
  return Number(sym?.spread ?? 0) + grpMarkup + Number(acc?.spreadMarkup ?? 0);
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
