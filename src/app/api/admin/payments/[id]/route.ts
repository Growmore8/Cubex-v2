import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { Prisma } from "@prisma/client";
import { notify, notifyStaff } from "@/services/notification.service";
import { sendUserMail } from "@/lib/tenant-mail";
import { depositWithdrawalEmail } from "@/lib/email-templates";
import { adjustBalance } from "@/services/account.service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const rec = await prisma.paymentRequest.findFirst({ where: { id: id, tenantId: s.tenantId as string } });
    if (!rec) throw new Error("Payment not found");

    // Allow delete action regardless of status
    if (b.action === "delete") {
      const delAcc = rec.accountId ? await prisma.account.findUnique({ where: { id: rec.accountId }, select: { login: true } }) : null;
      await prisma.paymentRequest.delete({ where: { id: rec.id } });
      await audit(s.tenantId as string, "payment.deleted", (delAcc?.login || rec.accountId) + " " + rec.kind + " $" + rec.amount + " deleted", s.email || "admin");
      return NextResponse.json({ ok: true });
    }

    if (rec.status !== "PENDING") throw new Error("Already " + String(rec.status).toLowerCase());
    const approve = b.action === "approve" || b.status === "APPROVED";
    const kind = rec.kind as string;

    // Credit requests / clearances: require creditBonus permission
    if (kind === "CREDIT_REQUEST" || kind === "CREDIT_CLEAR") {
      await assertCan(s, "creditBonus");
    } else {
      await assertCan(s, kind === "WITHDRAWAL" ? "processWithdrawals" : "processDeposits");
    }

    const status = approve ? "APPROVED" : "REJECTED";
    const rejectReason = b.rejectReason || undefined;
    const ops: any[] = [prisma.paymentRequest.update({ where: { id: rec.id }, data: { status: status as any, reviewedBy: s.email || "admin", ...(rejectReason ? { rejectReason } : {}) } })];

    if (approve) {
      const amt = new Prisma.Decimal(rec.amount as any);
      const tenantId = s.tenantId as string;
      const by = s.email || "admin";
      // Single fetch covering snapshot fields + fields needed for notifications/credit logic
      const accFull = rec.accountId ? await prisma.account.findUnique({ where: { id: rec.accountId }, select: { login: true, name: true, userId: true, managerId: true, credit: true } }) : null;
      const fhSnap = { tenantId, accountLogin: accFull?.login, accountName: accFull?.name };

      if (kind === "DEPOSIT") {
        ops.push(prisma.account.update({ where: { id: rec.accountId! }, data: { deposit: { increment: amt } } }));
        ops.push(prisma.financialHistory.create({ data: { ...fhSnap, accountId: rec.accountId, type: "DEPOSIT", amount: amt, description: rec.method ? `Deposit via ${rec.method}` : "Deposit", mode: "REALTIME", createdBy: by } }));
      } else if (kind === "WITHDRAWAL") {
        ops.push(prisma.account.update({ where: { id: rec.accountId! }, data: { withdrawal: { increment: amt } } }));
        ops.push(prisma.financialHistory.create({ data: { ...fhSnap, accountId: rec.accountId, type: "WITHDRAWAL", amount: amt, description: rec.method ? `Withdrawal via ${rec.method}` : "Withdrawal", mode: "REALTIME", createdBy: by } }));
      } else if (kind === "CREDIT_REQUEST") {
        // Add instant credit to account
        const settleTo = b.settleTo ? new Date(b.settleTo) : null;
        ops.push(prisma.account.update({ where: { id: rec.accountId! }, data: { credit: { increment: amt }, ...(settleTo ? { creditSettleFrom: new Date(), creditSettleTo: settleTo } : {}) } }));
        ops.push(prisma.financialHistory.create({ data: { ...fhSnap, accountId: rec.accountId, type: "CREDIT_IN", amount: amt, description: "Instant Credit — $" + Number(rec.amount).toFixed(2) + (settleTo ? " (due " + settleTo.toISOString().slice(0, 10) + ")" : ""), mode: "REALTIME", createdBy: by } }));
        await prisma.$transaction(ops);
        await audit(tenantId, "credit.instant.approved", (accFull?.login || rec.accountId) + " instant credit $" + rec.amount + (settleTo ? " due " + settleTo.toISOString().slice(0, 10) : ""), by);
        try {
          if (accFull?.userId) await notify(tenantId, accFull.userId, "Instant Credit Approved", `Your instant credit of $${rec.amount} has been approved.`, "FUNDS").catch(() => {});
          notifyStaff(tenantId, { title: "Instant Credit approved — " + (accFull?.login || ""), body: `$${rec.amount} by ${by}`, type: "FUNDS" }, accFull?.managerId).catch(() => {});
        } catch {}
        return NextResponse.json({ ok: true });
      } else if (kind === "CREDIT_CLEAR") {
        // Clear credit + record deposit for the amount paid
        const creditAmt = Math.min(Number(rec.amount), Number(accFull?.credit || 0));
        const willClearFully = Number(accFull?.credit || 0) - creditAmt <= 0;
        ops.push(prisma.account.update({ where: { id: rec.accountId! }, data: { deposit: { increment: amt }, ...(creditAmt > 0 ? { credit: { decrement: new Prisma.Decimal(creditAmt) } } : {}), ...(willClearFully ? { creditSettleFrom: null, creditSettleTo: null } : {}) } }));
        ops.push(prisma.financialHistory.create({ data: { ...fhSnap, accountId: rec.accountId, type: "DEPOSIT", amount: amt, description: "Credit Clearance Deposit", mode: "REALTIME", createdBy: by } }));
        if (creditAmt > 0) {
          ops.push(prisma.financialHistory.create({ data: { ...fhSnap, accountId: rec.accountId, type: "CREDIT_OUT", amount: new Prisma.Decimal(creditAmt), description: "Instant Credit Cleared — $" + creditAmt.toFixed(2), mode: "REALTIME", createdBy: by } }));
        }
        await prisma.$transaction(ops);
        await audit(tenantId, "credit.clear.approved", (accFull?.login || rec.accountId) + " credit cleared $" + creditAmt.toFixed(2) + " deposit $" + rec.amount, by);
        try {
          if (accFull?.userId) await notify(tenantId, accFull.userId, "Credit Cleared", `Your credit clearance of $${rec.amount} has been approved. Credit reduced by $${creditAmt.toFixed(2)}.`, "FUNDS").catch(() => {});
          notifyStaff(tenantId, { title: "Credit clearance approved — " + (accFull?.login || ""), body: `$${rec.amount} by ${by}`, type: "FUNDS" }, accFull?.managerId).catch(() => {});
        } catch {}
        return NextResponse.json({ ok: true });
      }
    }

    // Standard DEPOSIT/WITHDRAWAL flow
    const stdAcc = rec.accountId ? await prisma.account.findUnique({ where: { id: rec.accountId }, select: { userId: true, login: true, managerId: true, name: true } }) : null;
    await prisma.$transaction(ops);
    await audit(s.tenantId as string, "payment." + status.toLowerCase(), (stdAcc?.login || rec.accountId) + " " + rec.kind + " $" + rec.amount + (rec.method ? " via " + rec.method : ""), s.email || "admin");

    // Referral reward on deposit approval
    if (approve && kind === "DEPOSIT") {
      try {
        if (stdAcc?.userId) {
          const referral = await (prisma.referral as any).findFirst({ where: { refereeId: stdAcc.userId, tenantId: s.tenantId } });
          if (referral) {
            const cfg = await prisma.setting.findUnique({ where: { key: `referral:${s.tenantId}` } });
            const config: any = (cfg?.value as any) || {};
            const depositPct = Number(config.depositPercent || 0);
            const signupAmt  = Number(config.signupBonus  || 0);
            const minDep     = Number(config.minDepositForSignup || 0);
            const depAmount  = Number(rec.amount);
            const refAcc = await prisma.account.findFirst({ where: { userId: referral.referrerId, tenantId: s.tenantId as string, type: "LIVE", deactivated: false }, orderBy: { createdAt: "asc" } });
            if (refAcc) {
              let earned = 0;
              if (depositPct > 0 && depAmount >= minDep) {
                const bonus = Math.round(depAmount * depositPct) / 100;
                if (bonus > 0) { await adjustBalance(s.tenantId as string, refAcc.id, "REFERRAL", bonus, `Referral deposit bonus (${depositPct}% of $${depAmount})`, "system"); earned += bonus; }
              }
              if (!referral.signupBonusPaid && signupAmt > 0 && depAmount >= minDep) {
                await adjustBalance(s.tenantId as string, refAcc.id, "REFERRAL", signupAmt, "Referral signup bonus", "system");
                earned += signupAmt;
              }
              await (prisma.referral as any).update({ where: { id: referral.id }, data: { signupBonusPaid: true, ...(earned > 0 ? { totalEarned: { increment: new Prisma.Decimal(earned) } } : {}) } });
            }
          }
        }
      } catch {}
    }

    try {
      const t = kind === "DEPOSIT" ? "Deposit" : "Withdrawal";
      if (stdAcc?.userId) {
        const msg = `${t} of ${rec.amount} ${approve ? "approved ✓" : "rejected"}`;
        await notify(s.tenantId as string, stdAcc.userId, `${t} ${approve ? "Approved" : "Rejected"}`, msg, "FUNDS").catch(() => {});
        sendUserMail(s.tenantId as string, stdAcc.userId, `${t} ${approve ? "Approved" : "Rejected"} – $${rec.amount}`,
          (brand) => depositWithdrawalEmail(brand, { holderName: (stdAcc as any).name || stdAcc.login, kind: rec.kind as "DEPOSIT" | "WITHDRAWAL", amount: rec.amount as any, method: (rec as any).method, status: approve ? "APPROVED" : "REJECTED", login: stdAcc.login })
        ).catch(() => {});
      }
      notifyStaff(s.tenantId as string, { title: `${t} ${approve ? "approved" : "rejected"} — ${stdAcc?.login || ""}`, body: `${rec.amount} ${rec.method || ""} by ${s.email || "admin"}`, type: "FUNDS" }, stdAcc?.managerId).catch(() => {});
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
