import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const [acc, openTrades, closedStats, recentTrades] = await Promise.all([
    prisma.account.findUnique({
      where: { id },
      select: { deposit: true, withdrawal: true, credit: true, bonus: true, pnl: true, insurance: true },
    }),
    prisma.trade.findMany({
      where: { accountId: id },
      orderBy: { id: "desc" },
      select: { id: true, ticket: true, symbol: true, type: true, lots: true, openPrice: true, sl: true, tp: true, commission: true, swap: true },
    }),
    prisma.tradeHistory.aggregate({
      where: { accountId: id },
      _count: { id: true },
      _sum: { pnl: true, commission: true, swap: true },
    }),
    prisma.tradeHistory.findMany({
      where: { accountId: id },
      orderBy: { closedAt: "desc" },
      take: 10,
      select: { id: true, ticket: true, symbol: true, side: true, lots: true, openPrice: true, closePrice: true, pnl: true, commission: true, swap: true, openedAt: true, closedAt: true },
    }),
  ]);

  if (!acc) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });

  const wins  = await prisma.tradeHistory.count({ where: { accountId: id, pnl: { gt: 0 } } });
  const total = closedStats._count.id;

  return NextResponse.json({
    ok: true,
    financials: {
      deposit:    Number(acc.deposit),
      withdrawal: Number(acc.withdrawal),
      credit:     Number(acc.credit),
      bonus:      Number(acc.bonus),
      insurance:  Number(acc.insurance ?? 0),
      closedPnl:  Number(acc.pnl),
    },
    openTrades: openTrades.map(t => ({
      id: t.id.toString(),
      ticket: t.ticket.toString(),
      symbol: t.symbol,
      side: t.type,
      lots: Number(t.lots),
      openPrice: Number(t.openPrice),
      sl: Number(t.sl),
      tp: Number(t.tp),
    })),
    closedStats: {
      count:      total,
      totalPnl:   Number(closedStats._sum.pnl ?? 0),
      commission: Number(closedStats._sum.commission ?? 0),
      swap:       Number(closedStats._sum.swap ?? 0),
      wins,
      losses:     total - wins,
      winRate:    total > 0 ? Math.round((wins / total) * 100) : 0,
    },
    recentTrades: recentTrades.map(t => ({
      id: t.id.toString(),
      ticket: t.ticket.toString(),
      symbol: t.symbol,
      side: t.side,
      lots: Number(t.lots),
      openPrice: Number(t.openPrice),
      closePrice: Number(t.closePrice),
      pnl: Number(t.pnl),
      commission: Number(t.commission),
      swap: Number(t.swap),
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    })),
  });
}
