import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { closeOrder } from "@/services/trade.service";
import { emitRefresh } from "@/lib/realtime";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const closeLots = body.lots ? Number(body.lots) : undefined; // optional partial close
    const result = await closeOrder(s.tenantId!, s.sub, id, closeLots);
    emitRefresh();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Close failed" }, { status: 400 });
  }
}