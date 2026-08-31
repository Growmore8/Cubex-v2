import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { getPrice, getBid, getAsk } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";
import { pnlFor, validateSlTp, usedMargin } from "@/lib/trademath";
import { getAccountFxRate } from "@/lib/prices";
import { notifyStaff } from "@/services/notification.service";
import { audit } from "@/lib/audit";
import { gnum, gprice } from "@/lib/format";
import { getSpreadPips, getSaDefaultSpreadPips, pipForDigits } from "@/lib/spread";
import { isMarketOpen } from "@/lib/market";
import { replicateTrade, closeCopiedTrades } from "@/services/copy.service";
import { Redis as IoRedis } from "ioredis";

// Singleton Redis client for spread config cache (populated by server.js every 60s)
const _g = global as any;
const _spreadCache: IoRedis = _g.__tradeSpreadCache ?? (_g.__tradeSpreadCache = new IoRedis(process.env.REDIS_URL || "redis://localhost:6379"));

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

export async function assertMargin(account: any, newTrade: { symbol: string; type: "BUY" | "SELL"; lots: number }, price: number, prefetchedTrades?: any[], prefetchedFxRate?: number) {
  const lev = account.leverage || 100;
  const existing = prefetchedTrades ?? await prisma.trade.findMany({ where: { accountId: account.id } });
  const priceMap: Record<string, number> = { [newTrade.symbol]: price };
  // Fetch all missing prices in parallel instead of sequential await-in-loop
  const missing = [...new Set(existing.map((t) => t.symbol).filter((s) => priceMap[s] == null))];
  const fetched = await Promise.all(missing.map((s) => getPrice(s)));
  missing.forEach((s, i) => { priceMap[s] = fetched[i] ?? Number(existing.find((t) => t.symbol === s)?.openPrice ?? 0); });
  let floating = 0;
  for (const t of existing) floating += pnlFor(t.symbol, t.type as any, Number(t.openPrice), priceMap[t.symbol], Number(t.lots));
  if (Number(account.credit) > 0 && account.creditSettleTo && new Date(account.creditSettleTo) < new Date()) {
    throw new Error("Trading suspended — please clear your outstanding credit before resuming.");
  }
  const balance = Number(account.deposit) + Number(account.pnl) - Number(account.withdrawal);
  // Use pre-fetched FX rate when available (already fetched in parallel with price resolution)
  const fxRate = prefetchedFxRate ?? await getAccountFxRate(account.currency as string);
  const equity = (balance + Number(account.credit || 0) + Number(account.bonus || 0) + Number(account.insurance || 0)) * fxRate + floating;
  const usedBefore = usedMargin(existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), lev, (sym) => priceMap[sym] ?? price);
  const after = [...existing.map((t) => ({ symbol: t.symbol, type: t.type as "BUY" | "SELL", lots: Number(t.lots) })), { symbol: newTrade.symbol, type: newTrade.type, lots: newTrade.lots }];
  const usedAfter = usedMargin(after, lev, (sym) => priceMap[sym] ?? price);
  const free = equity - usedBefore;
  const required = usedAfter - usedBefore;
  if (free <= 0 || required > free + 1e-6) throw new Error("Not enough money");
}

async function resolvePrice(tenantId: string, symbol: string, side: "BUY" | "SELL", account: any) {
  const groupId = (account as any).groupId as string | null | undefined;
  const accountId = account.id as string | null | undefined;

  // Try Redis spread cache first (written by server.js every 60s); fall back to DB on miss.
  const [rawBid, rawAsk, realBidRaw, symCfgRaw, gsCatRaw, grpCfgRaw, accMuRaw, symOvRaw] = await Promise.all([
    getPrice(symbol),
    getAsk(symbol),
    getBid(symbol),
    _spreadCache.hget('cubex:sym-cfg', `${tenantId}:${symbol}`).catch(() => null),
    _spreadCache.hget('cubex:gs-cat', symbol).catch(() => null),
    groupId ? _spreadCache.hget('cubex:grp-cfg', groupId).catch(() => null) : null,
    accountId ? _spreadCache.hget('cubex:acc-mu', accountId).catch(() => null) : null,
    accountId ? _spreadCache.hget('cubex:acc-ov', `${accountId}:${symbol}`).catch(() => null) : null,
  ]);

  if (rawBid == null) throw new Error("No price for " + symbol);

  // Parse cached values
  const cachedSym = symCfgRaw ? (() => { try { return JSON.parse(symCfgRaw); } catch { return null; } })() : null;
  const cachedGrp = grpCfgRaw ? (() => { try { return JSON.parse(grpCfgRaw); } catch { return null; } })() : null;
  const cachedAccMu = accMuRaw !== null ? Number(accMuRaw) : null;
  const cachedSymOv = symOvRaw !== null ? Number(symOvRaw) : null;

  // DB fallback only when Redis cache is cold (first ~60s after deploy or Redis restart)
  const [symRow, grpRow, accMarkup, symOverride] = await Promise.all([
    cachedSym ? null : prisma.symbol.findFirst({ where: { tenantId, symbol }, select: { digits: true, spreadType: true, commissionPerLot: true, swapLong: true, swapShort: true, spread: true } }).catch(() => null),
    (!cachedGrp && groupId) ? (prisma.tradeGroup as any).findUnique({ where: { id: groupId }, select: { spread: true, spreadType: true, commissionPerLot: true } }).catch(() => null) : null,
    (cachedAccMu === null && accountId) ? prisma.account.findUnique({ where: { id: accountId }, select: { spreadMarkup: true } }).catch(() => null) : null,
    (cachedSymOv === null && accountId) ? prisma.accountSymbolOverride.findUnique({ where: { accountId_symbol: { accountId, symbol } }, select: { spreadOverride: true } }).catch(() => null) : null,
  ]);

  // Merge cached + DB results into unified shape
  const effectiveSym = cachedSym ?? symRow;
  const effectiveGrp = cachedGrp ?? grpRow;
  const effectiveAccMu = cachedAccMu ?? Number(accMarkup?.spreadMarkup ?? 0);
  const effectiveOv = cachedSymOv !== null ? cachedSymOv : symOverride?.spreadOverride;

  const digits = effectiveSym?.digits ?? 5;
  const pip = pipForDigits(digits);

  // Per-client-per-symbol override wins everything (0 = genuine zero spread)
  const clientSymOverride = effectiveOv;
  const hasOverride = clientSymOverride !== null && clientSymOverride !== undefined;
  const grpSpreadMarkup = ((effectiveGrp?.spreadType ?? "FIXED") === "FIXED") ? Number(effectiveGrp?.spread ?? 0) : 0;
  const adminPips = hasOverride
    ? Number(clientSymOverride)
    : Number(effectiveSym?.spread ?? 0) + grpSpreadMarkup + effectiveAccMu;

  let bid: number;
  let ask: number;

  // liveSpread sanity: a stale ask:sym combined with a fresh bid:sym can produce
  // an enormous artificial spread (e.g. stale ask 4611 − current bid 4456 = 154 on gold).
  // Cap at 500 pips; anything beyond that means the cached values are inconsistent
  // and we must fall back to the configured spread instead.
  const MAX_LIVE_SPREAD_PIPS = 500;
  const liveSpreadOk = rawAsk != null && rawAsk > rawBid && (rawAsk - rawBid) / pip <= MAX_LIVE_SPREAD_PIPS;
  if (liveSpreadOk) {
    // Real exchange bid/ask from Massive/Binance/Kraken.
    // Anchor to the smoothed display price (rawBid = getPrice) so the execution price
    // matches what the client sees on screen, preventing slippage surprises from the
    // display-smoothing lag. Real market spread is preserved on top.
    const realBid = (realBidRaw != null && realBidRaw > 0) ? realBidRaw : rawBid;
    const liveSpread = rawAsk - realBid; // actual exchange spread in price units
    bid = rawBid;                        // display price = what client sees
    ask = rawBid + liveSpread + adminPips * pip;
  } else {
    // Single-price feed (TD/FH): construct spread from tenant config.
    // If tenant has no spread configured, fall back to SA-level default per category.
    let effectivePips = adminPips;
    if (effectivePips <= 0) {
      const cat = gsCatRaw ?? (await prisma.globalSymbol.findUnique({ where: { symbol }, select: { category: true } }).catch(() => null))?.category ?? "forex";
      effectivePips = await getSaDefaultSpreadPips(cat);
    }
    bid = rawBid;
    ask = rawBid + effectivePips * pip;
  }

  return { ask, bid, symRow: effectiveSym, grpRow: effectiveGrp };
}

export async function placeOrder(tenantId: string, userId: string, input: any) {
  const account = input.accountId
    ? await prisma.account.findFirst({ where: { tenantId, userId, id: input.accountId } })
    : await prisma.account.findFirst({ where: { tenantId, userId }, orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("No trading account");
  if (account.deactivated) throw new Error("Account is deactivated");
  if (account.locked) throw new Error("Account is locked (read-only)");

  // Pre-fetch open trades in parallel with price resolution and market checks —
  // assertMargin needs them but only requires accountId which we have immediately.
  const existingTradesP = prisma.trade.findMany({ where: { accountId: account.id } });
  const fxRateP = getAccountFxRate(account.currency as string);

  // Run all pre-trade checks and price resolution in parallel
  const [, , priceResult, existingTrades, fxRate] = await Promise.all([
    assertTradingOpen(),
    assertMarketOpen(input.symbol),
    resolvePrice(tenantId, input.symbol, input.side, account),
    existingTradesP,
    fxRateP,
  ]);
  const { ask, bid, symRow, grpRow } = priceResult;
  const openPrice = input.side === "BUY" ? ask : bid;

  const slErr = validateSlTp(input.side, openPrice, input.sl, input.tp);
  if (slErr) throw new Error(slErr);

  await assertMargin(account, { symbol: input.symbol, type: input.side, lots: Number(input.lots) }, ask, existingTrades, fxRate);

  // Commission: group override takes priority over symbol default (grpRow already fetched in resolvePrice)
  let commRate = Number(symRow?.commissionPerLot ?? 0);
  if (grpRow && Number((grpRow as any).commissionPerLot) >= 0) commRate = Number((grpRow as any).commissionPerLot);
  const commission = Number(input.lots) * commRate;

  // Trailing stop: convert pips to price distance
  const trailingStopPips = Number(input.trailingStop) || 0;
  const digits = symRow?.digits ?? 5;
  const pip = pipForDigits(digits);
  const trailingStop = trailingStopPips > 0 ? trailingStopPips * pip : 0;

  // Start FX rate fetch early — runs in parallel with ticket creation below
  const commFxRateP = commission > 0 ? getAccountFxRate(account.currency as string) : Promise.resolve(1);

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
    const commFxRate = await commFxRateP;
    await prisma.account.update({ where: { id: account.id }, data: { pnl: { decrement: new Prisma.Decimal(commission / commFxRate) } } });
  }

  const label = `${account.login} ${input.side} ${input.symbol} ${input.lots}L @ ${openPrice}${commission > 0 ? ` commission:$${commission.toFixed(2)}` : ""}`;
  audit(tenantId, "trade.open", label, account.login, "CLIENT" as any).catch(() => {});
  notifyStaff(tenantId, { type: "TRADE", title: "Trade opened", body: label }, (account as any).managerId).catch(() => {});


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

  // All pre-close operations run in parallel
  const [, { ask, bid }, closeFxRate] = await Promise.all([
    assertMarketOpen(trade.symbol),
    resolvePrice(tenantId, trade.symbol, trade.type as "BUY" | "SELL", trade.account),
    getAccountFxRate(trade.account.currency as string),
  ]);
  const price = trade.type === "BUY" ? bid : ask;

  const totalLots = Number(trade.lots);
  const lots = closeLots != null && closeLots > 0 && closeLots < totalLots ? closeLots : totalLots;
  const isPartial = lots < totalLots;

  const pnl = pnlFor(trade.symbol, trade.type as any, Number(trade.openPrice), price, lots);
  const swap = Number(trade.swap) * (lots / totalLots); // proportional swap for partial close
  const commission = isPartial ? 0 : Number(trade.commission); // commission already deducted on open
  // Convert USD P&L and swap to account currency before crediting.
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
    // Only credit the price-based P&L — swap was already applied to account.pnl
    // every night during the swap rollover, so adding it again here would double-charge.
    await tx.account.update({ where: { id: trade.accountId }, data: { pnl: { increment: new Prisma.Decimal(pnlAcc) } } });
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
  audit(tenantId, "trade.close", label, trade.account.login, "CLIENT" as any).catch(() => {});
  notifyStaff(tenantId, { type: "TRADE", title: isPartial ? "Partial close" : "Trade closed", body: label }, trade.account.managerId).catch(() => {});

  // Close follower copy trades when master fully closes — fire-and-forget
  if (!isPartial && !(trade as any).masterTradeId) {
    closeCopiedTrades(trade.id, tenantId).catch(() => {});
  }


  return { pnl, lots, isPartial };
}
