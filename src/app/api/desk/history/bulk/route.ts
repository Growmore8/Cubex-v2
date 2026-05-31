import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";

const FIN: Record<string, { col: string; sign: number }> = {
  DEPOSIT: { col: "deposit", sign: 1 }, WITHDRAWAL: { col: "withdrawal", sign: 1 },
  CREDIT_IN: { col: "credit", sign: 1 }, CREDIT_OUT: { col: "credit", sign: -1 },
  BONUS: { col: "bonus", sign: 1 }, INSURANCE: { col: "insurance", sign: 1 },
  TRANSFER_IN: { col: "deposit", sign: 1 }, TRANSFER_OUT: { col: "deposit", sign: -1 },
};

function parseId(raw: string): { kind: "TRADE" | "FIN"; id: bigint } | null {
  const m = /^([TF])(\d+)$/.exec(raw);
  if (m) return { kind: m[1] === "F" ? "FIN" : "TRADE", id: BigInt(m[2]) };
  if (/^\d+$/.test(raw)) return { kind: "TRADE", id: BigInt(raw) };
  return null;
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const ids: string[] = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) throw new Error("No ids");
    const kinds = ids.map((r) => parseId(String(r))).filter((x): x is { kind: "TRADE" | "FIN"; id: bigint } => !!x);
    if (kinds.some((k) => k.kind === "TRADE")) await assertCan(s, "deleteTrades");
    if (kinds.some((k) => k.kind === "FIN")) await assertCan(s, "deleteFinancial");
    let done = 0;
    for (const raw of ids) {
      const p = parseId(String(raw));
      if (!p) continue;
      if (p.kind === "TRADE") {
        const row = await prisma.tradeHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
        if (!row) continue;
        await prisma.$transaction([
          prisma.account.update({ where: { id: row.accountId }, data: { pnl: { decrement: row.pnl } } }),
          prisma.tradeHistory.delete({ where: { id: p.id } }),
        ]);
        done++;
      } else {
        const row = await prisma.financialHistory.findFirst({ where: { id: p.id, account: { tenantId: s.tenantId! } } });
        if (!row) continue;
        const rule = FIN[row.type];
        const ops: any[] = [];
        if (rule) ops.push(prisma.account.update({ where: { id: row.accountId }, data: { [rule.col]: { increment: -rule.sign * Math.abs(Number(row.amount)) } } as any }));
        ops.push(prisma.financialHistory.delete({ where: { id: p.id } }));
        await prisma.$transaction(ops);
        done++;
      }
    }
    await audit(s.tenantId!, "history.bulkDelete", done + " rows", s.email);
    return NextResponse.json({ ok: true, deleted: done });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}