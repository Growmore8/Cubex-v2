import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { subscription: true, _count: { select: { users: true, accounts: true } } },
  });
  const outsources = tenants.map((t: any) => ({
    id: t.id,
    name: t.name,
    brandName: t.brandName,
    slogan: t.slogan,
    companyInfo: t.companyInfo,
    logoUrl: t.logoUrl,
    customDomain: t.customDomain,
    supportEmail: t.supportEmail,
    primaryColor: t.primaryColor,
    accentColor: t.accentColor,
    subdomain: t.subdomain,
    status: t.status,
    permissions: t.permissions || {},
    users: t._count.users,
    accounts: t._count.accounts,
    subscription: t.subscription,
    createdAt: t.createdAt,
  }));
  return NextResponse.json({ ok: true, outsources });
}
