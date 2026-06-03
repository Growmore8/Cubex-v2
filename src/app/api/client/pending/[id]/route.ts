import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o: any = await prisma.pendingOrder.findUnique({ where: { id: id }, include: { account: true } });
    if (!o) throw new Error("Not found");
    if (o.account.userId !== s.sub) throw new Error("Forbidden");
    await prisma.pendingOrder.delete({ where: { id: o.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}