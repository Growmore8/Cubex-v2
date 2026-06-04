import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { PACKAGES } from "@/config/packages";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const tenantId = sp.get("tenantId") || undefined;
  const status = sp.get("status") || undefined;
  const where: any = {};
  if (tenantId) where.tenantId = tenantId;
  if (status) where.status = status;
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { tenant: { select: { name: true, brandName: true } } },
  });
  return NextResponse.json({ ok: true, invoices });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const { tenantId, period, plan, amount, dueAt, notes } = b;
    if (!tenantId || !period || !plan || !amount) throw new Error("tenantId, period, plan, amount required");

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error("Tenant not found");

    // Generate invoice number: INV-YYYYMM-NNN
    const count = await prisma.invoice.count({ where: { period } });
    const num = String(count + 1).padStart(3, "0");
    const number = `INV-${period.replace("-", "")}-${num}`;

    const existing = await prisma.invoice.findFirst({ where: { tenantId, period } });
    if (existing) throw new Error(`Invoice for ${period} already exists for this tenant`);

    const inv = await prisma.invoice.create({
      data: {
        tenantId,
        number,
        period,
        plan: plan as any,
        amount: Number(amount),
        dueAt: dueAt ? new Date(dueAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        notes: notes || null,
        status: "PENDING",
      },
      include: { tenant: { select: { name: true, brandName: true } } },
    });
    return NextResponse.json({ ok: true, invoice: inv });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
