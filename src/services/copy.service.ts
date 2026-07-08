import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getPrice, getBid } from "@/lib/prices";
import { pnlFor } from "@/lib/trademath";
import { nextTicket, assertMargin } from "@/services/trade.service";
import { audit } from "@/lib/audit";

// Round follower lots to 2 dp, clamp to min 0.01
function calcFollowerLots(masterLots: number, ratio: number): number {
  return Math.max(0.01, Math.round(masterLots * ratio * 100) / 100);
}

export async function replicateTrade(
  masterTrade: { id: bigint; ticket: bigint; accountId: string; symbol: string; type: string; lots: number; sl: number; tp: number; openedAt: Date },
  tenantId: string,
) {
  const relations = await prisma.copyRelation.findMany({
    where: { masterAccId: masterTrade.accountId, active: true, tenantId },
    include: { followerAcc: true },
  });
  if (!relations.length) return;

  const ask = await getPrice(masterTrade.symbol);
  if (ask == null) return;

  for (const rel of relations) {
    const follower = rel.followerAcc;
    if (!follower || (follower as any).deactivated || (follower as any).locked) continue;
    try {
      const lots = calcFollowerLots(masterTrade.lots, Number(rel.ratio));
      // Margin check — skip follower if insufficient funds
      try { await assertMargin(follower, { symbol: masterTrade.symbol, type: masterTrade.type as "BUY" | "SELL", lots }, ask); }
      catch { continue; }

      const openPrice = masterTrade.type === "BUY" ? ask : (await getBid(masterTrade.symbol) ?? ask);
      for (let attempt = 0; attempt < 3; attempt++) {
        const ticket = await nextTicket(tenantId);
        try {
          await prisma.trade.create({
            data: {
              ticket, accountId: follower.id, symbol: masterTrade.symbol,
              type: masterTrade.type as any,
              lots: new Prisma.Decimal(lots),
              openPrice: new Prisma.Decimal(openPrice),
              sl: new Prisma.Decimal(masterTrade.sl || 0),
              tp: new Prisma.Decimal(masterTrade.tp || 0),
              masterTradeId: masterTrade.id,
              comment: `Copy #${masterTrade.ticket}`,
            },
          });
          break;
        } catch (e: any) {
          if (attempt < 2 && e?.code === "P2002" && e?.meta?.target?.includes("ticket")) continue;
          throw e;
        }
      }
      audit(tenantId, "copy.open", `${(follower as any).login} copied #${masterTrade.ticket} ${masterTrade.symbol} ${masterTrade.type} ${lots}L`, (follower as any).login, "CLIENT");
    } catch (e) {
      console.error("[copy] replicate failed for follower", (follower as any).login, e);
    }
  }
}

export async function closeCopiedTrades(masterTradeId: bigint, tenantId: string) {
  const followers = await prisma.trade.findMany({
    where: { masterTradeId, account: { tenantId } },
    include: { account: true },
  });
  if (!followers.length) return;

  for (const ft of followers) {
    try {
      const ask = await getPrice(ft.symbol) ?? Number(ft.openPrice);
      const bid = (await getBid(ft.symbol)) ?? ask;
      const closePrice = ft.type === "BUY" ? bid : ask;
      const lots = Number(ft.lots);
      const pnl = pnlFor(ft.symbol, ft.type as any, Number(ft.openPrice), closePrice, lots);
      const swap = Number(ft.swap ?? 0);

      await prisma.$transaction(async (tx) => {
        await tx.tradeHistory.create({
          data: {
            ticket: ft.ticket, accountId: ft.accountId, symbol: ft.symbol,
            side: ft.type, lots: ft.lots, openPrice: ft.openPrice,
            closePrice: new Prisma.Decimal(closePrice),
            sl: ft.sl, tp: ft.tp,
            pnl: new Prisma.Decimal(pnl),
            commission: ft.commission ?? new Prisma.Decimal(0),
            swap: new Prisma.Decimal(swap),
            comment: ft.comment,
            closeReason: "COPY",
            openedAt: ft.openedAt,
          },
        });
        await tx.account.update({ where: { id: ft.accountId }, data: { pnl: { increment: new Prisma.Decimal(pnl + swap) } } });
        await tx.trade.delete({ where: { id: ft.id } });
      });
      audit(tenantId, "copy.close", `${(ft.account as any).login} copy #${ft.ticket} closed (master closed) @ ${closePrice} PnL ${pnl.toFixed(2)}`, (ft.account as any).login, "CLIENT");
    } catch (e) {
      console.error("[copy] close failed for follower trade", ft.ticket.toString(), e);
    }
  }
}

export async function syncCopySlTp(masterTradeId: bigint, sl: number, tp: number, tenantId: string) {
  const followers = await prisma.trade.findMany({
    where: { masterTradeId, account: { tenantId } },
    select: { id: true },
  });
  if (!followers.length) return;
  await prisma.trade.updateMany({
    where: { id: { in: followers.map((f) => f.id) } },
    data: { sl: new Prisma.Decimal(sl), tp: new Prisma.Decimal(tp) },
  });
}
