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
  if (s.tenantId) {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true, brandName: true, logoUrl: true } });
      if (t) brand = { name: t.brandName || t.name, logoUrl: t.logoUrl };
    } catch {}
  }
  return NextResponse.json({
    ok: true,
    user: { id: s.sub, name: s.name, email: s.email, role: s.role, tenantId: s.tenantId },
    perms,
    brand,
  });
}
