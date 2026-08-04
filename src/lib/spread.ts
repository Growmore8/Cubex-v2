import { prisma } from "@/lib/prisma";

// Forex (digits ≥ 3): pip is one above the last decimal — EURUSD 5D → 0.0001; USDJPY 3D → 0.01
// Metals/crypto (digits ≤ 2): last decimal IS the pip — XAUUSD 2D → 0.01, NOT 0.1
export function pipForDigits(digits: number): number {
  return digits >= 3 ? Math.pow(10, -(digits - 1)) : Math.pow(10, -digits);
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

// SA-configured minimum spread (pips) per category — stored in `feeds` setting.
// Applied as fallback when a tenant has no spread configured AND the feed is single-price (no real ask).
// Built-in defaults: forex 1.5, crypto 20, commodities 30, indices 2, stocks 5.
let _feedsCfgCache: { v: any; t: number } | null = null;
async function getFeedsConfig() {
  if (_feedsCfgCache && Date.now() - _feedsCfgCache.t < 30_000) return _feedsCfgCache.v;
  const rec = await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null);
  const v = (rec?.value as any) || {};
  _feedsCfgCache = { v, t: Date.now() };
  return v;
}

const BUILT_IN_DEFAULTS: Record<string, number> = {
  forex: 1.5,
  crypto: 20,
  commodities: 30,
  indices: 2,
  stocks: 5,
};

export async function getSaDefaultSpreadPips(category: string): Promise<number> {
  try {
    const cfg = await getFeedsConfig();
    const ds = cfg.defaultSpreads || {};
    const cat = (category || "forex").toLowerCase();
    if (ds[cat] != null && Number(ds[cat]) >= 0) return Number(ds[cat]);
    return BUILT_IN_DEFAULTS[cat] ?? 1.5;
  } catch {
    return 1.5;
  }
}
