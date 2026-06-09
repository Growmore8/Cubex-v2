import { requireStaff } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/perms";
import { statementHtml, esc } from "@/lib/statement-html";
import { runningContext } from "@/lib/livePrices";

// A branded, printable HTML account statement (use the browser's Print -> Save as PDF).
export async function GET(req: Request) {
  const s = await requireStaff();
  if (!s) return new Response("Forbidden", { status: 403 });
  try {
    await assertCan(s, "exportPdf");
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId");
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");
    if (!accountId) return new Response("accountId required", { status: 400 });

    const fromDate = fromStr ? new Date(fromStr) : undefined;
    const toDate = toStr ? new Date(toStr + "T23:59:59") : undefined;
    const histWhere: any = {};
    if (fromDate) histWhere.closedAt = { ...(histWhere.closedAt || {}), gte: fromDate };
    if (toDate) histWhere.closedAt = { ...(histWhere.closedAt || {}), lte: toDate };

    // scope to the staff member's tenant (and a manager's own clients)
    const where: any = { id: accountId, tenantId: s.tenantId };
    if (s.role === "MANAGER") where.managerId = s.sub;
    const account = await prisma.account.findFirst({
      where,
      include: {
        user: { select: { name: true, email: true } },
        history: { where: Object.keys(histWhere).length ? histWhere : undefined, orderBy: { closedAt: "desc" }, take: 500 },
        financials: { orderBy: { appliedAt: "desc" }, take: 200 },
        trades: { orderBy: { openedAt: "desc" } },
      },
    });
    if (!account) return new Response("Account not found", { status: 404 });
    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! } });

    const dateLabel = fromStr || toStr ? `(${fromStr || "—"} to ${toStr || "—"})` : undefined;
    const { prices, catOf } = await runningContext(s.tenantId!, account.trades.map((t) => t.symbol));
    const html = statementHtml({ account, tenant, variant: "desk", dateLabel, prices, catOf });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response(esc(e.message || "Failed"), { status: 400 });
  }
}
