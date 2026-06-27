import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { assertTradingOpen } from "@/lib/perms";
import { assertMarketOpen } from "@/services/trade.service";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";
import { notifyStaff } from "@/services/notification.service";
async function acc(s: any, accountId?: string) {
  if (accountId) {
    const a = await prisma.account.findFirst({ where: { tenantId: s.tenantId, userId: s.sub, id: accountId } });
    if (a) return a;
  }
  return prisma.account.findFirst({ where: { tenantId: s.tenantId, userId: s.sub }, orderBy: { createdAt: "asc" } });
}
export async function GET(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const a = await acc(s, url.searchParams.get("accountId") || undefined); if (!a) return NextResponse.json({ ok: true, pending: [] });
  const pending = await prisma.pendingOrder.findMany({ where: { accountId: a.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, pending: pending.map((o) => ({ id: o.id, symbol: o.symbol, side: o.side, kind: o.kind, lots: Number(o.lots), price: Number(o.price), sl: Number(o.sl), tp: Number(o.tp), stopLimit: Number((o as any).stopLimit ?? 0), comment: (o as any).comment || null, expiresAt: o.expiresAt?.toISOString() ?? null })) });
}
export async function POST(req: Request) {
  const s = await requireClient(); if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertTradingOpen();
    const b = await req.json();
    await assertMarketOpen(b.symbol);     // block pending orders when the market is closed
    const a = await acc(s, b.accountId); if (!a) throw new Error("No account");
    if (a.locked) throw new Error("Account is locked");
    const lots = Number(b.lots); const price = Number(b.price);
    if (!lots || lots <= 0) throw new Error("Invalid lots");
    if (!price || price <= 0) throw new Error("Invalid trigger price");
    const side = b.side === "SELL" ? "SELL" : "BUY";
    const validKinds = ["LIMIT", "STOP", "STOP_LIMIT"];
    const kind = validKinds.includes(b.kind) ? b.kind : "LIMIT";
    // Validate trigger price direction against current market price
    const curAsk = Number(b.currentAsk) || 0;
    if (curAsk > 0) {
      if (side === "BUY"  && kind === "LIMIT" && price >= curAsk) throw new Error("Buy Limit must be below current price (" + curAsk + ")");
      if (side === "BUY"  && kind === "STOP"  && price <= curAsk) throw new Error("Buy Stop must be above current price (" + curAsk + ")");
      if (side === "SELL" && kind === "LIMIT" && price <= curAsk) throw new Error("Sell Limit must be above current price (" + curAsk + ")");
      if (side === "SELL" && kind === "STOP"  && price >= curAsk) throw new Error("Sell Stop must be below current price (" + curAsk + ")");
    }
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    await prisma.pendingOrder.create({ data: { tenantId: a.tenantId, accountId: a.id, symbol: b.symbol, side: side as any, kind, lots, price, sl: Number(b.sl) || 0, tp: Number(b.tp) || 0, stopLimit: Number(b.stopLimit) || 0, comment: b.comment || null, expiresAt } });
    const label = `${a.login} placed ${kind} ${side} ${b.symbol} ${lots}L @ ${price}${Number(b.sl) ? " SL:" + b.sl : ""}${Number(b.tp) ? " TP:" + b.tp : ""}`;
    audit(a.tenantId, "trade.pending_placed", label, a.login, "CLIENT");
    notifyStaff(a.tenantId, { type: "TRADE", title: "Pending order placed", body: label }, a.managerId).catch(() => {});
    emitRefresh(); // sync the client's other open devices
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}