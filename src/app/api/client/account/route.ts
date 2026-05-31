import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const reqAccId = url.searchParams.get("accountId");
  const account = await prisma.account.findFirst({
    where: reqAccId ? { tenantId: s.tenantId!, userId: s.sub, id: reqAccId } : { tenantId: s.tenantId!, userId: s.sub },
    orderBy: { createdAt: "asc" },
    include: {
      trades: { orderBy: { openedAt: "desc" } },
      history: { orderBy: { closedAt: "desc" }, take: 50 },
    },
  });

  let symbols: any[] = [];
  try {
    symbols = await prisma.globalSymbol.findMany({
      where: { enabled: true },
      orderBy: { symbol: "asc" },
      select: { symbol: true, display: true, category: true, digits: true },
    });
  } catch { symbols = []; }

  return NextResponse.json({
    ok: true,
    account: account ? {
      login: account.login, currency: account.currency, leverage: account.leverage, locked: account.locked,
      deposit: Number(account.deposit), withdrawal: Number(account.withdrawal),
      credit: Number(account.credit), bonus: Number(account.bonus), pnl: Number(account.pnl),
    } : null,
    positions: account ? account.trades.map((t) => ({
      id: t.id.toString(), ticket: t.ticket.toString(), symbol: t.symbol, type: t.type,
      lots: Number(t.lots), openPrice: Number(t.openPrice), sl: Number(t.sl), tp: Number(t.tp), openedAt: t.openedAt,
    })) : [],
    history: account ? account.history.map((h) => ({
      id: h.id.toString(), symbol: h.symbol, side: h.side, lots: Number(h.lots),
      openPrice: Number(h.openPrice), closePrice: Number(h.closePrice), pnl: Number(h.pnl),
      closeReason: h.closeReason, closedAt: h.closedAt,
    })) : [],
    symbols,
  });
}
