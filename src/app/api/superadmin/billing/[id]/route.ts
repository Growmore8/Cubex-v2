import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const b = await req.json();
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new Error("Invoice not found");

    if (b.action === "markPaid") {
      await prisma.invoice.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
    } else if (b.action === "markOverdue") {
      await prisma.invoice.update({ where: { id }, data: { status: "OVERDUE" } });
    } else if (b.action === "markPending") {
      await prisma.invoice.update({ where: { id }, data: { status: "PENDING", paidAt: null } });
    } else if (b.action === "cancel") {
      await prisma.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
    } else if (b.action === "update") {
      const data: any = {};
      if (b.amount !== undefined) data.amount = Number(b.amount);
      if (b.dueAt !== undefined) data.dueAt = new Date(b.dueAt);
      if (b.notes !== undefined) data.notes = b.notes || null;
      await prisma.invoice.update({ where: { id }, data });
    } else if (b.action === "delete") {
      await prisma.invoice.delete({ where: { id } });
    } else {
      throw new Error("Unknown action");
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
