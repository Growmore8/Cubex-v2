import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCipherbcSignature } from "@/lib/cipherbc";

// CipherBC POSTs here when a withdrawal they processed is complete or failed.
// Expected payload: { merchantOrderId, orderId, amount, currency, status, failReason?, ... }
// merchantOrderId = our PaymentRequest.id
// status = "SUCCESS" | "FAILED"

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const sig = req.headers.get("x-signature") || req.headers.get("x-cipherbc-signature") || "";
  const keyConfigured = !!process.env.CIPHERBC_BUSINESS_PUBLIC_KEY_B64;
  if (keyConfigured && !verifyCipherbcSignature(raw, sig)) {
    console.error("[CipherBC/withdrawal] Invalid signature");
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const { merchantOrderId, orderId, status, failReason } = payload;

  if (!merchantOrderId) {
    return NextResponse.json({ code: "MISSING_MERCHANT_ORDER_ID" }, { status: 400 });
  }

  // Find the pending or approved withdrawal request
  const request = await prisma.paymentRequest.findFirst({
    where: { id: merchantOrderId, kind: "WITHDRAWAL" },
  });

  if (!request) {
    console.warn("[CipherBC/withdrawal] PaymentRequest not found:", merchantOrderId);
    return NextResponse.json({ code: "OK" });
  }

  if (status === "SUCCESS") {
    if (request.status === "APPROVED") {
      // Already approved — just record in financial history if not already done
      const existing = await prisma.financialHistory.findFirst({
        where: { reference: orderId },
      });
      if (!existing) {
        await prisma.financialHistory.create({
          data: {
            accountId: request.accountId,
            type: "WITHDRAWAL",
            amount: request.amount,
            description: `Withdrawal via CipherBC`,
            reference: orderId || merchantOrderId,
            mode: "REALTIME",
            createdBy: "cipherbc-gateway",
          },
        });
      }
    } else if (request.status === "PENDING") {
      // Auto-approve withdrawal and deduct from account
      await prisma.$transaction([
        prisma.paymentRequest.update({
          where: { id: request.id },
          data: { status: "APPROVED", reviewedBy: "cipherbc-gateway" },
        }),
        prisma.account.update({
          where: { id: request.accountId },
          data: { withdrawal: { increment: request.amount } },
        }),
        prisma.financialHistory.create({
          data: {
            accountId: request.accountId,
            type: "WITHDRAWAL",
            amount: request.amount,
            description: `Withdrawal via CipherBC`,
            reference: orderId || merchantOrderId,
            mode: "REALTIME",
            createdBy: "cipherbc-gateway",
          },
        }),
      ]);
    }

    console.log(`[CipherBC/withdrawal] Withdrawal ${request.amount} completed for account ${request.accountId} (ref: ${orderId})`);
  } else if (status === "FAILED") {
    // Mark request as rejected so the client knows
    if (request.status === "PENDING") {
      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          reviewedBy: "cipherbc-gateway",
          rejectReason: failReason || "Rejected by CipherBC",
        },
      });
    }
    console.warn(`[CipherBC/withdrawal] Withdrawal FAILED for ${merchantOrderId}: ${failReason}`);
  }

  return NextResponse.json({ code: "SUCCESS" });
}
