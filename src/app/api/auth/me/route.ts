import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { effectivePerms } from "@/lib/perms";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, user: null });
  const perms = await effectivePerms(s);
  // brand shown in the app header — tenant's brand name/logo (never "CubeX" for a tenant)
  let brand: { name: string; logoUrl: string | null } = { name: process.env.APP_NAME || "CubeX", logoUrl: null };
  let trial: { active: boolean; daysLeft: number; endsAt: string | null } | null = null;
  let features: Record<string, boolean> = {};
  if (s.tenantId) {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true, brandName: true, logoUrl: true, swapEnabled: true, features: true } as any }) as any;
      if (t) {
        brand = { name: t.brandName || t.name, logoUrl: t.logoUrl };
        (brand as any).swapEnabled = !!(t as any).swapEnabled;
        features = ((t.features as Record<string, boolean>) || {});
      }
      const sub = await prisma.subscription.findUnique({ where: { tenantId: s.tenantId }, select: { status: true, endsAt: true } });
      if (sub && sub.status === "TRIALING" && sub.endsAt) {
        const msLeft = new Date(sub.endsAt).getTime() - Date.now();
        trial = { active: msLeft > 0, daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)), endsAt: String(sub.endsAt) };
      }
    } catch {}
  }
  // For clients: apply the assigned manager's feature perms as an extra gate.
  // If any manager assigned to the client's accounts has a feature perm set to false,
  // that feature is hidden for the client — regardless of the tenant-level flag.
  if (s.role === "CLIENT" && s.sub) {
    try {
      const accounts = await prisma.account.findMany({
        where: { userId: s.sub, deactivated: false },
        select: { managerId: true },
      });
      const managerIds = [...new Set(accounts.map((a) => a.managerId).filter(Boolean))] as string[];
      if (managerIds.length > 0) {
        const managers = await prisma.user.findMany({
          where: { id: { in: managerIds } },
          select: { perms: true },
        });
        const FEATURE_PERM_KEYS = ["copyTrading", "advancedAnalytics", "marketNewsFeed", "economicCalendar", "referralProgram"] as const;
        for (const mgr of managers) {
          const mp: any = (mgr.perms as any) || {};
          for (const key of FEATURE_PERM_KEYS) {
            if (mp[key] === false) features[key] = false;
          }
        }
      }
    } catch {}
  }

  return NextResponse.json({
    ok: true,
    user: { id: s.sub, name: s.name, email: s.email, role: s.role, tenantId: s.tenantId },
    perms,
    brand,
    trial,
    swapEnabled: (brand as any).swapEnabled ?? true,
    features,
  });
}
