import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const accts = await prisma.account.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true, name: true } },
      tenant: { select: { name: true, brandName: true } },
      manager: { select: { name: true } },
      kyc: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const clients = accts.map((a) => ({
    id: a.id, login: a.login, name: a.name,
    email: a.user ? a.user.email : null,
    company: a.tenant ? (a.tenant.brandName || a.tenant.name) : "—",
    manager: a.manager ? a.manager.name : null,
    type: a.type,
    balance: Number(a.deposit) - Number(a.withdrawal) + Number(a.credit) + Number(a.bonus) + Number(a.pnl),
    locked: a.locked,
    deactivated: a.deactivated,
    kyc: a.kyc[0] ? a.kyc[0].status : null,
    joined: a.createdAt,
  }));
  return NextResponse.json({ ok: true, clients });
}