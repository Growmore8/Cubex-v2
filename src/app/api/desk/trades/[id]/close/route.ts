import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { forceClose } from "@/services/desk.service";
import { assertCan } from "@/lib/perms";
import { notify } from "@/services/notification.service";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "closeTrades");
    const { pnl, userId, tenantId } = await forceClose(s, params.id);
    if (userId) await notify(tenantId, userId, "Position closed by desk", "P&L " + pnl.toFixed(2));
    return NextResponse.json({ ok: true, pnl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Close failed" }, { status: 400 });
  }
}