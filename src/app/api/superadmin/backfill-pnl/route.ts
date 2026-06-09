import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// One-time, idempotent backfill: turn past `client.manualPnl` audit entries into
// PNL_ADJUST FinancialHistory rows so already-applied manual P/L shows in History
// (older adjustments were only added to the balance, never recorded as history).
// Safe to run multiple times — it skips entries that already have a matching row.
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const audits = await prisma.auditLog.findMany({ where: { action: "client.manualPnl" }, orderBy: { createdAt: "asc" }, take: 5000 });
  let created = 0, skipped = 0, unmatched = 0;

  for (const a of audits) {
    const parts = String(a.detail || "").trim().split(/\s+/);
    const login = parts[0];
    const amount = Number(parts[1]);
    if (!login || !isFinite(amount) || amount === 0) { skipped++; continue; }
    const acc = await prisma.account.findFirst({ where: { login, ...(a.tenantId ? { tenantId: a.tenantId } : {}) }, select: { id: true } });
    if (!acc) { unmatched++; continue; }
    // Dedup: a PNL_ADJUST row for this account, same amount, within ±5 min of the audit time.
    const lo = new Date(a.createdAt.getTime() - 5 * 60000);
    const hi = new Date(a.createdAt.getTime() + 5 * 60000);
    const existing = await prisma.financialHistory.findFirst({
      where: { accountId: acc.id, type: "PNL_ADJUST" as any, amount: new Prisma.Decimal(amount), appliedAt: { gte: lo, lte: hi } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }
    await prisma.financialHistory.create({
      data: { accountId: acc.id, type: "PNL_ADJUST" as any, amount: new Prisma.Decimal(amount), description: "Manual P/L (backfilled)", mode: "MANUAL" as any, createdBy: a.performedBy || "system", appliedAt: a.createdAt },
    }).catch(() => {});
    created++;
  }

  return NextResponse.json({ ok: true, scanned: audits.length, created, skipped, unmatched });
}
