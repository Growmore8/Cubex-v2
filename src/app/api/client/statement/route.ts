import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { statementHtml, esc } from "@/lib/statement-html";
import { runningContext } from "@/lib/livePrices";

// Branded, printable client account statement (browser Print -> Save as PDF).
// Per-tenant brand (name, logo, colours) so a broker's traders never see "Cubex".
export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return new Response("Forbidden", { status: 403 });
  try {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId");
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");
    const range: any = {};
    if (fromStr) range.gte = new Date(fromStr);
    if (toStr) range.lte = new Date(toStr + "T23:59:59");
    const hasRange = Object.keys(range).length > 0;
    const account = await prisma.account.findFirst({
      where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false, ...(accountId ? { id: accountId } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true } },
        history: { where: hasRange ? { closedAt: range } : undefined, orderBy: { closedAt: "desc" }, take: 500 },
        financials: { where: hasRange ? { appliedAt: range } : undefined, orderBy: { appliedAt: "desc" }, take: 500 },
        trades: { orderBy: { openedAt: "desc" } },
      },
    });
    if (!account) return new Response("No account", { status: 404 });
    const pendings = await prisma.pendingOrder.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
    const requests = await prisma.paymentRequest.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 });
    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! } });

    const { prices, catOf } = await runningContext(s.tenantId!, account.trades.map((t) => t.symbol));
    const html = statementHtml({ account, tenant, variant: "client", pendings, requests, prices, catOf });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response(esc(e.message || "Failed"), { status: 400 });
  }
}
