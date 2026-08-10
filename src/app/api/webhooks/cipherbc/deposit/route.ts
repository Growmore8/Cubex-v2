import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCipherbcBusinessPublicKey } from "@/lib/cipherbc";
import crypto from "crypto";

// HyperBC callback signature verification:
// - Parse body JSON, remove the "sign" field
// - Sort remaining keys alphabetically, join as "key=value&key=value"
// - RSA-SHA256 verify against their business public key
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

  // Verify HyperBC's signature
  const keyConfigured = !!process.env.CIPHERBC_BUSINESS_PUBLIC_KEY_B64;
  if (keyConfigured && !verifyCallback(payload, payload.sign || "")) {
    console.error("[CipherBC/deposit] Invalid signature");
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const merchantOrderId = payload.merchant_order_id || payload.out_trade_no;
  const orderId = payload.order_no || payload.order_id;
  const status = String(payload.status ?? "");

  // CipherBC status: 0=pending, 1=complete, 2=abnormal, 5=overpayment, 10=cancelled
  const isSuccess = status === "1" || status === "5";
  if (!isSuccess) {
    return NextResponse.json({ code: "SUCCESS" });
  }

  if (!merchantOrderId) {
    return NextResponse.json({ code: "MISSING_ORDER_ID" }, { status: 400 });
  }

  const request = await prisma.paymentRequest.findFirst({
    where: { id: merchantOrderId, kind: "DEPOSIT", status: "PENDING" },
    include: { account: true },
  });

  if (!request) {
    console.warn("[CipherBC/deposit] PaymentRequest not found or already processed:", merchantOrderId);
    return NextResponse.json({ code: "SUCCESS" });
  }

  await prisma.$transaction([
    prisma.paymentRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", reviewedBy: "cipherbc-gateway" },
    }),
    prisma.account.update({
      where: { id: request.accountId },
      data: { deposit: { increment: request.amount } },
    }),
    prisma.financialHistory.create({
      data: {
        accountId: request.accountId,
        type: "DEPOSIT",
        amount: request.amount,
        description: `Deposit via CipherBC`,
        reference: orderId || merchantOrderId,
        mode: "REALTIME",
        createdBy: "cipherbc-gateway",
      },
    }),
  ]);

  console.log(`[CipherBC/deposit] Approved deposit ${request.amount} for account ${request.accountId} (ref: ${orderId})`);
  return NextResponse.json({ code: "SUCCESS" });
}
