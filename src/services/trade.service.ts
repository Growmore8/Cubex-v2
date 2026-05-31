import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { getPrice } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";

export async function placeOrder(tenantId: string, userId: string, input: any) {
  const account = input.accountId
    ? await prisma.account.findFirst({ where: { tenantId, userId, id: input.accountId } })
    : await prisma.account.findFirst({ where: { tenantId, userId }, orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("No trading account");
  if (account.locked) throw new Error("Account is locked");
  await assertTradingOpen();
  const price = await getPrice(input.symbol);
  if (price == null) throw new Error("No price for " + input.symbol);
  const ticket = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const trade = await prisma.trade.create({
    data: {
      ticket, accountId: account.id, symbol: input.symbol, type: input.side,
      lots: new Prisma.Decimal(input.lots), openPrice: new Prisma.Decimal(price),
      sl: new Prisma.Decimal(input.sl || 0), tp: new Prisma.Decimal(input.tp || 0),
    },
  });
  return {
    id: trade.id.toString(), ticket: trade.ticket.toString(), symbol: trade.symbol, type: trade.type,
    lots: Number(trade.lots), openPrice: Number(trade.openPrice), sl: Number(trade.sl), tp: Number(trade.tp),
    openedAt: trade.openedAt,
  };
}

export async function closeOrder(tenantId: string, userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: BigInt(tradeId), account: { tenantId, userId } } });
  if (!trade) throw new Error("Position not found");
  const price = await getPrice(trade.symbol);
  if (price == null) throw new Error("No price");
  const meta = instruments[trade.symbol] || { contractSize: 100000 };
  const dir = trade.type === "BUY" ? 1 : -1;
  const pnl = (price - Number(trade.openPrice)) * dir * Number(trade.lots) * meta.contractSize;

  await prisma.$transaction(async (tx) => {
    await tx.tradeHistory.create({
      data: {
        ticket: trade.ticket, accountId: trade.accountId, symbol: trade.symbol, side: trade.type,
        lots: trade.lots, openPrice: trade.openPrice, closePrice: new Prisma.Decimal(price),
        sl: trade.sl, tp: trade.tp, pnl: new Prisma.Decimal(pnl), openedAt: trade.openedAt,
      },
    });
    await tx.account.update({ where: { id: trade.accountId }, data: { pnl: { increment: new Prisma.Decimal(pnl) } } });
    await tx.trade.delete({ where: { id: trade.id } });
  });
  return { pnl };
}
