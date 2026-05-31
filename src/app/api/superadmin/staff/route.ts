import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const role = new URL(req.url).searchParams.get("role") || "MANAGER";
  const users = await prisma.user.findMany({ where: { role: role as any }, orderBy: { createdAt: "desc" }, include: { tenant: { select: { name: true, brandName: true } } } });
  return NextResponse.json({ ok: true, users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, company: u.tenant ? (u.tenant.brandName || u.tenant.name) : null, perms: u.perms, createdAt: u.createdAt })) });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (!b.name || !b.email || !b.password || b.password.length < 6) throw new Error("Name, email, password (min 6) required");
    if (!b.tenantId) throw new Error("Select an outsource");
    const role = b.role === "ADMIN" ? "ADMIN" : "MANAGER";
    const u = await prisma.user.create({ data: { tenantId: b.tenantId, email: b.email, name: b.name, passwordHash: await hashPassword(b.password), role: role as any, status: "ACTIVE" as any, perms: {} } });
    await audit(b.tenantId, "sa.create." + role, b.email, s.email);
    return NextResponse.json({ ok: true, id: u.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}