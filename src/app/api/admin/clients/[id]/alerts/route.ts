import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const acc = await prisma.account.findFirst({ where: { id, tenantId: s.tenantId! } });
  if (!acc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const alerts = await prisma.priceAlert.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, alerts: alerts.map((a) => ({ id: a.id, symbol: a.symbol, condition: a.condition, price: Number(a.price), note: a.note, triggered: a.triggered, createdAt: a.createdAt })) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const alertId = url.searchParams.get("alertId");
  if (!alertId) return NextResponse.json({ ok: false, error: "alertId required" }, { status: 400 });
  await prisma.priceAlert.deleteMany({ where: { id: alertId, account: { id, tenantId: s.tenantId! } } });
  return NextResponse.json({ ok: true });
}
