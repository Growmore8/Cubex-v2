import { prisma } from "@/lib/prisma";

/**
 * Spread resolution priority chain (highest wins):
 *
 * 1. Client override  — manager sets specific pips for this account+symbol (can be 0)
 * 2. Group symbol     — group has a fixed spread for this symbol
 * 3. Group markup     — group.spread added on top of symbol default
 * 4. Symbol default   — admin-configured spread (or live bid/ask for BN/KR feeds)
 *
 * Returns spread in PIPS.
 * Returns null if no override found at level 1-3 (caller uses live/symbol default).
 */
export async function resolveSpread(
  accountId: string,
  symbol: string
): Promise<number | null> {
  // Load account with group and client spread override in one query
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      groupId: true,
      symbolOverrides: {
        where: { symbol },
        select: { spreadOverride: true },
      },
    },
  });
  if (!account) return null;

  // ── Level 1: Client-level override ──────────────────────────────────────────
  const clientOverride = account.symbolOverrides[0]?.spreadOverride;
  if (clientOverride !== null && clientOverride !== undefined) {
    return Number(clientOverride); // 0 = zero spread, any value = fixed pips
  }

  // ── Level 2 & 3: Group overrides ────────────────────────────────────────────
  if (account.groupId) {
    const group = await prisma.tradeGroup.findUnique({
      where: { id: account.groupId },
      select: {
        spread: true, // group markup pips
        symbolOverrides: {
          where: { symbol },
          select: { spread: true },
        },
      },
    });
    if (group) {
      // Level 2: group has a fixed spread for this specific symbol
      if (group.symbolOverrides.length > 0) {
        return Number(group.symbolOverrides[0].spread);
      }
      // Level 3: group markup — return as a "delta" using a special signal
      // Positive = markup to add on top. We return it as negative to distinguish
      // from a fixed override. Caller adds this to live/symbol spread.
      const markup = Number(group.spread);
      if (markup !== 0) return -(markup + 1e9); // signal: negative giant = markup delta
    }
  }

  return null; // no override — use symbol default
}

/**
 * Resolve spread and return { spread, isMarkup } cleanly.
 *
 * spread     = pips to use
 * isMarkup   = true means "add this to the live/default spread" (group markup)
 *              false means "use this as the fixed spread" (client or group symbol override)
 */
export async function resolveSpreadFull(
  accountId: string,
  symbol: string,
  symbolDefaultPips: number
): Promise<number> {
  const raw = await resolveSpread(accountId, symbol);
  if (raw === null) return symbolDefaultPips;
  if (raw < -1e8) {
    // Group markup signal — add to symbol default
    const markup = Math.abs(raw) - 1e9;
    return Math.max(0, symbolDefaultPips + markup);
  }
  return Math.max(0, raw); // fixed override (client or group symbol)
}

/**
 * Set a client-level spread override for a symbol.
 * spread = null removes the override (falls back to group/default).
 * spread = 0   = zero spread for this client+symbol.
 */
export async function setClientSpreadOverride(
  accountId: string,
  symbol: string,
  spread: number | null
): Promise<void> {
  if (spread === null) {
    // Remove override — clear spreadOverride field
    await prisma.accountSymbolOverride.updateMany({
      where: { accountId, symbol },
      data: { spreadOverride: null },
    });
    return;
  }
  await prisma.accountSymbolOverride.upsert({
    where: { accountId_symbol: { accountId, symbol } },
    create: { accountId, symbol, disabled: false, spreadOverride: spread },
    update: { spreadOverride: spread },
  });
}

/**
 * Set a group-level spread override for a symbol.
 * spread = null removes the symbol override (group falls back to markup).
 * spread = 0   = zero spread for all accounts in group for this symbol.
 */
export async function setGroupSymbolOverride(
  groupId: string,
  symbol: string,
  spread: number | null
): Promise<void> {
  if (spread === null) {
    await prisma.tradeGroupSymbolOverride.deleteMany({ where: { groupId, symbol } });
    return;
  }
  await prisma.tradeGroupSymbolOverride.upsert({
    where: { groupId_symbol: { groupId, symbol } },
    create: { groupId, symbol, spread },
    update: { spread },
  });
}
