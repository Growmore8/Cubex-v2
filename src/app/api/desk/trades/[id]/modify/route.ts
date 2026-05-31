import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const t: any = await prisma.trade.findUnique({ where: { id: Number(params.id) }, include: { account: true } });
    if (!t) throw new Error("Position not found");
    if (t.account.tenantId !== s.tenantId) throw new Error("Forbidden");
    await prisma.trade.update({ where: { id: t.id }, data: { sl: Number(b.sl) || 0, tp: Number(b.tp) || 0 } });
    await audit(s.tenantId as string, "trade.modify", t.symbol + " sl=" + b.sl + " tp=" + b.tp, s.email || "admin");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}