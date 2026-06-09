import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { sendStatementEmail, statementRange } from "@/services/statement.service";

// SuperAdmin: email a client's statement PDF to any address (cross-tenant).
// Sends from the account's own tenant SMTP as no-reply.
export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "");
    const to = body.email ? String(body.email).trim() : undefined;
    if (!accountId) return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });
    const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { tenantId: true } });
    if (!acc) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });
    const { since, until, label } = statementRange(body.preset, body.from, body.to);
    const r = await sendStatementEmail({ tenantId: acc.tenantId, accountId, to, since, until, periodLabel: label });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, to: r.to });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed to send" }, { status: 400 });
  }
}
