import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { emitRefresh } from "@/lib/realtime";
import { pnlFor } from "@/lib/trademath";

const FIN: Record<string, { col: string; sign: number }> = {
  DEPOSIT: { col: "deposit", sign: 1 },
  WITHDRAWAL: { col: "withdrawal", sign: 1 },
  CREDIT_IN: { col: "credit", sign: 1 },
  CREDIT_OUT: { col: "credit", sign: -1 },
  BONUS: { col: "bonus", sign: 1 },
  INSURANCE: { col: "insurance", sign: 1 },
  TRANSFER_IN: { col: "deposit", sign: 1 },
  TRANSFER_OUT: { col: "withdrawal", sign: 1 },
};

function parseId(raw: string): { kind: "TRADE" | "FIN"; id: bigint } | null {
  const m = /^([TF])(\d+)$/.exec(raw);
  if (m) return { kind: m[1] === "F" ? "FIN" : "TRADE", id: BigInt(m[2]) };
  if (/^\d+$/.test(raw)) return { kind: "TRADE", id: BigInt(raw) };
  return null;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const p = parseId(id);
    if (!p) throw new Error("Bad id");
    await assertCan(s, p.kind === "TRADE" ? "deleteTrades" : "deleteFinancial");
    if (p.kind === "TRADE") {
      const row = await prisma.tradeHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
      if (!row) throw new Error("Trade history not found");
      await prisma.$transaction([
        prisma.account.update({ where: { id: row.accountId }, data: { pnl: { decrement: row.pnl } } }),
        prisma.tradeHistory.delete({ where: { id: p.id } }),
      ]);
      await audit(s.tenantId!, "history.deleteTrade", "#" + row.ticket.toString(), s.email);
    } else {
      const row = await prisma.financialHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
      if (!row) throw new Error("Financial history not found");
      const rule = FIN[row.type];
      const ops: any[] = [];
      if (row.type === "PNL_ADJUST") {
        // Manual P/L stored signed — reverse it out of the account's pnl so the
        // balance/equity/ticker update everywhere.
        ops.push(prisma.account.update({ where: { id: row.accountId }, data: { pnl: { decrement: Number(row.amount) } } }));
      } else if (rule) {
        ops.push(prisma.account.update({ where: { id: row.accountId }, data: { [rule.col]: { increment: -rule.sign * Math.abs(Number(row.amount)) } } as any }));
      }
      ops.push(prisma.financialHistory.delete({ where: { id: p.id } }));
      // Transfer delete-sync: remove the paired entry on the other account too
      if ((row.type === "TRANSFER_IN" || row.type === "TRANSFER_OUT") && row.reference) {
        const pair = await prisma.financialHistory.findFirst({ where: { reference: row.reference, NOT: { id: row.id } } });
        if (pair) {
          const prule = FIN[pair.type];
          if (prule) ops.push(prisma.account.update({ where: { id: pair.accountId }, data: { [prule.col]: { increment: -prule.sign * Math.abs(Number(pair.amount)) } } as any }));
          ops.push(prisma.financialHistory.delete({ where: { id: pair.id } }));
        }
      }
      await prisma.$transaction(ops);
      await audit(s.tenantId!, "history.deleteFin", row.type + " " + Number(row.amount), s.email);
    }
    emitRefresh();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const p = parseId(id);
    if (!p) throw new Error("Bad id");
    const b = await req.json();
    await assertCan(s, p.kind === "TRADE" ? "editTrades" : "editFinancial");
    if (p.kind === "TRADE") {
      const row = await prisma.tradeHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
      if (!row) throw new Error("Not found");
      const data: any = {};
      if (b.openPrice != null) data.openPrice = Number(b.openPrice);
      if (b.lots != null) data.lots = Number(b.lots);
      if (b.sl != null) data.sl = Number(b.sl);
      if (b.tp != null) data.tp = Number(b.tp);
      let pnlDelta = 0;
      if (b.closePrice != null) {
        data.closePrice = Number(b.closePrice);
        // Auto-recalculate P&L from the new close price
        const recalcPnl = pnlFor(
          row.symbol,
          row.side as "BUY" | "SELL",
          Number(b.openPrice ?? row.openPrice),
          Number(b.closePrice),
          Number(b.lots ?? row.lots),
        );
        pnlDelta = recalcPnl - Number(row.pnl);
        data.pnl = recalcPnl;
      }
      // Explicit pnl in body overrides the auto-calculated value (admin adjustment)
      if (b.pnl != null) { const np = Number(b.pnl); pnlDelta = np - Number(row.pnl); data.pnl = np; }
      const ops: any[] = [prisma.tradeHistory.update({ where: { id: p.id }, data })];
      if (pnlDelta !== 0) ops.push(prisma.account.update({ where: { id: row.accountId }, data: { pnl: { increment: pnlDelta } } }));
      await prisma.$transaction(ops);
    } else {
      const row = await prisma.financialHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
      if (!row) throw new Error("Not found");
      if (row.type === "TRANSFER_IN" || row.type === "TRANSFER_OUT") throw new Error("Transfers cannot be edited — delete and recreate instead");
      const data: any = {};
      let amtDelta = 0;
      if (b.amount != null) { const na = Math.abs(Number(b.amount)); amtDelta = na - Math.abs(Number(row.amount)); data.amount = na; }
      if (b.description != null) data.description = String(b.description);
      const rule = FIN[row.type];
      const ops: any[] = [prisma.financialHistory.update({ where: { id: p.id }, data })];
      if (amtDelta !== 0 && rule) ops.push(prisma.account.update({ where: { id: row.accountId }, data: { [rule.col]: { increment: rule.sign * amtDelta } } as any }));
      await prisma.$transaction(ops);
    }
    await audit(s.tenantId!, "history.edit", p.kind + " " + p.id.toString(), s.email);
    emitRefresh();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}