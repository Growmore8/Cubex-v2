import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isOnline } from "@/lib/presence";
import { createStaffAccount } from "@/services/account.service";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const role = sp.get("role") || "MANAGER";
  const tenantId = sp.get("tenantId");
  const where: any = { role: role as any };
  if (tenantId) where.tenantId = tenantId;
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, include: { tenant: { select: { name: true, brandName: true } } } });
  // Fetch lastLoginIp via raw SQL to avoid Prisma cache issues
  const userIds = users.map((u) => u.id);
  const ipMap: Record<string, string | null> = {};
  const seenMap: Record<string, Date | null> = {};
  const devMap: Record<string, string | null> = {};
  if (userIds.length) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ id: string; lastLoginIp: string | null; lastSeenAt: Date | null; lastDevice: string | null }[]>(
        `SELECT id, "lastLoginIp", "lastSeenAt", "lastDevice" FROM "User" WHERE id = ANY($1::uuid[])`, userIds,
      );
      rows.forEach((r) => { ipMap[r.id] = r.lastLoginIp; seenMap[r.id] = r.lastSeenAt; devMap[r.id] = r.lastDevice; });
    } catch {}
  }
  const staff = users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, tenantId: u.tenantId, company: u.tenant ? (u.tenant.brandName || u.tenant.name) : null, perms: u.perms, lastLoginAt: u.lastLoginAt, lastLoginIp: ipMap[u.id] ?? null, lastSeenAt: seenMap[u.id] ?? null, device: devMap[u.id] ?? null, online: isOnline(seenMap[u.id]), createdAt: u.createdAt }));
  return NextResponse.json({ ok: true, users: staff, staff });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (!b.name || !b.email || !b.password || b.password.length < 6) throw new Error("Name, email, password (min 6) required");
    if (!b.tenantId) throw new Error("Select an outsource");
    const role = b.role === "ADMIN" ? "ADMIN" : "MANAGER";
    const email = String(b.email).toLowerCase();
    const dup = await prisma.user.findFirst({ where: { tenantId: b.tenantId, email, role: role as any } });
    if (dup) throw new Error("Email already in use by another " + role.toLowerCase());
    const u = await prisma.user.create({ data: { tenantId: b.tenantId, email, name: b.name, passwordHash: await hashPassword(b.password), role: role as any, status: "ACTIVE" as any, perms: {} } });
    // Staff get their own trading account too (they trade like a client).
    await createStaffAccount(b.tenantId, u.id, b.name).catch(() => {});
    await audit(b.tenantId, "sa.create." + role, email, s.email);
    return NextResponse.json({ ok: true, id: u.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}