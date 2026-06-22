import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// All trial (TRIALING) tenants with days-left + a few stats, for the SA Trials page.
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const subs = await prisma.subscription.findMany({ where: { status: "TRIALING" as any }, orderBy: { endsAt: "asc" } });
  const out = await Promise.all(subs.map(async (sub) => {
    const t = await prisma.tenant.findUnique({ where: { id: sub.tenantId }, select: { id: true, name: true, brandName: true, subdomain: true, customDomain: true, createdAt: true, supportEmail: true } });
    if (!t) return null;
    const clients = await prisma.account.count({ where: { tenantId: t.id } });
    const admin = await prisma.user.findFirst({ where: { tenantId: t.id, role: "ADMIN" as any }, select: { email: true } });
    const ms = sub.endsAt ? new Date(sub.endsAt).getTime() - Date.now() : null;
    return {
      id: t.id, name: t.brandName || t.name, subdomain: t.subdomain, customDomain: t.customDomain,
      plan: sub.plan, endsAt: sub.endsAt, createdAt: t.createdAt, clients,
      daysLeft: ms == null ? null : Math.ceil(ms / 86400000), expired: ms != null && ms < 0,
      adminEmail: admin?.email || null, supportEmail: t.supportEmail || null,
    };
  }));
  return NextResponse.json({ ok: true, trials: out.filter(Boolean), baseDomain: process.env.PLATFORM_BASE_DOMAIN || "cubexenterprises.com" });
}
