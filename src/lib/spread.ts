import { prisma } from "@/lib/prisma";

// 1 pip = 10^-(digits-1). e.g. EURUSD digits=5 → pip=0.0001; XAUUSD digits=2 → pip=0.1
export function pipForDigits(digits: number): number {
  return Math.pow(10, -(digits - 1));
}

// Symbol layer FLOATING = stored pip value IS the base spread (off-hours widening is separate).
// Group/Account layer FLOATING = 0 extra markup (client sees raw symbol spread, no markup added).
function resolveMarkup(pips: number, type: string): number {
  return type === "FLOATING" ? 0 : pips;
}

// Total spread in pips: symbol base + group markup + account markup.
// Symbol layer always uses its stored spread regardless of FLOATING/FIXED.
// Group and account FLOATING layers contribute 0 (no extra markup).
export async function getSpreadPips(
  tenantId: string,
  symbol: string,
  groupId: string | null | undefined,
  accountId?: string | null,
): Promise<number> {
  const [sym, grp, acc] = await Promise.all([
    prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { spread: true, spreadType: true } }).catch(() => null),
    groupId ? prisma.tradeGroup.findUnique({ where: { id: groupId }, select: { spread: true, spreadType: true } }).catch(() => null) : null,
    accountId ? prisma.account.findUnique({ where: { id: accountId }, select: { spreadMarkup: true, spreadMarkupType: true } }).catch(() => null) : null,
  ]);
  const symPips = Number(sym?.spread ?? 0); // symbol base always applies
  const grpPips = resolveMarkup(Number(grp?.spread ?? 0), grp?.spreadType ?? "FIXED");
  const accPips = resolveMarkup(Number(acc?.spreadMarkup ?? 0), acc?.spreadMarkupType ?? "FIXED");
  return symPips + grpPips + accPips;
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
