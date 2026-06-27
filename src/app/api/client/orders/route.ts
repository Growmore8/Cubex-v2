import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClient } from "@/lib/guard";
import { placeOrder } from "@/services/trade.service";
import { emitRefresh } from "@/lib/realtime";

const schema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  lots: z.number().positive(),
  sl: z.number().optional(),
  tp: z.number().optional(),
  trailingStop: z.number().optional(), // pips; 0 = disabled
  comment: z.string().max(128).optional(),
  accountId: z.string().optional(),
});

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const input = schema.parse(await req.json());
    const trade = await placeOrder(s.tenantId!, s.sub, input);
    emitRefresh();
    return NextResponse.json({ ok: true, trade });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Order failed" }, { status: 400 });
  }
}
