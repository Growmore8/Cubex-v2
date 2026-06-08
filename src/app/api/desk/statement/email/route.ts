import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";
import { sendStatementEmail } from "@/services/statement.service";

// Staff (admin / manager / superadmin) email an account statement to any address.
// Defaults to the client's registered email when no address is given.
export async function POST(req: Request) {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "exportPdf");
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "");
    const to = body.email ? String(body.email).trim() : undefined;
    const since = body.from ? new Date(String(body.from)) : undefined;
    const until = body.to ? new Date(String(body.to) + "T23:59:59") : undefined;
    const periodLabel = (body.from || body.to) ? `${body.from || "—"} to ${body.to || "—"}` : undefined;
    if (!accountId) return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });

    // Scope: tenant, and managers only their own clients.
    const where: any = { id: accountId, tenantId: s.tenantId };
    if (s.role === "MANAGER") where.managerId = s.sub;
    const acc = await prisma.account.findFirst({ where, select: { id: true } });
    if (!acc) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });

    const r = await sendStatementEmail({ tenantId: s.tenantId!, accountId, to, since, until, periodLabel });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, to: r.to });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed to send" }, { status: 400 });
  }
}
