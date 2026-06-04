import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { getPrice } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";
import { marginFor, pnlFor, validateSlTp } from "@/lib/trademath";

export async function placeOrder(tenantId: string, userId: string, input: any) {
  const account = input.accountId
    ? await prisma.account.findFirst({ where: { tenantId, userId, id: input.accountId } })
    : await prisma.account.findFirst({ where: { tenantId, userId }, orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("No trading account");
  if (account.deactivated) throw new Error("Account is deactivated");
  if (account.locked) throw new Error("Account is locked (read-only)");
  await assertTradingOpen();
  const price = await getPrice(input.symbol);
  if (price == null) throw new Error("No price for " + input.symbol);

  // TP/SL placement validation
  const slErr = validateSlTp(input.side, price, input.sl, input.tp);
  if (slErr) throw new Error(slErr);

  // Free-margin check — must have enough free margin to open this trade
  const lev = account.leverage || 100;
  const existing = await prisma.trade.findMany({ where: { accountId: account.id } });
  let floating = 0, usedMargin = 0;
  for (const t of existing) {
    const cur = (await getPrice(t.symbol)) ?? Number(t.openPrice);
    floating += pnlFor(t.symbol, t.type as any, Number(t.openPrice), cur, Number(t.lots));
    usedMargin += marginFor(t.symbol, Number(t.lots), cur, lev);
  }
  const balance = Number(account.deposit) - Number(account.withdrawal) + Number(account.credit) + Number(account.bonus) + Number(account.pnl);
  const equity = balance + floating;
  const freeMargin = equity - usedMargin;
  const requiredMargin = marginFor(input.symbol, Number(input.lots), price, lev);
  if (freeMargin <= 0 || freeMargin < requiredMargin) throw new Error("Not enough money");

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
  const trade = await prisma.trade.findFirst({ where: { id: BigInt(tradeId), account: { tenantId, userId } }, include: { account: true } });
  if (!trade) throw new Error("Position not found");
  if (trade.account.deactivated) throw new Error("Account is deactivated");
  if (trade.account.locked) throw new Error("Account is locked (read-only)");
  const price = await getPrice(trade.symbol);
  if (price == null) throw new Error("No price");
  const pnl = pnlFor(trade.symbol, trade.type as any, Number(trade.openPrice), price, Number(trade.lots));

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
