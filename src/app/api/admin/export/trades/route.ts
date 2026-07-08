import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

function csvRow(vals: unknown[]): string {
  return vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

export async function GET(req: Request) {
  const s = await requireAdmin();
  if (!s) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const symbol = url.searchParams.get("symbol") || undefined;
  const accountId = url.searchParams.get("accountId") || undefined;

  const where: any = { account: { tenantId: s.tenantId! } };
  if (symbol) where.symbol = symbol;
  if (accountId) where.accountId = accountId;
  if (from || to) {
    where.closedAt = {};
    if (from) where.closedAt.gte = new Date(from);
    if (to) where.closedAt.lte = new Date(to + "T23:59:59");
  }

  const trades = await prisma.tradeHistory.findMany({
    where,
    orderBy: { closedAt: "desc" },
    take: 20000,
    include: {
      account: {
        select: { login: true, type: true, user: { select: { name: true, email: true } } },
      },
    },
  });

  const header = csvRow(["Ticket","Client","Email","Account","Type","Symbol","Side","Lots","Open Price","Close Price","Gross P/L","Commission","Swap","Net P/L","Close Reason","Opened At","Closed At"]);

  const rows = trades.map((t) => {
    const net = Number(t.pnl) - Number(t.commission) + Number(t.swap);
    return csvRow([
      String(t.ticket),
      t.account.user?.name ?? "",
      t.account.user?.email ?? "",
      t.account.login,
      t.account.type,
      t.symbol,
      t.side,
      Number(t.lots).toFixed(2),
      Number(t.openPrice).toFixed(5),
      Number(t.closePrice).toFixed(5),
      Number(t.pnl).toFixed(2),
      Number(t.commission).toFixed(2),
      Number(t.swap).toFixed(2),
      net.toFixed(2),
      t.closeReason,
      new Date(t.openedAt).toISOString(),
      new Date(t.closedAt).toISOString(),
    ]);
  });

  const csv = [header, ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trades-${date}.csv"`,
    },
  });
}
