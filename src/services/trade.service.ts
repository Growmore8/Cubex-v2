import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { getPrice, getBid } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";
import { pnlFor, validateSlTp, usedMargin } from "@/lib/trademath";
import { notifyStaff } from "@/services/notification.service";
import { audit } from "@/lib/audit";
import { gnum, gprice } from "@/lib/format";
import { getSpreadPips, pipForDigits } from "@/lib/spread";
import { isMarketOpen } from "@/lib/market";

// Throws if the symbol's market is closed (weekend forex/metals, etc.). Used to
// block live + pending orders for clients and normal desk trades. Admin/manager
// MANUAL trades bypass this.
export async function assertMarketOpen(symbol: string) {
  let cat: string | null = null;
  try { const gs = await prisma.globalSymbol.findUnique({ where: { symbol }, select: { category: true } }); cat = gs?.category || null; } catch {}
  if (!isMarketOpen(symbol, cat)) throw new Error("Market is closed for " + symbol + ". Trading resumes when the market reopens.");
}

// Short, per-tenant sequential trade ticket (MT5-style, e.g. 1000001) instead of a
// 16-digit timestamp. Atomic upsert+increment keeps Trade.ticket (@unique) safe.
export async function nextTicket(tenantId: string): Promise<bigint> {
  const c = await prisma.counter.upsert({
    where: { tenantId_name: { tenantId, name: "ticket" } },
    create: { tenantId, name: "ticket", nextVal: BigInt(1000001) },
    update: { nextVal: { increment: 1 } },
  });
  return c.nextVal as bigint;
}

// Reject a new trade when the account's free margin can't cover it. Free margin
// must be positive AND at least the margin required for this trade, otherwise
// the new (net) margin would exceed equity. Shared by client + staff so the
// "Not enough money" rule is identical on every side.
export async function assertMargin(account: any, newTrade: { symbol: string; type: "BUY" | "SELL"; lots: number }, price: number) {
  const lev = account.leverage || 100;
  const existing = await prisma.trade.findMany({ where: { accountId: account.id } });
  const priceMap: Record<string, number> = { [newTrade.symbol]: price };
  for (const t of existing) if (priceMap[t.symbol] == null) priceMap[t.symbol] = (await getPrice(t.symbol)) ?? Number(t.openPrice);
  let floating = 0;
  for (const t of existing) floating += pnlFor(t.symbol, t.type as any, Number(t.openPrice), priceMap[t.symbol], Number(t.lots));
  const balance = Number(account.deposit) - Number(account.withdrawal) + Number(account.credit) + Number(account.bonus) + Number(account.pnl);
  const equity = balance + floating;
  const usedBefore = usedMargin(existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), lev, (sym) => priceMap[sym] ?? price);
  const after = [...existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), { symbol: newTrade.symbol, type: newTrade.type, lots: newTrade.lots }];
  const usedAfter = usedMargin(after, lev, (sym) => priceMap[sym] ?? price);
  const free = equity - usedBefore;
  const required = usedAfter - usedBefore;
  if (free <= 0 || required > free + 1e-6) throw new Error("Not enough money");
}

export async function placeOrder(tenantId: string, userId: string, input: any) {
  const account = input.accountId
    ? await prisma.account.findFirst({ where: { tenantId, userId, id: input.accountId } })
    : await prisma.account.findFirst({ where: { tenantId, userId }, orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("No trading account");
  if (account.deactivated) throw new Error("Account is deactivated");
  if (account.locked) throw new Error("Account is locked (read-only)");
  await assertTradingOpen();
  await assertMarketOpen(input.symbol);
  const ask = await getPrice(input.symbol);
  if (ask == null) throw new Error("No price for " + input.symbol);

  // Compute spread-adjusted open price: BUY opens at ask, SELL opens at bid (MT5 standard)
  const symRow = await prisma.symbol.findFirst({ where: { tenantId, symbol: input.symbol }, select: { digits: true } }).catch(() => null);
  const digits = symRow?.digits ?? 5;
  const pip = pipForDigits(digits);
  const adminPips = await getSpreadPips(tenantId, input.symbol, (account as any).groupId, account.id);
  // Use real bid from Binance/Kraken if available + admin markup on top
  // Fall back to ask − admin spread when no real bid (TwelveData/Finnhub feeds)
  const realBid = await getBid(input.symbol);
  const validRealBid = realBid != null && realBid > 0 && realBid < ask;
  const bid = validRealBid
    ? Math.max(0, realBid - adminPips * pip)   // live spread + admin markup
    : Math.max(0, ask - adminPips * pip);       // admin spread only
  const openPrice = input.side === "BUY" ? ask : bid;

  const slErr = validateSlTp(input.side, openPrice, input.sl, input.tp);
  if (slErr) throw new Error(slErr);

  await assertMargin(account, { symbol: input.symbol, type: input.side, lots: Number(input.lots) }, ask);

  const ticket = await nextTicket(tenantId);
  const trade = await prisma.trade.create({
    data: {
      ticket, accountId: account.id, symbol: input.symbol, type: input.side,
      lots: new Prisma.Decimal(input.lots), openPrice: new Prisma.Decimal(openPrice),
      sl: new Prisma.Decimal(input.sl || 0), tp: new Prisma.Decimal(input.tp || 0),
    },
  });
  const label = `${account.login} ${input.side} ${input.symbol} ${input.lots}L @ ${openPrice}`;
  audit(tenantId, "trade.open", label, account.login, "CLIENT" as any);
  notifyStaff(tenantId, { type: "TRADE", title: "Trade opened", body: label }, (account as any).managerId).catch(() => {});
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
  const ask = await getPrice(trade.symbol);
  if (ask == null) throw new Error("No price");
  // BUY closes at bid (ask − spread), SELL closes at ask (MT5 standard)
  const symRow = await prisma.symbol.findFirst({ where: { tenantId, symbol: trade.symbol }, select: { digits: true } }).catch(() => null);
  const digits = symRow?.digits ?? 5;
  const pip = pipForDigits(digits);
  const adminPips = await getSpreadPips(tenantId, trade.symbol, (trade.account as any).groupId, trade.accountId.toString());
  const realBid = await getBid(trade.symbol);
  const validRealBid = realBid != null && realBid > 0 && realBid < ask;
  const closeBid = validRealBid
    ? Math.max(0, realBid - adminPips * pip)
    : Math.max(0, ask - adminPips * pip);
  const price = trade.type === "BUY" ? closeBid : ask;
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
  const label = `${(trade.account as any).login} ${trade.symbol} closed @ ${gprice(price)} | PnL ${gnum(pnl, 2)}`;
  audit(tenantId, "trade.close", label, trade.account.login, "CLIENT" as any);
  notifyStaff(tenantId, { type: "TRADE", title: "Trade closed", body: label }, trade.account.managerId).catch(() => {});
  return { pnl };
}
