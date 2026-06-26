import { prisma } from "@/lib/prisma";

// Realistic market spreads in pips per symbol.
const SPREADS: Record<string, number> = {
  EURUSD: 0.6, GBPUSD: 0.9, AUDUSD: 0.8, NZDUSD: 1.2,
  USDCAD: 1.0, USDCHF: 1.0, USDJPY: 0.7,
  EURGBP: 1.0, EURJPY: 1.0, EURCAD: 1.8, EURCHF: 1.5,
  GBPJPY: 1.5, GBPCHF: 2.0, AUDJPY: 1.2,
  AUDNZD: 1.5, AUDCAD: 1.5, NZDJPY: 1.5,
  USDHKD: 3.0, USDSGD: 2.5, USDTRY: 8.0, USDIDR: 15.0,
  USDMXN: 80.0, USDZAR: 120.0,
  GBPAUD: 2.0, GBPCAD: 2.5, GBPNZD: 3.0, EURNZD: 2.5, EURAUD: 1.5,
  CADCHF: 2.5, CADJPY: 1.8, CHFJPY: 2.0, NZDCAD: 2.5, NZDCHF: 3.0,
  US500: 5.0, US30: 20.0, US100: 10.0, GER40: 10.0, UK100: 10.0, JP225: 50.0, HK50: 15.0, FRA40: 12.0,
  USOIL: 3.0, UKOIL: 3.0, NATGAS: 5.0,
  BTCUSD: 20.0, ETHUSD: 5.0, BNBUSD: 2.0, SOLUSD: 1.5,
  DOGEUSD: 1.5, XRPUSD: 2.0, ADAUSD: 2.0, AVAXUSD: 2.0,
  LINKUSD: 2.0, LTCUSD: 2.0, DOTUSD: 2.0,
  XAUUSD: 3.0, XAGUSD: 0.5, XPTUSD: 8.0, XPDUSD: 30.0,
  AAPL: 0.2, TRP: 0.2, QQQ: 0.5,
  XAUEUR: 3.5, XAUGBP: 3.5, XAUAUD: 4.0, XAUNZD: 4.5,
  XAUJPY: 4.0, XAUCAD: 4.0, XAUCHF: 4.0, XAUHKD: 5.0,
  XAUSGD: 4.5, XAUXAG: 0.5,
  XAGAUD: 0.8, XAGCAD: 0.8, XAGCHF: 0.8, XAGEUR: 0.6,
  XAGGBP: 0.7, XAGTRY: 2.0,
  GAUUSD: 3.0, GAUEUR: 3.5, GAUGBP: 3.5, GAUIDR: 5.0, GAUTRY: 4.0,
  XAGGUSD: 0.5, XAGGEUR: 0.6, XAGGTRY: 2.0,
};

const DIGITS_FIX: Record<string, number> = {
  DOGEUSD: 5, XRPUSD: 4, ADAUSD: 4, DOTUSD: 3, LINKUSD: 3,
};

/**
 * Seed realistic spread defaults for a tenant.
 * overwrite=false (default): creates missing symbols; also updates existing ones where spread=0
 *   (spread=0 means "never set by admin" — auto-fill with realistic default).
 *   Symbols with spread > 0 that admin set manually are NEVER touched.
 * overwrite=true: force-resets ALL symbols (used by admin "Realistic defaults" button).
 */
export async function seedDefaultSpreads(tenantId: string, overwrite = false): Promise<number> {
  const globals = await prisma.globalSymbol.findMany({ where: { enabled: true } });
  let count = 0;

  // Fix digits in globalSymbol (safe to always run)
  for (const [sym, digits] of Object.entries(DIGITS_FIX)) {
    await prisma.globalSymbol.updateMany({ where: { symbol: sym }, data: { digits } }).catch(() => {});
  }

  await Promise.all(globals.map(async (g) => {
    const spread = SPREADS[g.symbol] ?? null;
    if (spread === null) return;
    const digits = DIGITS_FIX[g.symbol] ?? g.digits ?? 5;

    const existing = await prisma.symbol.findUnique({
      where: { tenantId_symbol: { tenantId, symbol: g.symbol } },
    });

    if (!existing) {
      // Never existed — create with defaults
      await prisma.symbol.create({
        data: {
          tenantId,
          symbol: g.symbol,
          display: g.display || g.symbol,
          category: g.category || "forex",
          digits,
          feed: (g as any).feed || null,
          spread,
          spreadType: "FIXED",
          spreadMax: 0,
        },
      });
      count++;
    } else if (overwrite || Number(existing.spread) === 0) {
      // Force reset (button) OR spread is 0 = admin never set it manually → apply default
      await prisma.symbol.update({
        where: { tenantId_symbol: { tenantId, symbol: g.symbol } },
        data: { spread, spreadType: "FIXED", spreadMax: 0, digits },
      });
      count++;
    }
    // else: spread > 0 and overwrite=false → admin set this manually, leave it alone
  }));

  return count;
}
