import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notify } from "@/services/notification.service";
import { sendUserMail } from "@/lib/tenant-mail";
import { depositWithdrawalEmail } from "@/lib/email-templates";
import { emitRefresh } from "@/lib/realtime";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const rec = await prisma.paymentRequest.findFirst({
      where: { id },
      include: { account: { select: { id: true, userId: true, login: true, name: true, tenantId: true } } },
    });
    if (!rec) throw new Error("Payment not found");
    if (rec.status !== "PENDING") throw new Error("Already " + String(rec.status).toLowerCase());

    const approve = b.action === "approve";
    const status = approve ? "APPROVED" : "REJECTED";
    const rejectReason: string | undefined = b.rejectReason || undefined;
    const tenantId = rec.tenantId;
    const acc = rec.account;

    const ops: any[] = [
      prisma.paymentRequest.update({
        where: { id: rec.id },
        data: { status: status as any, reviewedBy: s.email || "superadmin", ...(rejectReason ? { rejectReason } : {}) },
      }),
    ];

    if (approve) {
      const amt = new Prisma.Decimal(rec.amount as any);
      const by = s.email || "superadmin";
      if (rec.kind === "DEPOSIT") {
        ops.push(prisma.account.update({ where: { id: acc.id }, data: { deposit: { increment: amt } } }));
        ops.push(prisma.financialHistory.create({ data: { accountId: acc.id, type: "DEPOSIT", amount: amt, description: rec.method ? `Deposit via ${rec.method}` : "Deposit", mode: "REALTIME", createdBy: by } }));
      } else if (rec.kind === "WITHDRAWAL") {
        ops.push(prisma.account.update({ where: { id: acc.id }, data: { withdrawal: { increment: amt } } }));
        ops.push(prisma.financialHistory.create({ data: { accountId: acc.id, type: "WITHDRAWAL", amount: amt, description: rec.method ? `Withdrawal via ${rec.method}` : "Withdrawal", mode: "REALTIME", createdBy: by } }));
      }
    }

    await prisma.$transaction(ops);
    await audit(tenantId, "payment.sa." + status.toLowerCase(), (acc.login) + " " + rec.kind + " $" + rec.amount, s.email || "superadmin");

    if (acc.userId) {
      const t = rec.kind === "DEPOSIT" ? "Deposit" : "Withdrawal";
      notify(tenantId, acc.userId, `${t} ${approve ? "Approved" : "Rejected"}`, `${t} of $${rec.amount} ${approve ? "approved ✓" : "rejected"}`, "FUNDS").catch(() => {});
      sendUserMail(tenantId, acc.userId, `${t} ${approve ? "Approved" : "Rejected"} – $${rec.amount}`,
        (brand) => depositWithdrawalEmail(brand, { holderName: acc.name || acc.login, kind: rec.kind as "DEPOSIT" | "WITHDRAWAL", amount: rec.amount as any, method: (rec as any).method, status: approve ? "APPROVED" : "REJECTED", login: acc.login })
      ).catch(() => {});
    }

    emitRefresh({ kind: "payment" });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
