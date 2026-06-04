import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Audit scoped to a manager's own assigned clients (+ the manager's own actions).
// Admins fall back to the full tenant log.
export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  if (s.role === "ADMIN") {
    const rows = await prisma.auditLog.findMany({ where: { tenantId: s.tenantId! }, orderBy: { createdAt: "desc" }, take: 200 });
    return NextResponse.json({ ok: true, logs: rows.map((r) => ({ id: r.id.toString(), action: r.action, detail: r.detail, category: r.category, performedBy: r.performedBy, createdAt: r.createdAt })) });
  }

  // Manager: their clients' logins + emails, plus their own email
  const accs = await prisma.account.findMany({
    where: { tenantId: s.tenantId!, managerId: s.sub },
    select: { login: true, user: { select: { email: true } } },
  });
  const logins = accs.map((a) => a.login);
  const emails = Array.from(new Set([s.email, ...accs.map((a) => a.user?.email).filter(Boolean) as string[]]));

  const or: any[] = [{ performedBy: { in: emails } }];
  for (const l of logins) or.push({ detail: { contains: l } });

  const rows = await prisma.auditLog.findMany({
    where: { tenantId: s.tenantId!, OR: or },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ ok: true, logs: rows.map((r) => ({ id: r.id.toString(), action: r.action, detail: r.detail, category: r.category, performedBy: r.performedBy, createdAt: r.createdAt })) });
}
