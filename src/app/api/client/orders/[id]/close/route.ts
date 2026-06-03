import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { closeOrder } from "@/services/trade.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await closeOrder(s.tenantId!, s.sub, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Close failed" }, { status: 400 });
  }
}