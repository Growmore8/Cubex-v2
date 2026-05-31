import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { users: true, accounts: true } } } });
  const outsources = tenants.map((t: any) => ({ id: t.id, name: t.name, brandName: t.brandName, subdomain: t.subdomain, status: t.status, permissions: t.permissions || {}, users: t._count.users, accounts: t._count.accounts }));
  return NextResponse.json({ ok: true, outsources });
}