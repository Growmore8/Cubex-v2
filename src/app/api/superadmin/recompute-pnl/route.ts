import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { pnlFor } from "@/lib/trademath";

// One-time, idempotent recompute: rewrite every CLOSED trade's P&L with the
// current trade-math model (standard contract-size $10/pip/lot), then rebuild
// each account's realized P&L from the corrected trades + manual P/L rows.
// This brings historical balances, History tabs and PDF statements in line with
// the new model. Safe to re-run — it just recomputes from source each time.
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // symbol -> category map (categories are consistent across tenants; last wins).
  const syms = await prisma.symbol.findMany({ select: { symbol: true, category: true } });
  const catOf: Record<string, string> = {};
  for (const r of syms) catOf[r.symbol] = r.category;

  // 1) Rewrite each closed-trade P&L with the new model.
  const trades = await prisma.tradeHistory.findMany({
    select: { id: true, symbol: true, side: true, openPrice: true, closePrice: true, lots: true, pnl: true, accountId: true },
    take: 200000,
  });
  let tradesChanged = 0;
  const touchedAccounts = new Set<string>();
  for (const t of trades) {
    touchedAccounts.add(t.accountId);
    const newPnl = pnlFor(
      t.symbol,
      t.side as "BUY" | "SELL",
      Number(t.openPrice),
      Number(t.closePrice),
      Number(t.lots),
      catOf[t.symbol],
    );
    if (Math.abs(newPnl - Number(t.pnl)) < 0.005) continue; // already correct
    await prisma.tradeHistory.update({ where: { id: t.id }, data: { pnl: new Prisma.Decimal(newPnl) } }).catch(() => {});
    tradesChanged++;
  }

  // 2) Rebuild each affected account's realized P&L = Σ corrected trades + Σ manual P/L.
  //    (Deposits / withdrawals / credit / bonus are left untouched.)
  let accountsChanged = 0;
  for (const accId of touchedAccounts) {
    const [tAgg, fins, acc] = await Promise.all([
      prisma.tradeHistory.aggregate({ where: { accountId: accId }, _sum: { pnl: true } }),
      prisma.financialHistory.findMany({ where: { accountId: accId, type: "PNL_ADJUST" as any }, select: { amount: true } }),
      prisma.account.findUnique({ where: { id: accId }, select: { pnl: true } }),
    ]);
    if (!acc) continue;
    const manual = fins.reduce((sum, f) => sum + Number(f.amount), 0);
    const after = Number(tAgg._sum.pnl || 0) + manual;
    if (Math.abs(after - Number(acc.pnl)) < 0.005) continue;
    await prisma.account.update({ where: { id: accId }, data: { pnl: new Prisma.Decimal(after) } }).catch(() => {});
    accountsChanged++;
  }

  return NextResponse.json({ ok: true, scannedTrades: trades.length, tradesChanged, accountsTouched: touchedAccounts.size, accountsChanged });
}
