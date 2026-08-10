import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCipherbcBusinessPublicKey } from "@/lib/cipherbc";
import crypto from "crypto";

function verifyCallback(payload: Record<string, unknown>, sign: string): boolean {
  const pubKey = getCipherbcBusinessPublicKey();
  if (!pubKey) return false;
  const str = Object.keys(payload)
    .filter((k) => k !== "sign" && payload[k] !== undefined && payload[k] !== null && payload[k] !== "")
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("&");
  try {
    return crypto.createVerify("RSA-SHA256").update(str, "utf-8").verify(pubKey, sign, "base64");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const keyConfigured = !!process.env.CIPHERBC_BUSINESS_PUBLIC_KEY_B64;
  if (keyConfigured && !verifyCallback(payload, payload.sign || "")) {
    console.error("[CipherBC/withdrawal] Invalid signature");
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const merchantOrderId = payload.out_trade_no || payload.merchantOrderId;
  const orderId = payload.order_id || payload.orderId;
  const rawStatus = String(payload.status || "").toUpperCase();
  const failReason = payload.fail_reason || payload.failReason || "";

  const isSuccess = rawStatus === "1" || rawStatus === "SUCCESS";
  const isFailed = rawStatus === "2" || rawStatus === "0" || rawStatus === "FAILED";

  if (!merchantOrderId) {
    return NextResponse.json({ code: "MISSING_ORDER_ID" }, { status: 400 });
  }

  const request = await prisma.paymentRequest.findFirst({
    where: { id: merchantOrderId, kind: "WITHDRAWAL" },
  });

  if (!request) {
    console.warn("[CipherBC/withdrawal] PaymentRequest not found:", merchantOrderId);
    return NextResponse.json({ code: "SUCCESS" });
  }

  if (isSuccess) {
    const existing = await prisma.financialHistory.findFirst({ where: { reference: orderId || merchantOrderId } });
    if (!existing) {
      if (request.status === "PENDING") {
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
    }
    console.log(`[CipherBC/withdrawal] Withdrawal ${request.amount} completed for account ${request.accountId}`);
  } else if (isFailed) {
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
    console.warn(`[CipherBC/withdrawal] FAILED for ${merchantOrderId}: ${failReason}`);
  }

  return NextResponse.json({ code: "SUCCESS" });
}
