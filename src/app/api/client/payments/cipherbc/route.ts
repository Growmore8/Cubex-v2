import { NextRequest, NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { signWithBusinessKey } from "@/lib/cipherbc";

// Client calls this to initiate a CipherBC (HyperBC) deposit.
// We create a PaymentRequest, call HyperBC to create a payment order,
// and return the paymentUrl for the client to be redirected to.
export async function POST(req: NextRequest) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const appId = process.env.CIPHERBC_APP_ID;
  const apiBase = (process.env.CIPHERBC_API_BASE_URL || "").replace(/\/$/, "");
  if (!appId || !apiBase) {
    return NextResponse.json({ ok: false, error: "Payment gateway not available" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  if (!(amount >= 1)) {
    return NextResponse.json({ ok: false, error: "Minimum deposit is $1" }, { status: 400 });
  }

  // Resolve the client's live account — prefer explicit accountId, fall back to oldest LIVE account
  const reqAccId = body?.accountId ? String(body.accountId) : "";
  const account = reqAccId
    ? await prisma.account.findFirst({ where: { id: reqAccId, tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, select: { id: true } })
    : await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!account) return NextResponse.json({ ok: false, error: "Live account not found" }, { status: 404 });

  // Create a PENDING PaymentRequest — its UUID becomes the merchantOrderId sent to HyperBC
  const paymentRequest = await prisma.paymentRequest.create({
    data: {
      tenantId: s.tenantId!,
      accountId: account.id,
      kind: "DEPOSIT",
      amount,
      method: "CipherBC",
      status: "PENDING",
      note: "CipherBC gateway deposit",
      details: { gateway: "cipherbc" },
    },
  });

  // Build the HyperBC order creation request
  // Notify URL: where HyperBC will POST when payment is confirmed
  const notifyUrl = "https://api.orbitfxsolution.com/api/webhooks/cipherbc/deposit";
  const origin = req.headers.get("origin") || "https://api.orbitfxsolution.com";
  const returnUrl = `${origin.replace(/\/$/, "")}/client/wallet?status=paid`;

  const orderPayload = {
    appId,
    merchantOrderId: paymentRequest.id,
    amount: amount.toFixed(2),
    currency: "USDT",
    notifyUrl,
    returnUrl,
  };
  const payloadStr = JSON.stringify(orderPayload);

  // Sign the request body with our business private key
  let signature = "";
  try { signature = signWithBusinessKey(payloadStr); } catch {}

  // Call HyperBC API — endpoint: POST {apiBase}/order/create
  let cipherResp: Response | null = null;
  try {
    cipherResp = await fetch(`${apiBase}/order/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "X-Signature": signature,
      },
      body: payloadStr,
    });
  } catch {
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Could not reach payment gateway. Try again." }, { status: 502 });
  }

  const data = await cipherResp.json().catch(() => null);
  if (!cipherResp.ok || !data || data.code !== "SUCCESS" || !data.data?.paymentUrl) {
    console.error("[CipherBC] Order creation failed:", JSON.stringify(data));
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: data?.message || "Gateway order creation failed. Try again." }, { status: 502 });
  }

  // Persist the HyperBC orderId for reconciliation
  await prisma.paymentRequest.update({
    where: { id: paymentRequest.id },
    data: { details: { gateway: "cipherbc", cipherbcOrderId: data.data.orderId } },
  }).catch(() => {});

  return NextResponse.json({ ok: true, paymentUrl: data.data.paymentUrl });
}
