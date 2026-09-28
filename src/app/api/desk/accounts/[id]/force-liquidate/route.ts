import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";
import { forceClose } from "@/services/desk.service";
import { adjustBalance } from "@/services/account.service";
import { audit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "closeTrades");

    const account = await prisma.account.findFirst({
      where: { id, tenantId: s.tenantId! },
      include: { trades: true },
    });
    if (!account) throw new Error("Account not found");

    // Step 1: Force-close every open trade at current market price
    let closedCount = 0;
    const errors: string[] = [];
    for (const trade of (account as any).trades) {
      try {
        await forceClose(s, trade.id);
        closedCount++;
      } catch (e: any) {
        errors.push(`#${trade.ticket}: ${e.message || "failed"}`);
      }
    }

    // Step 2: Re-fetch after closes so P&L is settled
    const updated = await prisma.account.findUnique({ where: { id } });
    if (!updated) throw new Error("Account not found after close");

    // Step 3: Trading balance = deposit + pnl − withdrawal
    const balance = Number(updated.deposit) + Number(updated.pnl) - Number(updated.withdrawal);
    const rounded = Math.round(balance * 100) / 100;

    // Step 4: Bring balance to zero
    if (rounded > 0.005) {
      await adjustBalance(s.tenantId!, id, "WITHDRAWAL", rounded, "Force Liquidation / Wipe", s.email);
    } else if (rounded < -0.005) {
      await adjustBalance(s.tenantId!, id, "DEPOSIT", Math.abs(rounded), "Force Liquidation / Wipe", s.email);
    }

    await audit(
      s.tenantId!,
      "account.forceLiquidate",
      `${(account as any).login} — ${closedCount} trade(s) closed, balance zeroed (was $${rounded.toFixed(2)})`,
      s.email,
    );

    return NextResponse.json({ ok: true, closedCount, balanceBefore: rounded, errors });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
