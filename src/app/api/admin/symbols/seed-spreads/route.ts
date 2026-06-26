import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Redis } from "ioredis";

// Realistic market spreads in pips per symbol.
// pip = 10^-(digits-1). e.g. EURUSD digits=5 → pip=0.0001 → 0.6 pips = $0.00006
const SPREADS: Record<string, number> = {
  // Forex majors
  EURUSD: 0.6, GBPUSD: 0.9, AUDUSD: 0.8, NZDUSD: 1.2,
  USDCAD: 1.0, USDCHF: 1.0, USDJPY: 0.7,
  // Forex crosses
  EURGBP: 1.0, EURJPY: 1.0, EURCAD: 1.8, EURCHF: 1.5,
  GBPJPY: 1.5, GBPCHF: 2.0, AUDJPY: 1.2,
  AUDNZD: 1.5, AUDCAD: 1.5, NZDJPY: 1.5,
  // Exotic forex
  USDHKD: 3.0, USDSGD: 2.5, USDTRY: 8.0, USDIDR: 15.0,
  USDMXN: 80.0, USDZAR: 120.0,
  // More forex crosses
  GBPAUD: 2.0, GBPCAD: 2.5, GBPNZD: 3.0, EURNZD: 2.5, EURAUD: 1.5,
  CADCHF: 2.5, CADJPY: 1.8, CHFJPY: 2.0, NZDCAD: 2.5, NZDCHF: 3.0,
  // Indices (digits=2, pip=$0.10 — spread in index points × 10)
  US500: 5.0,   // $0.50 = 0.5 S&P points
  US30:  20.0,  // $2.00 = 2.0 Dow points
  US100: 10.0,  // $1.00 = 1.0 NASDAQ points
  GER40: 10.0,  // $1.00 = 1.0 DAX points
  UK100: 10.0,  // $1.00 = 1.0 FTSE points
  JP225: 50.0,  // $5.00 = 5.0 Nikkei points
  // Energy (digits=2 for oil, digits=3 for natgas)
  USOIL:  3.0,  // $0.03 WTI spread
  UKOIL:  3.0,  // $0.03 Brent spread
  NATGAS: 5.0,  // $0.005 natural gas spread
  // Crypto (digits=2, pip=$0.10)
  BTCUSD: 20.0,  // $2.00 spread
  ETHUSD: 5.0,   // $0.50 spread
  BNBUSD: 2.0,   // $0.20 spread
  SOLUSD: 1.5,   // $0.15 spread
  DOGEUSD: 1.5,  // digits fixed to 5, pip=$0.0001 → $0.00015 spread
  XRPUSD:  2.0,  // digits=4, pip=$0.0001 → $0.0002 spread
  ADAUSD:  2.0,  // digits=4, pip=$0.0001 → $0.0002 spread
  AVAXUSD: 2.0,  // digits=2, pip=$0.01 → $0.02 spread
  LINKUSD: 2.0,  // digits=3, pip=$0.001 → $0.002 spread
  LTCUSD:  2.0,  // digits=2, pip=$0.01 → $0.02 spread
  DOTUSD:  2.0,  // digits=3, pip=$0.001 → $0.002 spread
  // Metals (digits=2, pip=$0.10)
  XAUUSD: 3.0,   // $0.30 spread (gold)
  XAGUSD: 0.5,   // $0.05 spread (silver)
  XPTUSD: 8.0,   // $0.80 spread (platinum)
  XPDUSD: 30.0,  // $3.00 spread (palladium)
  // Stocks (digits=2, pip=$0.10)
  AAPL: 0.2, TRP: 0.2, QQQ: 0.5,
  // Derived metal crosses (calculated server-side)
  XAUEUR: 3.5, XAUGBP: 3.5, XAUAUD: 4.0, XAUNZD: 4.5,
  XAUJPY: 4.0, XAUCAD: 4.0, XAUCHF: 4.0, XAUHKD: 5.0,
  XAUSGD: 4.5, XAUXAG: 0.5,
  XAGAUD: 0.8, XAGCAD: 0.8, XAGCHF: 0.8, XAGEUR: 0.6,
  XAGGBP: 0.7, XAGTRY: 2.0,
  GAUUSD: 3.0, GAUEUR: 3.5, GAUGBP: 3.5, GAUIDR: 5.0, GAUTRY: 4.0,
  XAGGUSD: 0.5, XAGGEUR: 0.6, XAGGTRY: 2.0,
};

// Digits overrides — fix assets where default digits make pip > price or lose precision
const DIGITS_FIX: Record<string, number> = {
  DOGEUSD: 5, // price ~$0.09; digits=2 gives pip=$0.10 > price
  XRPUSD: 4,  // price ~$2.4; need 4 decimal places
  ADAUSD: 4,  // price ~$0.7; need 4 decimal places
  DOTUSD: 3,  // price ~$5; need 3 decimal places
  LINKUSD: 3, // price ~$15; need 3 decimal places
};

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    // Fix digits in globalSymbol for affected assets
    for (const [sym, digits] of Object.entries(DIGITS_FIX)) {
      await prisma.globalSymbol.updateMany({ where: { symbol: sym }, data: { digits } });
    }

    const globals = await prisma.globalSymbol.findMany({ where: { enabled: true } });
    let count = 0;
    await Promise.all(globals.map(async (g) => {
      const spread = SPREADS[g.symbol] ?? null;
      if (spread === null) return; // no entry → skip
      const digits = DIGITS_FIX[g.symbol] ?? g.digits ?? 5;
      await prisma.symbol.upsert({
        where: { tenantId_symbol: { tenantId: s.tenantId!, symbol: g.symbol } },
        create: {
          tenantId: s.tenantId!,
          symbol: g.symbol,
          display: g.display || g.symbol,
          category: g.category || "forex",
          digits,
          feed: (g as any).feed || null,
          spread,
          spreadType: "FIXED",
          spreadMax: 0,
        },
        update: { spread, spreadType: "FIXED", spreadMax: 0, digits },
      });
      count++;
    }));

    try { const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); await pub.publish("cubex:spreads", "1"); pub.disconnect(); } catch (_) {}
    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
