import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { loadStatement, buildStatementPdf, statementRange } from "@/services/statement.service";

// SuperAdmin statement PDF download for any client account (cross-tenant).
export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return new Response("Forbidden", { status: 403 });
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId");
  if (!accountId) return new Response("accountId required", { status: 400 });
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { tenantId: true, login: true } });
  if (!acc) return new Response("Account not found", { status: 404 });
  const { since, until, label } = statementRange(u.searchParams.get("preset") || undefined, u.searchParams.get("from") || undefined, u.searchParams.get("to") || undefined);
  const data = await loadStatement({ tenantId: acc.tenantId, accountId, since, until });
  if (!data) return new Response("Account not found", { status: 404 });
  const pdf = await buildStatementPdf(data, label);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Statement-${acc.login}.pdf"` },
  });
}
