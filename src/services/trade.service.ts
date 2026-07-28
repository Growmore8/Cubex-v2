import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { getPrice } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";
import { pnlFor, validateSlTp, usedMargin } from "@/lib/trademath";
import { getAccountFxRate } from "@/lib/prices";
import { notifyStaff } from "@/services/notification.service";
import { audit } from "@/lib/audit";
import { gnum, gprice } from "@/lib/format";
import { sendUserMail } from "@/lib/tenant-mail";
import { tradeOpenEmail, tradeCloseEmail, marginCallEmail } from "@/lib/email-templates";
import { getSpreadPips, pipForDigits } from "@/lib/spread";
import { isMarketOpen } from "@/lib/market";
import { replicateTrade, closeCopiedTrades } from "@/services/copy.service";

export async function assertMarketOpen(symbol: string) {
  let cat: string | null = null;
  try { const gs = await prisma.globalSymbol.findUnique({ where: { symbol }, select: { category: true } }); cat = gs?.category || null; } catch {}
  if (!isMarketOpen(symbol, cat)) throw new Error("Market is closed for " + symbol + ". Trading resumes when the market reopens.");
}

export async function nextTicket(tenantId: string): Promise<bigint> {
  try {
    const c = await prisma.counter.upsert({
      where: { tenantId_name: { tenantId, name: "ticket" } },
      create: { tenantId, name: "ticket", nextVal: BigInt(1000001) },
      update: { nextVal: { increment: 1 } },
    });
    return c.nextVal as bigint;
  } catch {
    const c = await prisma.counter.update({
      where: { tenantId_name: { tenantId, name: "ticket" } },
      data: { nextVal: { increment: 1 } },
    });
    return c.nextVal as bigint;
  }
}

export async function assertMargin(account: any, newTrade: { symbol: string; type: "BUY" | "SELL"; lots: number }, price: number) {
  const lev = account.leverage || 100;
  const existing = await prisma.trade.findMany({ where: { accountId: account.id } });
  const priceMap: Record<string, number> = { [newTrade.symbol]: price };
  // Fetch all missing prices in parallel instead of sequential await-in-loop
  const missing = [...new Set(existing.map((t) => t.symbol).filter((s) => priceMap[s] == null))];
  const fetched = await Promise.all(missing.map((s) => getPrice(s)));
  missing.forEach((s, i) => { priceMap[s] = fetched[i] ?? Number(existing.find((t) => t.symbol === s)?.openPrice ?? 0); });
  let floating = 0;
  for (const t of existing) floating += pnlFor(t.symbol, t.type as any, Number(t.openPrice), priceMap[t.symbol], Number(t.lots));
  const balance = Number(account.deposit) + Number(account.pnl) - Number(account.withdrawal);
  // Convert account-currency balance to USD so it can be compared to USD floating P&L and margin.
  const fxRate = await getAccountFxRate(account.currency as string);
  const equity = (balance + Number(account.credit || 0) + Number(account.bonus || 0) + Number(account.insurance || 0)) * fxRate + floating;
  const usedBefore = usedMargin(existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), lev, (sym) => priceMap[sym] ?? price);
  const after = [...existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), { symbol: newTrade.symbol, type: newTrade.type, lots: newTrade.lots }];
  const usedAfter = usedMargin(after, lev, (sym) => priceMap[sym] ?? price);
  const free = equity - usedBefore;
  const required = usedAfter - usedBefore;
  if (free <= 0 || required > free + 1e-6) throw new Error("Not enough money");
}

async function resolvePrice(tenantId: string, symbol: string, side: "BUY" | "SELL", account: any) {
  // Both calls are independent — run in parallel to save ~10ms per market order.
  // getPrice returns the MT5-model BID price (Redis "price:SYMBOL").
  const [rawBid, symRow] = await Promise.all([
    getPrice(symbol),
    prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { digits: true, spreadType: true, commissionPerLot: true, swapLong: true, swapShort: true } }).catch(() => null),
  ]);
  if (rawBid == null) throw new Error("No price for " + symbol);
  const digits = symRow?.digits ?? 5;
  const pip = pipForDigits(digits);
  const adminPips = await getSpreadPips(tenantId, symbol, (account as any).groupId, account.id);
  // MT5 model: SELL executes at BID = rawBid (live display price from feed).
  // BUY executes at ASK = BID + configured spread.
  // getRealBid is intentionally not used here — it stores a stale exchange bid
  // in Redis with no freshness guarantee, causing executions at outdated prices.
  const bid = rawBid;
  const ask = rawBid + adminPips * pip;
  return { ask, bid, symRow };
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

  const { ask, bid, symRow } = await resolvePrice(tenantId, input.symbol, input.side, account);
  const openPrice = input.side === "BUY" ? ask : bid;

  const slErr = validateSlTp(input.side, openPrice, input.sl, input.tp);
  if (slErr) throw new Error(slErr);

  await assertMargin(account, { symbol: input.symbol, type: input.side, lots: Number(input.lots) }, ask);

  // Commission: group override takes priority over symbol default (-1 = use symbol)
  let commRate = Number(symRow?.commissionPerLot ?? 0);
  if (account.groupId) {
    const grp = await (prisma.tradeGroup as any).findFirst({
      where: { id: account.groupId },
      select: { commissionPerLot: true },
    }).catch(() => null);
    if (grp && Number(grp.commissionPerLot) >= 0) commRate = Number(grp.commissionPerLot);
  }
  const commission = Number(input.lots) * commRate;

  // Trailing stop: convert pips to price distance
  const trailingStopPips = Number(input.trailingStop) || 0;
  const digits = symRow?.digits ?? 5;
  const pip = pipForDigits(digits);
  const trailingStop = trailingStopPips > 0 ? trailingStopPips * pip : 0;

  let trade: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ticket = await nextTicket(tenantId);
    try {
      trade = await prisma.trade.create({
        data: {
          ticket, accountId: account.id, symbol: input.symbol, type: input.side,
          lots: new Prisma.Decimal(input.lots), openPrice: new Prisma.Decimal(openPrice),
          sl: new Prisma.Decimal(input.sl || 0), tp: new Prisma.Decimal(input.tp || 0),
          commission: new Prisma.Decimal(commission),
          trailingStop: new Prisma.Decimal(trailingStop),
          comment: input.comment || null,
        },
      });
      break;
    } catch (e: any) {
      if (attempt < 2 && e?.code === "P2002" && e?.meta?.target?.includes("ticket")) continue;
      throw e;
    }
  }

  // Deduct commission immediately from account pnl (in account currency).
  if (commission > 0) {
    const commFxRate = await getAccountFxRate(account.currency as string);
    await prisma.account.update({ where: { id: account.id }, data: { pnl: { decrement: new Prisma.Decimal(commission / commFxRate) } } });
  }

  const label = `${account.login} ${input.side} ${input.symbol} ${input.lots}L @ ${openPrice}${commission > 0 ? ` commission:$${commission.toFixed(2)}` : ""}`;
  audit(tenantId, "trade.open", label, account.login, "CLIENT" as any);
  notifyStaff(tenantId, { type: "TRADE", title: "Trade opened", body: label }, (account as any).managerId).catch(() => {});

  // Email notifications — LIVE accounts only, fire-and-forget
  if (account.type === "LIVE" && account.userId) {
    const uid = account.userId;
    const tInfo = {
      ticket: trade.ticket.toString(), symbol: input.symbol, side: input.side,
      lots: Number(input.lots), openPrice, login: account.login, holderName: account.name,
    };
    sendUserMail(tenantId, uid,
      `Trade opened – ${input.side} ${input.symbol} ${input.lots}L`,
      (brand) => tradeOpenEmail(brand, tInfo)
    ).catch(() => {});

    // Margin call warning — check margin level after placing
    (async () => {
      try {
        const accNow = await prisma.account.findUnique({ where: { id: account.id } });
        if (!accNow) return;
        const openTrades = await prisma.trade.findMany({ where: { accountId: account.id } });
        const priceMap: Record<string, number> = { [input.symbol]: ask };
        const missing2 = [...new Set(openTrades.map((t) => t.symbol).filter((s) => priceMap[s] == null))];
        const fetched2 = await Promise.all(missing2.map((s) => getPrice(s)));
        missing2.forEach((s, i) => { priceMap[s] = fetched2[i] ?? 0; });
        let floating2 = 0;
        for (const t of openTrades) floating2 += pnlFor(t.symbol, t.type as any, Number(t.openPrice), priceMap[t.symbol] ?? 0, Number(t.lots));
        const bal = Number(accNow.deposit) + Number(accNow.pnl) - Number(accNow.withdrawal);
        const eq = bal + Number(accNow.credit || 0) + Number(accNow.bonus || 0) + Number(accNow.insurance || 0) + floating2;
        const lev = accNow.leverage || 100;
        const used = usedMargin(openTrades.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), lev, (s) => priceMap[s] ?? 0);
        const marginLevel = used > 0 ? (eq / used) * 100 : 9999;
        const mcThreshold = Number((accNow as any).mcLevel ?? 50);
        if (marginLevel < mcThreshold * 2) {
          await sendUserMail(tenantId, uid,
            `⚠️ Margin Call Warning – Account ${account.login}`,
            (brand) => marginCallEmail(brand, {
              holderName: account.name, login: account.login,
              marginLevel, equity: eq, usedMargin: used,
            })
          );
        }
      } catch { /* silent */ }
    })();
  }

  // Replicate to copy followers — fire-and-forget so master trade response isn't delayed
  replicateTrade(
    { id: trade.id, ticket: trade.ticket, accountId: account.id, symbol: input.symbol, type: input.side, lots: Number(input.lots), sl: Number(input.sl) || 0, tp: Number(input.tp) || 0, openedAt: trade.openedAt },
    tenantId,
  ).catch(() => {});

  return {
    id: trade.id.toString(), ticket: trade.ticket.toString(), symbol: trade.symbol, type: trade.type,
    lots: Number(trade.lots), openPrice: Number(trade.openPrice), sl: Number(trade.sl), tp: Number(trade.tp),
    commission: Number(trade.commission), openedAt: trade.openedAt,
  };
}

export async function closeOrder(tenantId: string, userId: string, tradeId: string, closeLots?: number) {
  const trade = await prisma.trade.findFirst({ where: { id: BigInt(tradeId), account: { tenantId, userId } }, include: { account: true } });
  if (!trade) throw new Error("Position not found");
  if (trade.account.deactivated) throw new Error("Account is deactivated");
  if (trade.account.locked) throw new Error("Account is locked (read-only)");
  await assertMarketOpen(trade.symbol);

  const { ask, bid } = await resolvePrice(tenantId, trade.symbol, trade.type as "BUY" | "SELL", trade.account);
  const price = trade.type === "BUY" ? bid : ask;

  const totalLots = Number(trade.lots);
  const lots = closeLots != null && closeLots > 0 && closeLots < totalLots ? closeLots : totalLots;
  const isPartial = lots < totalLots;

  const pnl = pnlFor(trade.symbol, trade.type as any, Number(trade.openPrice), price, lots);
  const swap = Number(trade.swap) * (lots / totalLots); // proportional swap for partial close
  const commission = isPartial ? 0 : Number(trade.commission); // commission already deducted on open
  // Convert USD P&L and swap to account currency before crediting.
  const closeFxRate = await getAccountFxRate(trade.account.currency as string);
  const pnlAcc = pnl / closeFxRate;
  const swapAcc = swap / closeFxRate;

  await prisma.$transaction(async (tx) => {
    await tx.tradeHistory.create({
      data: {
        ticket: trade.ticket, accountId: trade.accountId, symbol: trade.symbol, side: trade.type,
        lots: new Prisma.Decimal(lots), openPrice: trade.openPrice, closePrice: new Prisma.Decimal(price),
        sl: trade.sl, tp: trade.tp, pnl: new Prisma.Decimal(pnlAcc),
        commission: new Prisma.Decimal(commission),
        swap: new Prisma.Decimal(swapAcc),
        comment: trade.comment,
        openedAt: trade.openedAt,
      },
    });
    await tx.account.update({ where: { id: trade.accountId }, data: { pnl: { increment: new Prisma.Decimal(pnlAcc + swapAcc) } } });
    if (isPartial) {
      // Reduce lots on open trade; keep remaining swap proportional
      const remainLots = totalLots - lots;
      const remainSwap = Number(trade.swap) * (remainLots / totalLots);
      await tx.trade.update({ where: { id: trade.id }, data: { lots: new Prisma.Decimal(remainLots), swap: new Prisma.Decimal(remainSwap) } });
    } else {
      await tx.trade.delete({ where: { id: trade.id } });
    }
  });

  const label = `${(trade.account as any).login} ${trade.symbol} ${isPartial ? `partial close ${lots}L` : "closed"} @ ${gprice(price)} | PnL ${gnum(pnl, 2)}`;
  audit(tenantId, "trade.close", label, trade.account.login, "CLIENT" as any);
  notifyStaff(tenantId, { type: "TRADE", title: isPartial ? "Partial close" : "Trade closed", body: label }, trade.account.managerId).catch(() => {});

  // Close follower copy trades when master fully closes — fire-and-forget
  if (!isPartial && !(trade as any).masterTradeId) {
    closeCopiedTrades(trade.id, tenantId).catch(() => {});
  }

  // Email notification — LIVE accounts only, fire-and-forget
  if (trade.account.type === "LIVE" && trade.account.userId) {
    const tInfo = {
      ticket: trade.ticket.toString(), symbol: trade.symbol, side: trade.type,
      lots, openPrice: Number(trade.openPrice), closePrice: price,
      pnl, closeReason: "Manual close",
      login: trade.account.login, holderName: (trade.account as any).name,
    };
    sendUserMail(tenantId, trade.account.userId,
      `Trade closed – ${trade.symbol} P/L ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`,
      (brand) => tradeCloseEmail(brand, tInfo)
    ).catch(() => {});
  }

  return { pnl, lots, isPartial };
}
