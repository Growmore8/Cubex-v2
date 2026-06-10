import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { effectiveSeatsForPlan } from "@/services/tenant.service";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { subscription: true, _count: { select: { users: true, accounts: true, groups: true } } },
  });

  const outsources = await Promise.all(tenants.map(async (t: any) => {
    const [liveCnt, demoCnt, managerCnt] = await Promise.all([
      prisma.account.count({ where: { tenantId: t.id, type: "LIVE" } }),
      prisma.account.count({ where: { tenantId: t.id, type: "DEMO" } }),
      prisma.user.count({ where: { tenantId: t.id, role: "MANAGER" } }),
    ]);
    const seatsLimit = await effectiveSeatsForPlan(prisma, t.subscription?.plan);
    return {
      id: t.id,
      name: t.name,
      brandName: t.brandName,
      slogan: t.slogan,
      companyInfo: t.companyInfo,
      logoUrl: t.logoUrl,
      customDomain: t.customDomain,
      supportEmail: t.supportEmail,
      smtpEmail: t.smtpEmail || null,
      smtpHost: t.smtpHost || null,
      // True only when BOTH email + password are set (registration / reset / statement
      // emails work). Password itself is never sent to the client.
      smtpConfigured: !!(t.smtpEmail && t.smtpPassword),
      contactName: t.contactName || null,
      contactPhone: t.contactPhone || null,
      primaryColor: t.primaryColor,
      accentColor: t.accentColor,
      subdomain: t.subdomain,
      status: t.status,
      permissions: t.permissions || {},
      users: t._count.users,
      accounts: t._count.accounts,
      liveCnt,
      demoCnt,
      managerCnt,
      groupCnt: t._count.groups,
      seatsLimit,
      seatsLeft: Math.max(0, seatsLimit - liveCnt),
      subscription: t.subscription,
      createdAt: t.createdAt,
    };
  }));

  return NextResponse.json({ ok: true, outsources });
}
