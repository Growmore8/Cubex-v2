import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const amount = Number(b.amount);
    if (!b.fromId || !b.toId) throw new Error("Pick both accounts");
    if (b.fromId === b.toId) throw new Error("Pick two different accounts");
    if (!amount || amount <= 0) throw new Error("Enter a valid amount");
    const from = await prisma.account.findFirst({ where: { id: b.fromId, tenantId: s.tenantId, userId: s.sub } });
    const to = await prisma.account.findFirst({ where: { id: b.toId, tenantId: s.tenantId, userId: s.sub } });
    if (!from || !to) throw new Error("Account not found");
    const bal = Number(from.deposit) - Number(from.withdrawal) + Number(from.credit) + Number(from.bonus) + Number(from.pnl);
    if (amount > bal) throw new Error("Insufficient balance");
    const amt = new Prisma.Decimal(amount);
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: from.id }, data: { withdrawal: { increment: amt } } });
      await tx.account.update({ where: { id: to.id }, data: { deposit: { increment: amt } } });
      await tx.financialHistory.create({ data: { accountId: from.id, type: "TRANSFER_OUT" as any, amount: amt, description: "Transfer to " + to.login, mode: "MANUAL", createdBy: s.email } });
      await tx.financialHistory.create({ data: { accountId: to.id, type: "TRANSFER_IN" as any, amount: amt, description: "Transfer from " + from.login, mode: "MANUAL", createdBy: s.email } });
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Transfer failed" }, { status: 400 });
  }
}