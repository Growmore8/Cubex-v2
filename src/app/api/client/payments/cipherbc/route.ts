import { NextRequest, NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { signWithBusinessKey } from "@/lib/cipherbc";

// HyperBC signature: sort all params (except sign) alphabetically as
// "key=value&key=value", then RSA-SHA256 sign that string with our business private key.
function buildSign(params: Record<string, string>): string {
  const str = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return signWithBusinessKey(str);
}

function randomNonce(): string {
  return Math.random().toString(36).substring(2, 18) +
    Math.random().toString(36).substring(2, 18);
}

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

  // Resolve the client's live account
  const reqAccId = body?.accountId ? String(body.accountId) : "";
  const account = reqAccId
    ? await prisma.account.findFirst({ where: { id: reqAccId, tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, select: { id: true } })
    : await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!account) return NextResponse.json({ ok: false, error: "Live account not found" }, { status: 404 });

  // Create a PENDING PaymentRequest — its UUID becomes the merchant order ID
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

  const notifyUrl = "https://api.orbitfxsolution.com/api/webhooks/cipherbc/deposit";
  const origin = req.headers.get("origin") || "https://api.orbitfxsolution.com";
  const returnUrl = `${origin.replace(/\/$/, "")}/client/wallet?status=paid`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomNonce();

  // Build params WITHOUT sign first
  const params: Record<string, string> = {
    appid: appId,
    timestamp,
    nonce_str: nonceStr,
    out_trade_no: paymentRequest.id,
    amount: amount.toFixed(2),
    currency: "USDT",
    notify_url: notifyUrl,
    return_url: returnUrl,
  };

  // Sign the sorted key=value string with our business RSA private key
  let sign = "";
  try {
    sign = buildSign(params);
  } catch (e) {
    console.error("[CipherBC] Signing failed:", e);
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Signature error" }, { status: 500 });
  }

  const orderPayload = { ...params, sign };

  let cipherResp: Response | null = null;
  try {
    cipherResp = await fetch(`${apiBase}/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
    });
  } catch {
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Could not reach payment gateway. Try again." }, { status: 502 });
  }

  const data = await cipherResp.json().catch(() => null);
  console.log("[CipherBC] Order response:", JSON.stringify(data));

  if (!data || data.status !== 200 || !data.data?.pay_url) {
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: data?.msg || "Gateway order creation failed. Try again." }, { status: 502 });
  }

  // Persist the HyperBC order ID for reconciliation
  await prisma.paymentRequest.update({
    where: { id: paymentRequest.id },
    data: { details: { gateway: "cipherbc", cipherbcOrderId: data.data.order_id } },
  }).catch(() => {});

  return NextResponse.json({ ok: true, paymentUrl: data.data.pay_url });
}
