import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { sendUserMail } from "@/lib/tenant-mail";
import { priceAlertEmail } from "@/lib/email-templates";

async function getAccount(s: any, accountId?: string) {
  if (accountId) {
    const a = await prisma.account.findFirst({ where: { tenantId: s.tenantId, userId: s.sub, id: accountId } });
    if (a) return a;
  }
  return prisma.account.findFirst({ where: { tenantId: s.tenantId, userId: s.sub }, orderBy: { createdAt: "asc" } });
}

export async function GET(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const a = await getAccount(s, url.searchParams.get("accountId") || undefined);
  if (!a) return NextResponse.json({ ok: true, alerts: [] });
  const alerts = await prisma.priceAlert.findMany({ where: { accountId: a.id }, orderBy: [{ triggered: "asc" }, { createdAt: "desc" }] });
  return NextResponse.json({ ok: true, alerts: alerts.map((al) => ({ id: al.id, symbol: al.symbol, condition: al.condition, price: Number(al.price), note: al.note, triggered: al.triggered })) });
}

export async function POST(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const a = await getAccount(s, b.accountId); if (!a) throw new Error("No account");
    if (!b.symbol || !b.condition || !b.price) throw new Error("symbol, condition, price required");
    if (!["ABOVE", "BELOW"].includes(b.condition)) throw new Error("condition must be ABOVE or BELOW");
    const alert = await prisma.priceAlert.create({ data: { tenantId: a.tenantId, accountId: a.id, symbol: b.symbol, condition: b.condition, price: b.price, note: b.note || null } });
    return NextResponse.json({ ok: true, id: alert.id });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

export async function PATCH(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id"); if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await prisma.priceAlert.updateMany({ where: { id, account: { tenantId: s.tenantId!, userId: s.sub } }, data: { triggered: false } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id"); if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const fired = url.searchParams.get("fire") === "1";

  // If fired=1 fetch the alert before deleting so we can email the user
  let alertSnap: any = null;
  if (fired) {
    alertSnap = await prisma.priceAlert.findFirst({ where: { id, account: { tenantId: s.tenantId!, userId: s.sub } }, include: { account: true } });
  }

  await prisma.priceAlert.deleteMany({ where: { id, account: { tenantId: s.tenantId!, userId: s.sub } } });

  if (fired && alertSnap && s.sub) {
    sendUserMail(s.tenantId!, s.sub,
      `Price Alert Triggered – ${alertSnap.symbol}`,
      (brand) => priceAlertEmail(brand, {
        holderName: (alertSnap.account as any)?.name || "Trader",
        symbol: alertSnap.symbol,
        condition: alertSnap.condition as "ABOVE" | "BELOW",
        targetPrice: Number(alertSnap.price),
        note: alertSnap.note,
      })
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
