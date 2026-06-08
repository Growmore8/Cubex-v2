import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { statementHtml, esc } from "@/lib/statement-html";

// Branded, printable client account statement (browser Print -> Save as PDF).
// Per-tenant brand (name, logo, colours) so a broker's traders never see "Cubex".
export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return new Response("Forbidden", { status: 403 });
  try {
    const accountId = new URL(req.url).searchParams.get("accountId");
    const account = await prisma.account.findFirst({
      where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false, ...(accountId ? { id: accountId } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true } },
        history: { orderBy: { closedAt: "desc" }, take: 200 },
        financials: { orderBy: { appliedAt: "desc" }, take: 200 },
        trades: { orderBy: { openedAt: "desc" } },
      },
    });
    if (!account) return new Response("No account", { status: 404 });
    const pendings = await prisma.pendingOrder.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
    const requests = await prisma.paymentRequest.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 });
    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! } });

    const html = statementHtml({ account, tenant, variant: "client", pendings, requests });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response(esc(e.message || "Failed"), { status: 400 });
  }
}
