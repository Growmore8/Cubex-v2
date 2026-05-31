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
    if (!(amount > 0)) throw new Error("Enter a positive amount");
    if (amount > 1000000) throw new Error("Amount too large");
    const acc = await prisma.account.findFirst({ where: { id: String(b.accountId), userId: s.sub, tenantId: s.tenantId! } });
    if (!acc) throw new Error("Account not found");
    if (acc.type !== "DEMO") throw new Error("Top-up is only for demo accounts");
    const amt = new Prisma.Decimal(amount);
    await prisma.$transaction([
      prisma.account.update({ where: { id: acc.id }, data: { deposit: { increment: amt } } }),
      prisma.financialHistory.create({ data: { accountId: acc.id, type: "DEPOSIT", amount: amt, description: "Demo top-up", mode: "MANUAL", createdBy: "demo-topup" } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}