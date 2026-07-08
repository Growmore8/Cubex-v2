import { NextResponse } from "next/server";
import { sendUserMail } from "@/lib/tenant-mail";
import { priceAlertEmail } from "@/lib/email-templates";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    req.headers.get("x-cron-secret") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`
  );
}

// Called by server.js checkPriceAlerts when an alert fires — sends the branded email.
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { tenantId, userId, holderName, symbol, condition, price, note } = await req.json();
    if (!tenantId || !userId || !symbol || !condition || price == null) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    await sendUserMail(
      tenantId,
      userId,
      `Price Alert Triggered – ${symbol}`,
      (brand) => priceAlertEmail(brand, {
        holderName: holderName || "Trader",
        symbol,
        condition: condition as "ABOVE" | "BELOW",
        targetPrice: Number(price),
        note: note ?? null,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
