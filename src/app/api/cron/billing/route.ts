import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

const PLAN_PRICES: Record<string, number> = { STARTER: 499, PRO: 999, ENTERPRISE: 1499 };

export async function POST() {
  const h = await headers();
  const secret = process.env.CRON_SECRET;
  const provided = h.get("x-cron-secret");
  let authorized = secret ? provided === secret : true;
  if (!authorized) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const in2Days = new Date(now.getTime() + 2 * 86_400_000);

  // 1. Auto-generate invoice 2 days before subscription endsAt
  const nearExpiry = await prisma.subscription.findMany({
    where: { status: "ACTIVE", endsAt: { gte: now, lte: in2Days } },
    include: { tenant: { select: { id: true, name: true, status: true } } },
  });

  let generated = 0;
  for (const sub of nearExpiry) {
    if (!sub.endsAt || !sub.tenant) continue;
    const period = sub.endsAt.toISOString().slice(0, 7); // YYYY-MM

    // Skip if invoice already exists for this tenant+period
    const exists = await prisma.invoice.findFirst({ where: { tenantId: sub.tenantId, period } });
    if (exists) continue;

    const count = await prisma.invoice.count();
    const number = "INV-" + String(count + 1).padStart(5, "0");
    const amount = PLAN_PRICES[sub.plan] ?? 999;
    const dueAt = sub.endsAt; // payment due on subscription expiry

    await prisma.invoice.create({
      data: { tenantId: sub.tenantId, number, period, plan: sub.plan, amount, dueAt, status: "PENDING" },
    });
    generated++;
  }

  // 2. Mark pending invoices as OVERDUE + suspend tenant if past due date
  const overdueInvoices = await prisma.invoice.findMany({
    where: { status: "PENDING", dueAt: { lt: now } },
    select: { id: true, tenantId: true },
  });

  let suspended = 0;
  for (const inv of overdueInvoices) {
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "OVERDUE" } });
    await prisma.tenant.update({ where: { id: inv.tenantId }, data: { status: "SUSPENDED" } });
    suspended++;
  }

  return NextResponse.json({ ok: true, generated, suspended, checkedAt: now.toISOString() });
}
