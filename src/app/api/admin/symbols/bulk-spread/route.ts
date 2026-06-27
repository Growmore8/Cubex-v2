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

    await Promise.all(globals.map((g) => {
      // FLOATING → spread = 0 (live bid/ask is the spread; no fixed floor imposed)
      // FIXED    → spread = admin-provided pip value
      const pip = type === "FIXED" ? (spread != null ? Number(spread) : 0) : 0;

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
