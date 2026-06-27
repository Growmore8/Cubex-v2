import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o: any = await prisma.pendingOrder.findUnique({ where: { id }, include: { account: true } });
    if (!o) throw new Error("Not found");
    if (o.account.userId !== s.sub) throw new Error("Forbidden");
    const b = await req.json();
    const price = Number(b.price);
    if (!price || price <= 0) throw new Error("Invalid price");
    const sl = b.sl != null ? Number(b.sl) : Number(o.sl);
    const tp = b.tp != null ? Number(b.tp) : Number(o.tp);
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : (b.expiresAt === null ? null : o.expiresAt);
    await prisma.pendingOrder.update({ where: { id }, data: { price, sl, tp, expiresAt } });
    await audit(o.account.tenantId, "order.edit", o.account.login + " edited " + o.symbol + " " + o.side + " " + o.kind + " price→" + price, s.email || o.account.login, "CLIENT");
    emitRefresh();
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o: any = await prisma.pendingOrder.findUnique({ where: { id: id }, include: { account: true } });
    if (!o) throw new Error("Not found");
    if (o.account.userId !== s.sub) throw new Error("Forbidden");
    await prisma.pendingOrder.delete({ where: { id: o.id } });
    await audit(o.account.tenantId, "order.cancel", o.account.login + " cancelled " + o.symbol + " " + o.side + " " + o.kind + " @ " + o.price, s.email || o.account.login, "CLIENT");
    emitRefresh(); // sync the client's other open devices
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}