import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { placeOrder } from "@/services/trade.service";
import { emitRefresh } from "@/lib/realtime";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const o = await prisma.pendingOrder.findUnique({ where: { id }, include: { account: true } });
    if (!o) throw new Error("Order not found");
    if (o.account.userId !== s.sub) throw new Error("Forbidden");
    if (o.account.tenantId !== s.tenantId) throw new Error("Forbidden");

    // Check expiry
    if (o.expiresAt && o.expiresAt < new Date()) {
      await prisma.pendingOrder.delete({ where: { id: o.id } });
      await audit(s.tenantId!, "order.expired", o.account.login + " " + o.symbol + " " + o.side + " " + o.kind + " @ " + o.price, o.account.login, "CLIENT");
      return NextResponse.json({ ok: false, error: "Order expired", expired: true });
    }

    if (o.kind === "STOP_LIMIT") {
      // STOP_LIMIT: the stop triggered — now place a LIMIT order at stopLimit price
      const limitPrice = Number(o.stopLimit) || 0;
      if (!limitPrice) throw new Error("Invalid stop-limit price");
      await prisma.pendingOrder.update({
        where: { id: o.id },
        data: { kind: "LIMIT", price: limitPrice },
      });
      return NextResponse.json({ ok: true, stopLimitConverted: true });
    }

    // LIMIT or STOP: execute as market order
    await placeOrder(s.tenantId!, s.sub, {
      accountId: o.accountId,
      symbol: o.symbol,
      side: o.side,
      lots: Number(o.lots),
      sl: Number(o.sl) || 0,
      tp: Number(o.tp) || 0,
      comment: o.comment || undefined,
    });

    await prisma.pendingOrder.delete({ where: { id: o.id } });
    emitRefresh();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Execute failed" }, { status: 400 });
  }
}
