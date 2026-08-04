import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { pnlFor, usedMargin } from "@/lib/trademath";
import { getPrice, getBid, getAsk } from "@/lib/prices";
import { audit } from "@/lib/audit";
import { notifyStaff } from "@/services/notification.service";
import { gnum, gprice } from "@/lib/format";

export interface StopOutResult {
  checkedAt: string;
  tenantsChecked: number;
  accountsChecked: number;
  tradesClosed: number;
  errors: string[];
}

export async function runStopOut(tenantIdFilter?: string): Promise<StopOutResult> {
  const result: StopOutResult = {
    checkedAt: new Date().toISOString(),
    tenantsChecked: 0,
    accountsChecked: 0,
    tradesClosed: 0,
    errors: [],
  };

  const tenantWhere: any = { status: "ACTIVE" };
  if (tenantIdFilter) tenantWhere.id = tenantIdFilter;

  const tenants = await prisma.tenant.findMany({
    where: tenantWhere,
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    result.tenantsChecked++;
    try {
      // Only accounts that have open trades, can be liquidated, and have a stop-out level set
      const accounts = await prisma.account.findMany({
        where: {
          tenantId: tenant.id,
          doNotLiquidate: false,
          deactivated: false,
          mcLevel: { gt: 0 },
          trades: { some: {} },
        },
        select: {
          id: true, login: true, name: true, leverage: true,
          deposit: true, withdrawal: true, credit: true, bonus: true,
          pnl: true, mcLevel: true, userId: true, type: true, managerId: true,
        },
      });

      for (const account of accounts) {
        result.accountsChecked++;
        try {
          const closed = await processAccount(tenant.id, account);
          result.tradesClosed += closed;
        } catch (e: any) {
          result.errors.push(`${tenant.name}/${account.login}: ${e.message}`);
        }
      }
    } catch (e: any) {
      result.errors.push(`Tenant ${tenant.name}: ${e.message}`);
    }
  }

  return result;
}

async function processAccount(tenantId: string, account: any): Promise<number> {
  let closed = 0;

  // Up to 20 forced closes per account per cycle to prevent runaway loops
  for (let iter = 0; iter < 20; iter++) {
    // Re-fetch account each pass so pnl/balance reflects prior closes in this cycle
    const acc = await prisma.account.findUnique({
      where: { id: account.id },
      select: { deposit: true, withdrawal: true, credit: true, bonus: true, pnl: true, leverage: true, mcLevel: true },
    });
    if (!acc) break;

    const trades = await prisma.trade.findMany({
      where: { accountId: account.id },
      select: { id: true, ticket: true, symbol: true, type: true, lots: true, openPrice: true, swap: true, openedAt: true },
    });
    if (!trades.length) break;

    // Fetch all prices in parallel — ask for SELL close, bid for BUY close
    const symbols = [...new Set(trades.map((t) => t.symbol))];
    const [asks, bids] = await Promise.all([
      // getAsk() reads the real exchange ask (ask:SYMBOL); fall back to display BID when no real feed
      Promise.all(symbols.map(async (s) => { const a = await getAsk(s); return (a != null && a > 0) ? a : getPrice(s); })),
      Promise.all(symbols.map((s) => getBid(s))),
    ]);
    const askMap: Record<string, number> = {};
    const bidMap: Record<string, number> = {};
    symbols.forEach((s, i) => {
      askMap[s] = asks[i] ?? 0;
      // Fall back to ask when no real bid is available
      bidMap[s] = (bids[i] && bids[i]! > 0) ? bids[i]! : (askMap[s] ?? 0);
    });

    // Calculate floating P&L for all open positions
    let floating = 0;
    for (const t of trades) {
      const closePrice = t.type === "BUY" ? bidMap[t.symbol] : askMap[t.symbol];
      if (!closePrice) continue;
      floating += pnlFor(t.symbol, t.type as "BUY" | "SELL", Number(t.openPrice), closePrice, Number(t.lots));
    }

    const balance =
      Number(acc.deposit) - Number(acc.withdrawal) +
      Number(acc.credit) + Number(acc.bonus) + Number(acc.pnl);
    const equity = balance + floating;
    const used = usedMargin(
      trades.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })),
      acc.leverage || 100,
      (sym) => askMap[sym] || null,
    );

    const marginLevel = used > 0 ? (equity / used) * 100 : 9999;
    const soLevel = Number(acc.mcLevel);

    if (marginLevel > soLevel) break; // margin recovered — done

    // Find the most-losing trade (worst floating P&L) to close first
    let worstTrade = trades[0];
    let worstPnl = Infinity;
    for (const t of trades) {
      const closePrice = t.type === "BUY" ? bidMap[t.symbol] : askMap[t.symbol];
      if (!closePrice) continue;
      const fp = pnlFor(t.symbol, t.type as "BUY" | "SELL", Number(t.openPrice), closePrice, Number(t.lots));
      if (fp < worstPnl) { worstPnl = fp; worstTrade = t; }
    }

    const sym = worstTrade.symbol;
    const closePrice = worstTrade.type === "BUY"
      ? (bidMap[sym] || askMap[sym])
      : askMap[sym];
    if (!closePrice) continue;

    const lots = Number(worstTrade.lots);
    const pnl = pnlFor(sym, worstTrade.type as "BUY" | "SELL", Number(worstTrade.openPrice), closePrice, lots);
    const swap = Number(worstTrade.swap);

    await prisma.$transaction(async (tx) => {
      await tx.tradeHistory.create({
        data: {
          ticket: worstTrade.ticket,
          accountId: account.id,
          symbol: sym,
          side: worstTrade.type as any,
          lots: worstTrade.lots,
          openPrice: worstTrade.openPrice,
          closePrice: new Prisma.Decimal(closePrice),
          sl: new Prisma.Decimal(0),
          tp: new Prisma.Decimal(0),
          pnl: new Prisma.Decimal(pnl),
          commission: new Prisma.Decimal(0),
          swap: new Prisma.Decimal(swap),
          comment: "Stop-out",
          closeReason: "STOP_OUT" as any,
          openedAt: worstTrade.openedAt,
        },
      });
      await tx.account.update({
        where: { id: account.id },
        data: { pnl: { increment: new Prisma.Decimal(pnl + swap) } },
      });
      await tx.trade.delete({ where: { id: worstTrade.id } });
    });

    const label = `STOP-OUT ${account.login} ${worstTrade.type} ${sym} ${lots}L @ ${gprice(closePrice)} | P&L ${gnum(pnl, 2)} | MarginLevel was ${marginLevel.toFixed(1)}%`;
    audit(tenantId, "trade.stopout", label, account.login, "CLIENT" as any).catch(() => {});
    notifyStaff(tenantId, { type: "TRADE", title: "⛔ Stop-Out Executed", body: label }, account.managerId).catch(() => {});

    closed++;
  }

  return closed;
}
