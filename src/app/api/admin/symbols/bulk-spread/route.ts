import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Redis } from "ioredis";

// Category-based default spreads (pips) used when type=FLOATING and no pip value is specified
const CAT_DEFAULTS: Record<string, number> = {
  forex: 1.5,
  crypto: 5.0,
  metals: 3.0,
  stocks: 2.0,
  indices: 2.0,
  energy: 3.0,
};
function defaultPips(cat: string): number {
  return CAT_DEFAULTS[cat?.toLowerCase()] ?? 2.0;
}

// POST { spreadType, spread? }
// Upserts ALL enabled global symbols into the tenant's symbol table with spread settings.
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { spreadType, spread } = await req.json();
    const type: string = spreadType === "FLOATING" ? "FLOATING" : "FIXED";
    const globals = await prisma.globalSymbol.findMany({ where: { enabled: true } });

    // Fetch existing tenant symbols to preserve current spread values when FLOATING
    const existing = await prisma.symbol.findMany({ where: { tenantId: s.tenantId! }, select: { symbol: true, spread: true } });
    const existingMap: Record<string, number> = {};
    for (const e of existing) existingMap[e.symbol] = Number(e.spread ?? 0);

    await Promise.all(globals.map((g) => {
      const cat = g.category || "forex";
      // For FLOATING: keep existing spread if non-zero, else use category default
      const pip =
        type === "FIXED"
          ? (spread != null ? Number(spread) : 0)
          : (existingMap[g.symbol] > 0 ? existingMap[g.symbol] : defaultPips(cat));

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
