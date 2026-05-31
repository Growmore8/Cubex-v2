import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const [totalAdmins, totalManagers, totalClients, liveClients, demoClients, activeAccounts, lockedAccounts, openTrades, outsource, sums, creditInAgg, creditOutAgg, setting] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" as any } }),
    prisma.user.count({ where: { role: "MANAGER" as any } }),
    prisma.user.count({ where: { role: "CLIENT" as any } }),
    prisma.account.count({ where: { type: "LIVE" as any } }),
    prisma.account.count({ where: { type: "DEMO" as any } }),
    prisma.account.count({ where: { locked: false } }),
    prisma.account.count({ where: { locked: true } }),
    prisma.trade.count(),
    prisma.tenant.count(),
    prisma.account.aggregate({ _sum: { deposit: true, withdrawal: true, bonus: true } }),
    prisma.account.aggregate({ _sum: { credit: true }, where: { credit: { gt: 0 } } }),
    prisma.account.aggregate({ _sum: { credit: true }, where: { credit: { lt: 0 } } }),
    prisma.setting.findUnique({ where: { key: "platform" } }).catch(() => null),
  ]);
  const mode = (setting && (setting.value as any) && (setting.value as any).mode) || "OPEN";
  return NextResponse.json({ ok: true, stats: {
    totalAdmins, totalManagers, totalClients, liveClients, demoClients, activeAccounts, lockedAccounts, openTrades, outsource,
    deposits: Number(sums._sum.deposit || 0), withdrawals: Number(sums._sum.withdrawal || 0), bonus: Number(sums._sum.bonus || 0),
    creditIn: Number(creditInAgg._sum.credit || 0), creditOut: Number(creditOutAgg._sum.credit || 0), mode,
  } });
}