import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // For admin: all tenant requests. For manager: only their assigned clients.
  const accountWhere =
    s.role === "MANAGER"
      ? { tenantId: s.tenantId!, managerId: s.sub }
      : { tenantId: s.tenantId! };

  const accounts = await prisma.account.findMany({
    where: accountWhere,
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const requests = await prisma.paymentRequest.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { account: { select: { login: true, name: true } } },
  });

  return NextResponse.json({ ok: true, requests });
}
