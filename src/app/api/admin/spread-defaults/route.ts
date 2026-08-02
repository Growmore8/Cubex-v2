import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

const BUILT_IN: Record<string, number> = { forex: 1.5, crypto: 20, commodities: 30, indices: 2, stocks: 5 };

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false }, { status: 403 });
  const rec = await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null);
  const ds = (rec?.value as any)?.defaultSpreads || {};
  return NextResponse.json({
    ok: true,
    defaults: {
      forex:       ds.forex       ?? BUILT_IN.forex,
      crypto:      ds.crypto      ?? BUILT_IN.crypto,
      commodities: ds.commodities ?? BUILT_IN.commodities,
      indices:     ds.indices     ?? BUILT_IN.indices,
      stocks:      ds.stocks      ?? BUILT_IN.stocks,
    },
  });
}
