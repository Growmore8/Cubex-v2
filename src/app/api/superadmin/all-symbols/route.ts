import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const symbols = await prisma.globalSymbol.findMany({
    orderBy: [{ category: "asc" }, { symbol: "asc" }],
  });
  return NextResponse.json({ ok: true, symbols });
}

// Toggle enabled/disabled for a symbol
export async function PATCH(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { symbol, enabled } = await req.json();
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  await prisma.globalSymbol.update({ where: { symbol }, data: { enabled } });
  return NextResponse.json({ ok: true });
}
