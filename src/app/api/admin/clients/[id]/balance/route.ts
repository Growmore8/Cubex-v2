import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, assertWritable } from "@/lib/guard";
import { adjustBalance } from "@/services/account.service";
import { assertCan } from "@/lib/perms";

const schema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "CREDIT_IN", "CREDIT_OUT", "BONUS", "INSURANCE"]),
  amount: z.number().positive(), description: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertWritable(s);
    const { type, amount, description } = schema.parse(await req.json());
    const balMap: Record<string, string> = { DEPOSIT: "processDeposits", WITHDRAWAL: "processWithdrawals", CREDIT_IN: "creditBonus", CREDIT_OUT: "creditBonus", BONUS: "creditBonus", INSURANCE: "creditBonus" };
    await assertCan(s, balMap[type] || "adjustBalance");
    const account = await adjustBalance(s.tenantId!, id, type, amount, description || "", s.email);
    return NextResponse.json({ ok: true, account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}