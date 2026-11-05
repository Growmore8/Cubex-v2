import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Cache stats for 30s — 18 DB queries ran every 10s is wasteful
const _g = global as any;
if (!_g.__statsCache) _g.__statsCache = { data: null, ts: 0 };
const STATS_TTL = 30_000;

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const cache = _g.__statsCache;
  if (cache.data && Date.now() - cache.ts < STATS_TTL) {
    return NextResponse.json({ ok: true, stats: cache.data });
  }
  const [totalAdmins, totalManagers, totalClients, liveClients, demoClients, activeAccounts, lockedAccounts, deactivatedAccounts, onlineClients, openTrades, outsource, sums, creditInAgg, creditOutAgg, bonusAgg, insuranceAgg, setting, pendingInvoices] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" as any } }),
    prisma.user.count({ where: { role: "MANAGER" as any } }),
    prisma.user.count({ where: { role: "CLIENT" as any } }),
    prisma.account.count({ where: { type: "LIVE" as any } }),
    prisma.account.count({ where: { type: "DEMO" as any } }),
    prisma.account.count({ where: { locked: false, deactivated: false } }),
    prisma.account.count({ where: { locked: true } }),
    prisma.account.count({ where: { deactivated: true } }),
    prisma.account.count({ where: { isOnline: true } }),
    prisma.trade.count(),
    prisma.tenant.count(),
    prisma.account.aggregate({ _sum: { deposit: true, withdrawal: true } }),
    prisma.account.aggregate({ _sum: { credit: true }, where: { credit: { gt: 0 } } }),
    prisma.account.aggregate({ _sum: { credit: true }, where: { credit: { lt: 0 } } }),
    prisma.account.aggregate({ _sum: { bonus: true } }),
    prisma.account.aggregate({ _sum: { insurance: true } }),
    prisma.setting.findUnique({ where: { key: "platform" } }).catch(() => null),
    prisma.invoice.count({ where: { status: "PENDING" as any } }).catch(() => 0),
  ]);
  const mode = (setting && (setting.value as any) && (setting.value as any).mode) || "OPEN";
  const stats = {
    totalAdmins, totalManagers, totalClients, liveClients, demoClients,
    activeAccounts, lockedAccounts, deactivatedAccounts, onlineClients,
    openTrades, outsource,
    deposits: Number(sums._sum.deposit || 0),
    withdrawals: Number(sums._sum.withdrawal || 0),
    creditIn: Number(creditInAgg._sum.credit || 0),
    creditOut: Number(creditOutAgg._sum.credit || 0),
    bonus: Number(bonusAgg._sum.bonus || 0),
    insurance: Number(insuranceAgg._sum.insurance || 0),
    pendingInvoices,
    mode,
  };
  cache.data = stats;
  cache.ts = Date.now();
  return NextResponse.json({ ok: true, stats });
}