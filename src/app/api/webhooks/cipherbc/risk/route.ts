import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCipherbcRiskSignature, signWithRiskKey } from "@/lib/cipherbc";

// CipherBC calls this BEFORE processing a withdrawal to do a secondary risk check.
// They ask: "Is this withdrawal valid? Should we proceed?"
// We verify the request, check the PaymentRequest, and respond with approval or rejection.
//
// Expected inbound payload: { merchantOrderId, orderId, amount, currency, userId, ... }
// Expected outbound response: { code: "SUCCESS", data: { approved: true, remark?: string }, signature }

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const sig = req.headers.get("x-signature") || req.headers.get("x-cipherbc-signature") || "";
  const keyConfigured = !!process.env.CIPHERBC_RISK_PUBLIC_KEY_B64;
  if (keyConfigured && !verifyCipherbcRiskSignature(raw, sig)) {
    console.error("[CipherBC/risk] Invalid signature");
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const { merchantOrderId, orderId, amount } = payload;

  if (!merchantOrderId) {
    return NextResponse.json({ code: "MISSING_MERCHANT_ORDER_ID" }, { status: 400 });
  }

  // Look up the withdrawal request
  const request = await prisma.paymentRequest.findFirst({
    where: { id: merchantOrderId, kind: "WITHDRAWAL" },
    include: { account: { select: { id: true, deposit: true, withdrawal: true, credit: true, bonus: true, insurance: true, pnl: true, tenantId: true } } },
  });

  let approved = false;
  let remark = "";

  if (!request) {
    remark = "Order not found in our system";
    approved = false;
  } else if (request.status === "REJECTED" || request.status === "CANCELLED") {
    remark = "Withdrawal has been cancelled or rejected";
    approved = false;
  } else {
    // Verify the amount matches what we have on record
    const recordedAmount = Number(request.amount);
    const requestedAmount = Number(amount);
    if (Math.abs(recordedAmount - requestedAmount) > 0.01) {
      remark = "Amount mismatch";
      approved = false;
    } else {
      // Check that the account has sufficient withdrawable balance
      const acc = request.account;
      const balance = Number(acc.deposit) - Number(acc.withdrawal) + Number(acc.credit) + Number(acc.bonus) + Number(acc.insurance) + Number(acc.pnl);
      if (balance >= requestedAmount) {
        approved = true;
        remark = "Approved";
      } else {
        approved = false;
        remark = "Insufficient balance";
      }
    }
  }

  const responseData = {
    merchantOrderId,
    orderId: orderId || merchantOrderId,
    approved,
    remark,
  };

  // Sign our response with the risk private key so CipherBC can verify it came from us
  let signature = "";
  try {
    signature = signWithRiskKey(JSON.stringify(responseData));
  } catch (e) {
    console.error("[CipherBC/risk] Could not sign response:", e);
  }

  console.log(`[CipherBC/risk] Risk check for ${merchantOrderId}: approved=${approved}, remark=${remark}`);

  return NextResponse.json({
    code: "SUCCESS",
    data: responseData,
    signature,
  });
}
