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

  // Group by userId (one client object per user, with all their accounts)
  const userMap = new Map<string, any>();
  for (const a of accts) {
    const uid = a.userId ?? `__anon__${a.id}`;
    if (!userMap.has(uid)) {
      const u: any = a.user;
      userMap.set(uid, {
        userId: a.userId,
        name: u?.name || (a as any).name || "—",
        email: u?.email || (a as any).email || null,
        phone: u?.phone || (a as any).phone || null,
        country: u?.country || (a as any).country || null,
        isOnline: u ? isOnline(u.lastSeenAt) : false,
        lastPing: u?.lastSeenAt ?? null,
        device: u?.lastDevice ?? null,
        lastLoginIp: u?.lastLoginIp ?? null,
        joined: a.createdAt,
        accounts: [] as any[],
      });
    }
    const client = userMap.get(uid)!;
    // Track earliest join date across accounts
    if (new Date(a.createdAt) < new Date(client.joined)) client.joined = a.createdAt;
    client.accounts.push({
      id: a.id,
      login: a.login,
      name: (a as any).name,
      email: (a.user as any)?.email || (a as any).email || null,
      phone: (a as any).phone || null,
      country: (a as any).country || null,
      type: a.type,
      balance: Number((a as any).deposit) - Number((a as any).withdrawal) + Number((a as any).credit) + Number((a as any).bonus) + Number((a as any).pnl),
      locked: (a as any).locked,
      deactivated: (a as any).deactivated,
      isPool: (a as any).isPool,
      tenantId: a.tenantId,
      managerId: (a as any).managerId,
      company: a.tenant ? (a.tenant.brandName || a.tenant.name) : "—",
      manager: (a as any).manager?.name || null,
      kyc: (a as any).kyc[0]?.status || null,
      joined: a.createdAt,
      hasUser: !!a.userId,
    });
  }

  return NextResponse.json({ ok: true, clients: Array.from(userMap.values()) });
}
