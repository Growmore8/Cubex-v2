import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { Prisma } from "@prisma/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const rec = await prisma.paymentRequest.findFirst({ where: { id: id, tenantId: s.tenantId as string } });
    if (!rec) throw new Error("Payment not found");
    if (rec.status !== "PENDING") throw new Error("Already " + String(rec.status).toLowerCase());
    const approve = b.action === "approve";
    if (approve) await assertCan(s, rec.kind === "WITHDRAWAL" ? "processWithdrawals" : "processDeposits");
    const status = approve ? "APPROVED" : "REJECTED";
    const ops: any[] = [prisma.paymentRequest.update({ where: { id: rec.id }, data: { status: status as any, reviewedBy: s.email || "admin" } })];
    if (approve) {
      const amt = new Prisma.Decimal(rec.amount as any);
      if (rec.kind === "DEPOSIT") ops.push(prisma.account.update({ where: { id: rec.accountId }, data: { deposit: { increment: amt } } }));
      else if (rec.kind === "WITHDRAWAL") ops.push(prisma.account.update({ where: { id: rec.accountId }, data: { withdrawal: { increment: amt } } }));
    }
    await prisma.$transaction(ops);
    await audit(s.tenantId as string, "payment." + status.toLowerCase(), rec.kind + " " + rec.amount + " " + (rec.method || ""), s.email || "admin");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}