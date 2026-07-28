import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, assertWritable } from "@/lib/guard";
import { adjustBalance } from "@/services/account.service";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "CREDIT_IN", "CREDIT_OUT", "BONUS", "INSURANCE"]),
  amount: z.number().positive(),
  description: z.string().optional(),
  appliedAt: z.string().optional(),
  // Credit settlement period (optional, only used with CREDIT_IN)
  settleFrom: z.string().optional(),
  settleTo: z.string().optional(),
  // Bonus expiry date (optional, only used with BONUS)
  bonusExpiryAt: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertWritable(s);
    const { type, amount, description, appliedAt, settleFrom, settleTo, bonusExpiryAt } = schema.parse(await req.json());
    const balMap: Record<string, string> = { DEPOSIT: "processDeposits", WITHDRAWAL: "processWithdrawals", CREDIT_IN: "creditBonus", CREDIT_OUT: "creditBonus", BONUS: "creditBonus", INSURANCE: "creditBonus" };
    await assertCan(s, balMap[type] || "adjustBalance");
    const when = appliedAt ? new Date(appliedAt) : null;
    const account = await adjustBalance(s.tenantId!, id, type, amount, description || "", s.email, when);
    // After credit added: optionally update settlement period
    if (type === "CREDIT_IN" && (settleFrom || settleTo)) {
      await prisma.account.update({ where: { id }, data: { ...(settleFrom ? { creditSettleFrom: new Date(settleFrom) } : {}), ...(settleTo ? { creditSettleTo: new Date(settleTo) } : {}) } });
    }
    // After bonus added: optionally update bonus expiry
    if (type === "BONUS" && bonusExpiryAt) {
      await prisma.account.update({ where: { id }, data: { bonusExpiryAt: new Date(bonusExpiryAt) } });
    }
    return NextResponse.json({ ok: true, account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
