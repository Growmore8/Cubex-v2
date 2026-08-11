import { NextResponse } from "next/server";
import { requireAdminOrManager, assertWritable } from "@/lib/guard";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { validateSlTp } from "@/lib/trademath";
import { notifyStaff } from "@/services/notification.service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertWritable(s);
    await assertCan(s, "editTrades");
    const b = await req.json();
    const t: any = await prisma.trade.findUnique({ where: { id: Number(id) }, include: { account: true } });
    if (!t) throw new Error("Position not found");
    if (t.account.tenantId !== s.tenantId) throw new Error("Forbidden");
    // Validate TP/SL against the (possibly edited) type and open price
    const newType = (b.type === "BUY" || b.type === "SELL") ? b.type : t.type;
    const newOpen = b.openPrice !== undefined && Number(b.openPrice) > 0 ? Number(b.openPrice) : Number(t.openPrice);
    const newSl = b.sl !== undefined ? Number(b.sl) || 0 : Number(t.sl);
    const newTp = b.tp !== undefined ? Number(b.tp) || 0 : Number(t.tp);
    const slErr = validateSlTp(newType, newOpen, newSl, newTp);
    if (slErr) throw new Error(slErr);
    const data: any = {};
    if (b.sl !== undefined) data.sl = new Prisma.Decimal(Number(b.sl) || 0);
    if (b.tp !== undefined) data.tp = new Prisma.Decimal(Number(b.tp) || 0);
    if (b.lots !== undefined && Number(b.lots) > 0) data.lots = new Prisma.Decimal(Number(b.lots));
    if (b.openPrice !== undefined && Number(b.openPrice) > 0) data.openPrice = new Prisma.Decimal(Number(b.openPrice));
    if (b.openedAt !== undefined && b.openedAt) data.openedAt = new Date(b.openedAt);
    if (b.type !== undefined && (b.type === "BUY" || b.type === "SELL")) data.type = b.type;
    await prisma.trade.update({ where: { id: t.id }, data });
    await audit(s.tenantId as string, "trade.modify", t.symbol + " " + JSON.stringify(data), s.email || "admin");
    notifyStaff(s.tenantId as string, { title: "Trade modified — " + (t.account.login || ""), body: t.symbol + " #" + t.ticket + " by " + (s.email || "staff"), type: "TRADE" }, t.account.managerId).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
