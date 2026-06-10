import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// List account requests for the tenant. Managers see only their own clients'.
export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const where: any = { tenantId: s.tenantId! };
  if (s.role === "MANAGER") {
    const accs = await prisma.account.findMany({ where: { tenantId: s.tenantId!, managerId: s.sub }, select: { userId: true } });
    const ids = Array.from(new Set(accs.map((a) => a.userId).filter(Boolean) as string[]));
    where.userId = { in: ids.length ? ids : ["__none__"] };
  }
  const reqs = await prisma.accountRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  const userIds = Array.from(new Set(reqs.map((r) => r.userId)));
  const [users, accs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.account.findMany({ where: { userId: { in: userIds }, type: "LIVE" }, select: { userId: true, login: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const loginMap = new Map<string, string>();
  for (const a of accs) if (a.userId && !loginMap.has(a.userId)) loginMap.set(a.userId, a.login);
  const requests = reqs.map((r) => ({
    id: r.id, userId: r.userId, type: r.type, leverage: r.leverage, currency: r.currency,
    status: r.status, note: r.note, reviewedBy: r.reviewedBy, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
    name: uMap.get(r.userId)?.name || "—", email: uMap.get(r.userId)?.email || "", login: loginMap.get(r.userId) || "",
  }));
  return NextResponse.json({ ok: true, requests });
}
