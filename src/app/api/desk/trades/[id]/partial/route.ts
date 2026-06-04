import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { contractFor } from "@/config/contracts";
import { pnlFor } from "@/lib/trademath";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const t: any = await prisma.trade.findUnique({ where: { id: Number(id) }, include: { account: true } });
    if (!t) throw new Error("Position not found");
    if (t.account.tenantId !== s.tenantId) throw new Error("Forbidden");
    const lots = Number(b.lots);
    const full = Number(t.lots);
    if (!lots || lots <= 0 || lots >= full) throw new Error("Lots must be between 0 and " + full);
    const price = Number(b.price) || Number(t.openPrice);
    const gs = await prisma.globalSymbol.findUnique({ where: { symbol: t.symbol } }).catch(() => null);
    const realized = pnlFor(t.symbol, t.type as any, Number(t.openPrice), price, lots, gs?.category || "forex");
    await prisma.$transaction([
      prisma.trade.update({ where: { id: t.id }, data: { lots: full - lots } }),
      prisma.account.update({ where: { id: t.accountId }, data: { pnl: { increment: realized } } }),
    ]);
    try { await prisma.tradeHistory.create({ data: { ticket: t.ticket, accountId: t.accountId, symbol: t.symbol, side: t.type as any, lots: lots, openPrice: Number(t.openPrice), closePrice: price, sl: t.sl, tp: t.tp, pnl: realized, closeReason: "MANUAL" as any, openedAt: t.openedAt } }); } catch (e) {}
    await audit(s.tenantId as string, "trade.partial", t.symbol + " -" + lots + " pnl=" + realized.toFixed(2), s.email || "admin");
    return NextResponse.json({ ok: true, realized });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}