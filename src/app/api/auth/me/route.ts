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
  if (s.tenantId) {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true, brandName: true, logoUrl: true } });
      if (t) brand = { name: t.brandName || t.name, logoUrl: t.logoUrl };
      const sub = await prisma.subscription.findUnique({ where: { tenantId: s.tenantId }, select: { status: true, endsAt: true } });
      if (sub && sub.status === "TRIALING" && sub.endsAt) {
        const msLeft = new Date(sub.endsAt).getTime() - Date.now();
        trial = { active: msLeft > 0, daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)), endsAt: String(sub.endsAt) };
      }
    } catch {}
  }
  return NextResponse.json({
    ok: true,
    user: { id: s.sub, name: s.name, email: s.email, role: s.role, tenantId: s.tenantId },
    perms,
    brand,
    trial,
  });
}
