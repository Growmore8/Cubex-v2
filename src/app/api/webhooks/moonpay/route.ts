import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyMoonPayWebhook } from "@/lib/moonpay";
import { Prisma } from "@prisma/client";
import { notify } from "@/services/notification.service";
import { sendUserMail } from "@/lib/tenant-mail";
import { depositWithdrawalEmail } from "@/lib/email-templates";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("moonpay-signature") ?? "";

  if (!verifyMoonPayWebhook(rawBody, sigHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const data = payload?.data ?? payload;
  const status: string = data?.status ?? "";
  const externalId: string = data?.externalTransactionId ?? "";
  const moonpayTxId: string = data?.id ?? "";
  // Use the crypto amount actually received (quoteCurrencyAmount)
  const cryptoAmount: number = Number(data?.quoteCurrencyAmount ?? 0);

  if (!externalId || status !== "completed") {
    // Acknowledge non-terminal events without action
    return NextResponse.json({ ok: true });
  }

  const rec = await prisma.paymentRequest.findFirst({
    where: { id: externalId, kind: "DEPOSIT" as any, status: "PENDING" },
    include: { account: { select: { id: true, userId: true, login: true, name: true, tenantId: true, managerId: true } } },
  });

  if (!rec || !rec.account) {
    // Already processed or not found — idempotent response
    return NextResponse.json({ ok: true });
  }

  const creditAmount = cryptoAmount > 0 ? cryptoAmount : Number(rec.amount);
  const amt = new Prisma.Decimal(creditAmount);
  const tenantId = rec.tenantId;
  const acc = rec.account;

  await prisma.$transaction([
    prisma.paymentRequest.update({
      where: { id: rec.id },
      data: {
        status: "APPROVED" as any,
        reviewedBy: "MoonPay (auto)",
        details: { ...(rec.details as any), moonpayTxId } as any,
        amount: amt,
      },
    }),
    prisma.account.update({
      where: { id: acc.id },
      data: { deposit: { increment: amt } },
    }),
    prisma.financialHistory.create({
      data: {
        accountId: acc.id,
        type: "DEPOSIT",
        amount: amt,
        description: "MoonPay card deposit — tx: " + moonpayTxId,
        mode: "REALTIME",
        createdBy: "moonpay",
      },
    }),
  ]);

  await audit(tenantId, "payment.moonpay", acc.login + " card deposit $" + creditAmount.toFixed(2) + " tx:" + moonpayTxId, "moonpay");

  if (acc.userId) {
    notify(tenantId, acc.userId, "Deposit Approved", `Your card deposit of $${creditAmount.toFixed(2)} via MoonPay has been credited. ✓`, "FUNDS").catch(() => {});
    sendUserMail(tenantId, acc.userId, `Deposit Approved – $${creditAmount.toFixed(2)}`,
      (brand) => depositWithdrawalEmail(brand, { holderName: acc.name || acc.login, kind: "DEPOSIT", amount: Number(amt), method: "MoonPay Card", status: "APPROVED", login: acc.login })
    ).catch(() => {});
  }

  emitRefresh({ kind: "payment" });
  return NextResponse.json({ ok: true });
}
