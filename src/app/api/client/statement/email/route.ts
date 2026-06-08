import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { sendStatementEmail } from "@/services/statement.service";

// Email the logged-in client their own account statement (PDF) to their registered email.
export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    let accountId: string | undefined = body.accountId;
    if (!accountId) {
      const acc = await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false }, orderBy: { createdAt: "asc" }, select: { id: true } });
      accountId = acc?.id;
    }
    if (!accountId) return NextResponse.json({ ok: false, error: "No account" }, { status: 404 });
    const since = body.from ? new Date(String(body.from)) : undefined;
    const until = body.to ? new Date(String(body.to) + "T23:59:59") : undefined;
    const periodLabel = (body.from || body.to) ? `${body.from || "—"} to ${body.to || "—"}` : undefined;
    // userId scope ensures a client can only email their own account.
    const r = await sendStatementEmail({ tenantId: s.tenantId!, accountId, userId: s.sub, since, until, periodLabel });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, to: r.to });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed to send" }, { status: 400 });
  }
}
