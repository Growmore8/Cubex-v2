import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { isOnline } from "@/lib/presence";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const accts = await prisma.account.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, email: true, name: true, lastLoginIp: true, lastSeenAt: true, lastDevice: true } },
      tenant: { select: { name: true, brandName: true } },
      manager: { select: { id: true, name: true } },
      kyc: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const clients = accts.map((a: any) => ({
    id: a.id,
    tenantId: a.tenantId,
    login: a.login,
    name: a.name,
    email: (a.user && a.user.email) || a.email || null,
    hasUser: !!a.userId, // false = orphaned (login identity was deleted) → needs repair
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
    isOnline: a.user ? isOnline(a.user.lastSeenAt) : false,
    lastPing: (a.user ? a.user.lastSeenAt : null) ?? a.lastPing,
    device: a.user ? (a.user.lastDevice ?? null) : null,
    lastLoginIp: a.user ? (a.user.lastLoginIp ?? null) : null,
    kyc: a.kyc[0] ? a.kyc[0].status : null,
    joined: a.createdAt,
  }));

  return NextResponse.json({ ok: true, clients });
}
