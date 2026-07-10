import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { listAudit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  await assertCan(s, "viewAudit");
  const logs = await listAudit(s.tenantId!);

  // Parse logins from detail (first token that looks like a login: 6+ digits or DEMO+digits)
  const loginRe = /^(DEMO\d+|\d{6,})/;
  const logins = [...new Set(logs.map((l) => { const m = (l.detail || "").match(loginRe); return m ? m[1] : null; }).filter(Boolean) as string[])];
  // Also collect emails from performedBy to resolve actor names
  const emails = [...new Set(logs.map((l) => l.performedBy).filter((e) => e && e.includes("@")))];

  const [accounts, actors] = await Promise.all([
    logins.length ? prisma.account.findMany({ where: { tenantId: s.tenantId!, login: { in: logins } }, select: { login: true, name: true, user: { select: { email: true } } } }) : Promise.resolve([]),
    emails.length ? prisma.user.findMany({ where: { tenantId: s.tenantId!, email: { in: emails } }, select: { email: true, name: true } }) : Promise.resolve([]),
  ]);

  const accMap = new Map(accounts.map((a) => [a.login, { name: a.name, email: a.user?.email || "" }]));
  const actorMap = new Map(actors.map((u) => [u.email, u.name]));

  const enriched = logs.map((l) => {
    const m = (l.detail || "").match(loginRe);
    const targetLogin = m ? m[1] : null;
    const acc = targetLogin ? accMap.get(targetLogin) : null;
    return {
      ...l,
      targetLogin,
      targetName: acc?.name || null,
      targetEmail: acc?.email || null,
      actorName: l.performedBy.includes("@") ? (actorMap.get(l.performedBy) || null) : null,
    };
  });

  return NextResponse.json({ ok: true, logs: enriched });
}
