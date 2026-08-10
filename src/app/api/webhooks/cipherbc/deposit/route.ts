import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCipherbcSignature } from "@/lib/cipherbc";

// CipherBC POSTs here when a client's deposit is confirmed.
// Expected payload: { merchantOrderId, orderId, amount, currency, status, ... }
// merchantOrderId = our PaymentRequest.id (we pass this when creating the CipherBC payment order)
// status = "SUCCESS" | "FAILED" | "PENDING"

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verify CipherBC's signature using their platform public key
  const sig = req.headers.get("x-signature") || req.headers.get("x-cipherbc-signature") || "";
  const keyConfigured = !!process.env.CIPHERBC_BUSINESS_PUBLIC_KEY_B64;
  if (keyConfigured && !verifyCipherbcSignature(raw, sig)) {
    console.error("[CipherBC/deposit] Invalid signature");
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const { merchantOrderId, orderId, status } = payload;

  // Only process successful payments
  if (status !== "SUCCESS") {
    return NextResponse.json({ code: "OK", note: "non-success status acknowledged" });
  }

  if (!merchantOrderId) {
    return NextResponse.json({ code: "MISSING_MERCHANT_ORDER_ID" }, { status: 400 });
  }

  // Find the pending PaymentRequest
  const request = await prisma.paymentRequest.findFirst({
    where: { id: merchantOrderId, kind: "DEPOSIT", status: "PENDING" },
    include: { account: true },
  });

  if (!request) {
    // Already processed or not found — return OK to stop CipherBC from retrying
    console.warn("[CipherBC/deposit] PaymentRequest not found or already processed:", merchantOrderId);
    return NextResponse.json({ code: "OK" });
  }

  // Approve the deposit in a single transaction
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
