import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o: any = await prisma.pendingOrder.findUnique({ where: { id }, include: { account: true } });
    if (!o) throw new Error("Not found");
    if (s.role !== "SUPERADMIN" && o.tenantId !== s.tenantId) throw new Error("Forbidden");
    if (s.role === "MANAGER" && o.account?.managerId !== s.sub) throw new Error("Not your account");
    const b = await req.json();
    const price = Number(b.price);
    if (!price || price <= 0) throw new Error("Invalid price");
    const sl = b.sl != null ? Number(b.sl) : Number(o.sl);
    const tp = b.tp != null ? Number(b.tp) : Number(o.tp);
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : (b.expiresAt === null ? null : o.expiresAt);
    await prisma.pendingOrder.update({ where: { id }, data: { price, sl, tp, expiresAt } });
    await audit(o.tenantId, "desk.pending.edit", (o.account?.login || "") + " " + o.side + " " + o.symbol + " price→" + price, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o: any = await prisma.pendingOrder.findUnique({ where: { id }, include: { account: true } });
    if (!o) throw new Error("Pending order not found");
    if (s.role !== "SUPERADMIN" && o.tenantId !== s.tenantId) throw new Error("Forbidden");
    if (s.role === "MANAGER" && o.account?.managerId !== s.sub) throw new Error("Not your account");
    await prisma.pendingOrder.delete({ where: { id } });
    await audit(o.tenantId, "desk.pending.cancel", (o.account?.login || "") + " " + o.side + " " + o.symbol, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
