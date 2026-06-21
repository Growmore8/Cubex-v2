import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Deletes demo (TRIALING) tenants whose trial ended more than TRIAL_GRACE_DAYS
// ago (default 14). Called by the in-process scheduler with x-cron-secret, or
// manually by a SuperAdmin. Skips if no expired-past-grace trials exist.
export async function POST() {
  const h = await headers();
  const secret = process.env.CRON_SECRET;
  const provided = h.get("x-cron-secret");
  let authorized = false;
  if (secret && provided === secret) authorized = true;
  if (!authorized) { const s = await requireSuperAdmin(); if (s) authorized = true; }
  if (!authorized && !secret) authorized = true;
  if (!authorized) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const grace = Number(process.env.TRIAL_GRACE_DAYS || 14);
  const cutoff = new Date(Date.now() - grace * 86400000);
  const expired = await prisma.subscription.findMany({ where: { status: "TRIALING" as any, endsAt: { lt: cutoff } }, select: { tenantId: true } });
  let deleted = 0;
  for (const e of expired) {
    await prisma.tenant.delete({ where: { id: e.tenantId } }).then(() => { deleted++; }).catch(() => {});
  }
  return NextResponse.json({ ok: true, deleted, graceDays: grace });
}
