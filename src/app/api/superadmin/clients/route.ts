import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const accts = await prisma.account.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, email: true, name: true } },
      tenant: { select: { name: true, brandName: true } },
      manager: { select: { id: true, name: true } },
      kyc: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // Fetch lastLoginIp via raw SQL to avoid Prisma hot-reload cache issues
  const userIds = accts.filter((a) => a.userId).map((a) => a.userId as string);
  const ipMap: Record<string, string | null> = {};
  if (userIds.length) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ id: string; lastLoginIp: string | null }[]>(
        `SELECT id, "lastLoginIp" FROM "User" WHERE id = ANY($1::uuid[])`,
        userIds,
      );
      rows.forEach((r) => { ipMap[r.id] = r.lastLoginIp; });
    } catch {}
  }

  const clients = accts.map((a) => ({
    id: a.id,
    tenantId: a.tenantId,
    login: a.login,
    name: a.name,
    email: a.user ? a.user.email : null,
    phone: a.phone,
    country: a.country,
    company: a.tenant ? (a.tenant.brandName || a.tenant.name) : "—",
    managerId: a.managerId,
    manager: a.manager ? a.manager.name : null,
    type: a.type,
    balance: Number(a.deposit) - Number(a.withdrawal) + Number(a.credit) + Number(a.bonus) + Number(a.pnl),
    locked: a.locked,
    deactivated: a.deactivated,
    isPool: a.isPool,
    isOnline: a.isOnline,
    lastPing: a.lastPing,
    lastLoginIp: a.userId ? (ipMap[a.userId] ?? null) : null,
    kyc: a.kyc[0] ? a.kyc[0].status : null,
    joined: a.createdAt,
  }));

  return NextResponse.json({ ok: true, clients });
}
