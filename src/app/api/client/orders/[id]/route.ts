import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { validateSlTp } from "@/lib/trademath";
import { emitRefresh } from "@/lib/realtime";
import { audit } from "@/lib/audit";
import { notifyStaff } from "@/services/notification.service";
import { Prisma } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const body = await req.json();
    const trade = await prisma.trade.findFirst({
      where: { id: BigInt(id), account: { userId: s.sub, tenantId: s.tenantId! } },
      include: { account: { select: { login: true, managerId: true } } },
    });
    if (!trade) return NextResponse.json({ ok: false, error: "Position not found" }, { status: 404 });
    const newSl = body.sl !== undefined ? Number(body.sl) || 0 : Number(trade.sl);
    const newTp = body.tp !== undefined ? Number(body.tp) || 0 : Number(trade.tp);
    const err = validateSlTp(trade.type as "BUY" | "SELL", Number(trade.openPrice), newSl, newTp);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    const data: any = {};
    if (body.sl !== undefined) data.sl = new Prisma.Decimal(newSl);
    if (body.tp !== undefined) data.tp = new Prisma.Decimal(newTp);
    await prisma.trade.update({ where: { id: trade.id }, data });
    const label = `${trade.account.login} modified ${trade.symbol} ${trade.type} #${trade.ticket} — SL: ${newSl || "off"} TP: ${newTp || "off"}`;
    audit(s.tenantId!, "trade.modify_sl_tp", label, trade.account.login, "CLIENT");
    notifyStaff(s.tenantId!, { type: "TRADE", title: "SL/TP modified", body: label }, trade.account.managerId).catch(() => {});
    emitRefresh();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}
