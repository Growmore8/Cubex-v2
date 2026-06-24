import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Daily cron: expire demo accounts (DEMO type, expiresAt < now).
// Before hard-deleting, writes an ExpiredAccount history record and
// pushes an in-app notification to the client.
// Also sends 3-day and 1-day advance warnings.
export async function POST() {
  const h = await headers();
  const secret = process.env.CRON_SECRET;
  const provided = h.get("x-cron-secret");
  let authorized = false;
  if (secret && provided === secret) authorized = true;
  if (!authorized) { const s = await requireSuperAdmin(); if (s) authorized = true; }
  if (!authorized && !secret) authorized = true;
  if (!authorized) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  let deleted = 0;
  let warned = 0;

  // ── 1. Hard-delete expired demo accounts ──────────────────────────────────
  const expired = await prisma.account.findMany({
    where: { type: "DEMO", expiresAt: { lt: now } },
    include: {
      user: { select: { id: true, name: true, email: true } },
      tenant: { select: { name: true, brandName: true } },
    },
  });

  for (const acc of expired) {
    try {
      const balance = Number(acc.deposit) + Number(acc.pnl) - Number(acc.withdrawal);
      const tenantName = acc.tenant?.brandName || acc.tenant?.name || "";
      // Write history before deletion (survives the cascade)
      await prisma.expiredAccount.create({
        data: {
          tenantId: acc.tenantId,
          tenantName,
          clientName: acc.name,
          clientEmail: acc.user?.email || null,
          login: acc.login,
          type: "DEMO",
          balance,
          expiredAt: acc.expiresAt ?? now,
        },
      });
      // Notify the client (in-app bell)
      if (acc.userId) {
        await prisma.notification.create({
          data: {
            tenantId: acc.tenantId,
            userId: acc.userId,
            title: "Demo account expired",
            body: `Your demo account #${acc.login} has expired and been removed. You can open a new demo account anytime.`,
            type: "NOTICE",
          },
        }).catch(() => {});
      }
      // Hard-delete — cascades to trades, history, financials, KYC, etc.
      await prisma.account.delete({ where: { id: acc.id } });
      deleted++;
    } catch (e) {
      console.error("[demo-cleanup] failed to delete", acc.login, e);
    }
  }

  // ── 2. Advance warnings (3 days and 1 day before expiry) ─────────────────
  const warnWindows = [
    { days: 3, label: "3 days" },
    { days: 1, label: "tomorrow" },
  ];
  for (const { days, label } of warnWindows) {
    const from = new Date(now.getTime() + (days - 1) * 86400000);
    const to   = new Date(now.getTime() + days * 86400000);
    const expiring = await prisma.account.findMany({
      where: { type: "DEMO", expiresAt: { gte: from, lt: to } },
      select: { id: true, login: true, tenantId: true, userId: true, expiresAt: true },
    });
    for (const acc of expiring) {
      if (!acc.userId) continue;
      // Check we haven't already sent this warning (avoid duplicates on re-runs)
      const already = await prisma.notification.findFirst({
        where: { userId: acc.userId, tenantId: acc.tenantId, body: { contains: acc.login }, createdAt: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) } },
      });
      if (already) continue;
      await prisma.notification.create({
        data: {
          tenantId: acc.tenantId,
          userId: acc.userId,
          title: "Demo account expiring soon",
          body: `Your demo account #${acc.login} expires ${label}. Any open positions will be closed and the account removed.`,
          type: "NOTICE",
        },
      }).catch(() => {});
      warned++;
    }
  }

  console.log(`[demo-cleanup] deleted=${deleted} warned=${warned}`);
  return NextResponse.json({ ok: true, deleted, warned });
}
