import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const days = parseInt(sp.get("days") || "0") || 0; // 0 = all time
  const since = days > 0 ? new Date(Date.now() - days * 86400000) : undefined;
  const dateFilter = since ? { createdAt: { gte: since } } : {};

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscription: { select: { plan: true, status: true, seats: true, endsAt: true } },
      _count: {
        select: {
          users: true,
          accounts: true,
        },
      },
    },
  });

  const analytics = await Promise.all(
    tenants.map(async (t) => {
      const [clients, managers, admins, liveAccounts, demoAccounts, activeAccounts, lockedAccounts, openTrades, deposits] = await Promise.all([
        prisma.user.count({ where: { tenantId: t.id, role: "CLIENT", ...dateFilter } }),
        prisma.user.count({ where: { tenantId: t.id, role: "MANAGER", ...dateFilter } }),
        prisma.user.count({ where: { tenantId: t.id, role: "ADMIN", ...dateFilter } }),
        prisma.account.count({ where: { tenantId: t.id, type: "LIVE" } }),
        prisma.account.count({ where: { tenantId: t.id, type: "DEMO" } }),
        prisma.account.count({ where: { tenantId: t.id, locked: false, deactivated: false } }),
        prisma.account.count({ where: { tenantId: t.id, locked: true } }),
        prisma.trade.count({ where: { account: { tenantId: t.id } } }),
        prisma.account.aggregate({
          where: { tenantId: t.id },
          _sum: { deposit: true, withdrawal: true },
        }),
      ]);
      return {
        id: t.id,
        name: t.name,
        brandName: t.brandName,
        subdomain: t.subdomain,
        status: t.status,
        plan: t.subscription?.plan || null,
        subStatus: t.subscription?.status || null,
        seats: t.subscription?.seats || null,
        endsAt: t.subscription?.endsAt || null,
        clients, managers, admins,
        liveAccounts, demoAccounts,
        activeAccounts, lockedAccounts,
        openTrades,
        totalDeposits: Number(deposits._sum.deposit || 0),
        totalWithdrawals: Number(deposits._sum.withdrawal || 0),
        createdAt: t.createdAt,
      };
    })
  );

  return NextResponse.json({ ok: true, analytics });
}
