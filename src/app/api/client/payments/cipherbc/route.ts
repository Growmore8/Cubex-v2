import { NextRequest, NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { signWithBusinessKey } from "@/lib/cipherbc";

// CipherBC signature: sort all params (except sign) a→z as "key=value&key=value",
// then sign with MD5withRSA using our merchant private key.
function buildSign(params: Record<string, string>): string {
  const str = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return signWithBusinessKey(str);
}

// Remove trailing zeros: 100.00 → "100", 100.50 → "100.5"
function formatAmount(n: number): string {
  return parseFloat(n.toFixed(8)).toString();
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

  const reqAccId = body?.accountId ? String(body.accountId) : "";
  const account = reqAccId
    ? await prisma.account.findFirst({ where: { id: reqAccId, tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, select: { id: true } })
    : await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!account) return NextResponse.json({ ok: false, error: "Live account not found" }, { status: 404 });

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

  const origin = req.headers.get("origin") || "https://trade.orbitfxsolution.com";
  const successUrl = `${origin.replace(/\/$/, "")}/client/wallet?status=paid`;
  const failUrl = `${origin.replace(/\/$/, "")}/client/wallet?status=failed`;

  // UUID without hyphens = 32 hex chars, which satisfies CipherBC's merchant_order_id constraint
  const merchantOrderId = paymentRequest.id.replace(/-/g, "");

  // Build params WITHOUT sign — field names exactly as per CipherBC docs
  const params: Record<string, string> = {
    app_id: appId,
    version: "1.0",
    time: String(Math.floor(Date.now() / 1000)),
    merchant_order_id: merchantOrderId,
    amount: formatAmount(amount),
    currency: "usd",
    success_url: successUrl,
    fail_url: failUrl,
  };

  let sign = "";
  try {
    sign = buildSign(params);
  } catch (e) {
    console.error("[CipherBC] Signing failed:", e);
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Signature error" }, { status: 500 });
  }

  const orderPayload = { ...params, sign };
  console.log("[CipherBC] Sending to", `${apiBase}/h5_order/create`, JSON.stringify(orderPayload));

  let cipherResp: Response | null = null;
  try {
    cipherResp = await fetch(`${apiBase}/h5_order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(orderPayload),
    });
  } catch (e) {
    console.error("[CipherBC] Fetch error:", e);
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Could not reach payment gateway. Try again." }, { status: 502 });
  }

  const data = await cipherResp.json().catch(() => null);
  console.log("[CipherBC] Order response:", JSON.stringify(data));

  if (!data || data.status !== 200 || !data.data?.checkout_url) {
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } }).catch(() => {});
    return NextResponse.json({ ok: false, error: data?.msg || "Gateway order creation failed. Try again." }, { status: 502 });
  }

  await prisma.paymentRequest.update({
    where: { id: paymentRequest.id },
    data: { details: { gateway: "cipherbc", cipherbcOrderNo: data.data.order_no } },
  }).catch(() => {});

  return NextResponse.json({ ok: true, paymentUrl: data.data.checkout_url });
}
