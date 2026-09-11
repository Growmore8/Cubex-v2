import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Redis } from "ioredis";

// POST { spreadType, spread? }
// Upserts ALL enabled global symbols into the tenant's symbol table with spread settings.
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { spreadType, spread } = await req.json();
    const type: string = spreadType === "FLOATING" ? "FLOATING" : "FIXED";
    const globals = await prisma.globalSymbol.findMany({ where: { enabled: true } });

    // Category defaults used as feed-gap fallback for FLOATING and as seed for new rows
    const CAT_DEFAULTS: Record<string, number> = {
      forex: 1.5, metals: 3, commodities: 3, crypto: 10, indices: 8, stocks: 5, energy: 3,
    };

    // For existing rows: fetch current spreads so FLOATING doesn't overwrite them with 0
    const existing = await prisma.symbol.findMany({
      where: { tenantId: s.tenantId! },
      select: { symbol: true, spread: true },
    });
    const existingSpread: Record<string, number> = {};
    for (const e of existing) existingSpread[e.symbol] = Number(e.spread ?? 0);

    await Promise.all(globals.map((g) => {
      const cat = g.category || "forex";
      // FIXED: use admin-provided pip value for all rows
      // FLOATING: preserve existing spread as feed-gap fallback (never wipe to 0);
      //           new rows get category default so clients always have a sensible fallback
      let pip: number;
      if (type === "FIXED") {
        pip = spread != null ? Number(spread) : 0;
      } else {
        // Keep existing spread if > 0; new rows get category default
        pip = (existingSpread[g.symbol] ?? 0) > 0
          ? existingSpread[g.symbol]
          : (CAT_DEFAULTS[cat] ?? 1.5);
      }

      return prisma.symbol.upsert({
        where: { tenantId_symbol: { tenantId: s.tenantId!, symbol: g.symbol } },
        create: {
          tenantId: s.tenantId!,
          symbol: g.symbol,
          display: g.display || g.symbol,
          category: cat,
          digits: g.digits ?? 5,
          feed: (g as any).feed || null,
          spread: pip,
          spreadType: type,
          spreadMax: 0,
        },
        update: {
          spread: pip,
          spreadType: type,
          spreadMax: 0,
        },
      });
    }));

    try { const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); await pub.publish("cubex:spreads", "1"); pub.disconnect(); } catch (_) {}
    return NextResponse.json({ ok: true, count: globals.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 500 });
  }
}
