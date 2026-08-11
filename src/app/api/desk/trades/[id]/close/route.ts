import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { forceClose } from "@/services/desk.service";
import { assertCan } from "@/lib/perms";
import { emitRefresh } from "@/lib/realtime";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "closeTrades");
    const b = await req.json().catch(() => ({}));
    const opts = { price: b.price != null ? Number(b.price) : undefined, closedAt: b.closedAt ? new Date(b.closedAt) : undefined };
    const { pnl } = await forceClose(s, id, opts);
    emitRefresh(); // push to client + all admin panels instantly
    return NextResponse.json({ ok: true, pnl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Close failed" }, { status: 400 });
  }
}