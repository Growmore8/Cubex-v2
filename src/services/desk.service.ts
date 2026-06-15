import { prisma } from "@/lib/prisma";
import { assertTradingOpen, assertCan } from "@/lib/perms";
import { getPrice } from "@/lib/prices";
import instruments from "@/config/instruments";
import { Prisma } from "@prisma/client";
import { pnlFor } from "@/lib/trademath";
import { audit } from "@/lib/audit";
import { notifyStaff } from "@/services/notification.service";
import { nextTicket, assertMargin } from "@/services/trade.service";
import { gnum, gprice } from "@/lib/format";

function accountWhere(s: any) {
  if (s.role === "ADMIN" || s.role === "SUPERADMIN") return { tenantId: s.tenantId };
  if (s.role === "MANAGER") return { tenantId: s.tenantId, managerId: s.sub };
  return { id: "__none__" };
}

export async function listOpen(s: any) {
  const trades = await prisma.trade.findMany({
    where: { account: accountWhere(s) },
    orderBy: { openedAt: "desc" },
    include: { account: { select: { login: true, name: true } } },
  });
  return trades.map((t) => ({
    id: t.id.toString(), ticket: t.ticket.toString(),
    accountLogin: t.account.login, accountName: t.account.name,
    symbol: t.symbol, type: t.type, lots: Number(t.lots),
    openPrice: Number(t.openPrice), sl: Number(t.sl), tp: Number(t.tp), openedAt: t.openedAt,
  }));
}

export async function listHistory(s: any) {
  const [rows, fins] = await Promise.all([
    prisma.tradeHistory.findMany({
      where: { account: accountWhere(s) },
      orderBy: { closedAt: "desc" }, take: 100,
      include: { account: { select: { login: true, name: true } } },
    }),
    prisma.financialHistory.findMany({
      where: { account: accountWhere(s) },
      orderBy: { appliedAt: "desc" }, take: 100,
      include: { account: { select: { login: true, name: true } } },
    }),
  ]);
  const tradeRows = rows.map((h: any) => ({
    id: "T" + h.id.toString(), kind: "TRADE",
    ticket: h.ticket.toString(), accountLogin: h.account.login,
    symbol: h.symbol, side: h.side, type: h.side, lots: Number(h.lots),
    openPrice: Number(h.openPrice), closePrice: Number(h.closePrice),
    sl: Number(h.sl), tp: Number(h.tp), pnl: Number(h.pnl),
    closeReason: h.closeReason, desc: h.closeReason,
    openedAt: h.openedAt, closedAt: h.closedAt, at: h.closedAt,
  }));
  const NEG = new Set(["WITHDRAWAL", "CREDIT_OUT", "TRANSFER_OUT"]);
  const finRows = fins.map((f: any) => {
    const raw = Number(f.amount);
    const amt = Math.abs(raw);
    return {
      id: "F" + f.id.toString(), kind: "FIN",
      ticket: f.reference || "-", accountLogin: f.account.login,
      symbol: "-", side: f.type, type: f.type, lots: 0,
      openPrice: 0, closePrice: 0, sl: 0, tp: 0,
      // PNL_ADJUST keeps its real sign (can be + or -); others use the NEG set.
      pnl: f.type === "PNL_ADJUST" ? raw : (NEG.has(f.type) ? -amt : amt),
      closeReason: f.type, desc: f.description || f.type,
      openedAt: f.appliedAt, closedAt: f.appliedAt, at: f.appliedAt,
    };
  });
  const all = [...tradeRows, ...finRows].sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return all.slice(0, 150);
}

export async function reports(s: any) {
  const where = accountWhere(s);
  const [clients, openPositions, agg] = await Promise.all([
    prisma.account.count({ where }),
    prisma.trade.count({ where: { account: where } }),
    prisma.account.aggregate({ where, _sum: { pnl: true, deposit: true, withdrawal: true } }),
  ]);
  return {
    clients, openPositions,
    realizedPnl: Number(agg._sum.pnl || 0),
    deposits: Number(agg._sum.deposit || 0),
    withdrawals: Number(agg._sum.withdrawal || 0),
  };
}

export async function manualTrade(s: any, input: any) {
  const acc = await prisma.account.findFirst({ where: { id: input.accountId, ...accountWhere(s) } });
  if (!acc) throw new Error("Account not in your scope");
  if (acc.locked) throw new Error("Account is locked");
  await assertTradingOpen();
  await assertCan(s, "manualTrade");
  const live = await getPrice(input.symbol);
  const openPrice = (input.openPrice != null && Number(input.openPrice) > 0) ? Number(input.openPrice) : live;
  if (openPrice == null) throw new Error("No price for " + input.symbol);
  // Same margin rule as the client: free margin must cover this trade.
  await assertMargin(acc, { symbol: input.symbol, type: input.type, lots: Number(input.lots) }, live ?? openPrice);
  const openedAt = input.openedAt ? new Date(input.openedAt) : undefined;
  const ticket = await nextTicket(acc.tenantId);
  const t = await prisma.trade.create({
    data: { ticket, accountId: acc.id, symbol: input.symbol, type: input.type,
      lots: new Prisma.Decimal(input.lots), openPrice: new Prisma.Decimal(openPrice),
      sl: new Prisma.Decimal(input.sl || 0), tp: new Prisma.Decimal(input.tp || 0),
      ...(openedAt ? { openedAt } : {}) },
  });
  const label = `${acc.login} ${input.type} ${input.symbol} ${input.lots}L @ ${openPrice} (manual)`;
  audit(acc.tenantId, "trade.manual", label, s.email || "staff", s.role);
  notifyStaff(acc.tenantId, { type: "TRADE", title: "Manual trade", body: label }, acc.managerId).catch(() => {});
  return { id: t.id.toString(), ticket: t.ticket.toString(), openPrice };
}

// Delete an OPEN position outright (as if it never happened). Floating P/L is
// not realized into the balance, so removing it needs no balance change — the
// client's open positions / equity simply update. No client notification.
export async function deleteOpen(s: any, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: BigInt(tradeId), account: accountWhere(s) }, include: { account: { select: { login: true, tenantId: true, managerId: true } } } });
  if (!trade) throw new Error("Position not found");
  await prisma.trade.delete({ where: { id: trade.id } });
  const label = `${trade.account.login} ${trade.symbol} ${trade.type} ${Number(trade.lots)}L deleted (by staff)`;
  audit(trade.account.tenantId, "trade.delete", label, s.email || "staff", s.role);
  notifyStaff(trade.account.tenantId, { type: "TRADE", title: "Trade deleted", body: label }, trade.account.managerId).catch(() => {});
  return { tenantId: trade.account.tenantId };
}

export async function forceClose(s: any, tradeId: string, opts?: { price?: number; closedAt?: Date }) {
  const trade = await prisma.trade.findFirst({ where: { id: BigInt(tradeId), account: accountWhere(s) }, include: { account: true } });
  if (!trade) throw new Error("Position not found");
  // Manual close: use the supplied price (else live market price).
  const price = (opts?.price != null && opts.price > 0) ? opts.price : await getPrice(trade.symbol);
  if (price == null) throw new Error("No price");
  const pnl = pnlFor(trade.symbol, trade.type as any, Number(trade.openPrice), price, Number(trade.lots));
  await prisma.$transaction(async (tx) => {
    await tx.tradeHistory.create({
      data: { ticket: trade.ticket, accountId: trade.accountId, symbol: trade.symbol, side: trade.type, lots: trade.lots, openPrice: trade.openPrice, closePrice: new Prisma.Decimal(price), sl: trade.sl, tp: trade.tp, pnl: new Prisma.Decimal(pnl), openedAt: trade.openedAt, ...(opts?.closedAt ? { closedAt: opts.closedAt } : {}) },
    });
    await tx.account.update({ where: { id: trade.accountId }, data: { pnl: { increment: new Prisma.Decimal(pnl) } } });
    await tx.trade.delete({ where: { id: trade.id } });
  });
  const label = `${trade.account.login} ${trade.symbol} closed @ ${gprice(price)} | PnL ${gnum(pnl, 2)} (by staff)`;
  audit(trade.account.tenantId, "trade.close", label, s.email || "staff", s.role);
  notifyStaff(trade.account.tenantId, { type: "TRADE", title: "Trade closed", body: label }, trade.account.managerId).catch(() => {});
  return { pnl, userId: trade.account.userId, tenantId: trade.account.tenantId };
}
