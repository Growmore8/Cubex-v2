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
    if (rec.status !== "PENDING") throw new Error("Already " + String(rec.status).toLowerCase());
    const approve = b.action === "approve" || b.status === "APPROVED";
    // acting on the request at all (approve OR reject) requires the permission
    await assertCan(s, rec.kind === "WITHDRAWAL" ? "processWithdrawals" : "processDeposits");
    const status = approve ? "APPROVED" : "REJECTED";
    const ops: any[] = [prisma.paymentRequest.update({ where: { id: rec.id }, data: { status: status as any, reviewedBy: s.email || "admin" } })];
    if (approve) {
      const amt = new Prisma.Decimal(rec.amount as any);
      if (rec.kind === "DEPOSIT") ops.push(prisma.account.update({ where: { id: rec.accountId }, data: { deposit: { increment: amt } } }));
      else if (rec.kind === "WITHDRAWAL") ops.push(prisma.account.update({ where: { id: rec.accountId }, data: { withdrawal: { increment: amt } } }));
      // Record it in financial history so the client sees the transaction.
      ops.push(prisma.financialHistory.create({ data: { accountId: rec.accountId, type: rec.kind as any, amount: amt, description: rec.method ? `${rec.kind} via ${rec.method}` : rec.kind, mode: "REALTIME" as any, createdBy: s.email || "admin" } }));
    }
    await prisma.$transaction(ops);
    await audit(s.tenantId as string, "payment." + status.toLowerCase(), rec.kind + " " + rec.amount + " " + (rec.method || ""), s.email || "admin");

    // Referral reward: credit the referrer when their referred client makes a deposit
    if (approve && rec.kind === "DEPOSIT") {
      try {
        const depAcc = await prisma.account.findUnique({ where: { id: rec.accountId }, select: { userId: true } });
        if (depAcc?.userId) {
          const referral = await (prisma.referral as any).findFirst({ where: { refereeId: depAcc.userId, tenantId: s.tenantId } });
          if (referral) {
            const cfg = await prisma.setting.findUnique({ where: { key: `referral:${s.tenantId}` } });
            const config: any = (cfg?.value as any) || {};
            const depositPct = Number(config.depositPercent || 0);
            const signupAmt  = Number(config.signupBonus  || 0);
            const minDep     = Number(config.minDepositForSignup || 0);
            const depAmount  = Number(rec.amount);
            // Find referrer's primary LIVE account
            const refAcc = await prisma.account.findFirst({
              where: { userId: referral.referrerId, tenantId: s.tenantId as string, type: "LIVE", deactivated: false },
              orderBy: { createdAt: "asc" },
            });
            if (refAcc) {
              let earned = 0;
              // Deposit % bonus on every qualifying deposit
              if (depositPct > 0 && depAmount >= minDep) {
                const bonus = Math.round(depAmount * depositPct) / 100;
                if (bonus > 0) {
                  await adjustBalance(s.tenantId as string, refAcc.id, "REFERRAL", bonus, `Referral deposit bonus (${depositPct}% of $${depAmount})`, "system");
                  earned += bonus;
                }
              }
              // One-time signup bonus on first deposit
              if (!referral.signupBonusPaid && signupAmt > 0 && depAmount >= minDep) {
                await adjustBalance(s.tenantId as string, refAcc.id, "REFERRAL", signupAmt, "Referral signup bonus", "system");
                earned += signupAmt;
              }
              await (prisma.referral as any).update({
                where: { id: referral.id },
                data: {
                  signupBonusPaid: true,
                  ...(earned > 0 ? { totalEarned: { increment: new Prisma.Decimal(earned) } } : {}),
                },
              });
            }
          }
        }
      } catch {}
    }

    // Notify the client of the decision
    try {
      const acc = await prisma.account.findUnique({ where: { id: rec.accountId }, select: { userId: true, login: true, managerId: true, name: true } });
      const t = rec.kind === "DEPOSIT" ? "Deposit" : "Withdrawal";
      if (acc?.userId) {
        const msg = `${t} of ${rec.amount} ${approve ? "approved ✓" : "rejected"}`;
        await notify(s.tenantId as string, acc.userId, `${t} ${approve ? "Approved" : "Rejected"}`, msg, "FUNDS").catch(() => {});
        // Email notification
        sendUserMail(s.tenantId as string, acc.userId,
          `${t} ${approve ? "Approved" : "Rejected"} – $${rec.amount}`,
          (brand) => depositWithdrawalEmail(brand, {
            holderName: (acc as any).name || acc.login,
            kind: rec.kind as "DEPOSIT" | "WITHDRAWAL",
            amount: rec.amount as any,
            method: (rec as any).method,
            status: approve ? "APPROVED" : "REJECTED",
            login: acc.login,
          })
        ).catch(() => {});
      }
      // Confirmation to staff + superadmin that the request was actioned.
      notifyStaff(s.tenantId as string, { title: `${t} ${approve ? "approved" : "rejected"} — ${acc?.login || ""}`, body: `${rec.amount} ${rec.method || ""} by ${s.email || "admin"}`, type: "FUNDS" }, acc?.managerId).catch(() => {});
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}