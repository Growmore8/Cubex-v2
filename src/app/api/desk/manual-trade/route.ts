import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff, assertWritable } from "@/lib/guard";
import { manualTrade } from "@/services/desk.service";

const schema = z.object({
  accountId: z.string(), symbol: z.string(), type: z.enum(["BUY", "SELL"]),
  lots: z.number().positive(), sl: z.number().optional(), tp: z.number().optional(),
});

export async function POST(req: Request) {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertWritable(s);
    const input = schema.parse(await req.json());
    const trade = await manualTrade(s, input);
    return NextResponse.json({ ok: true, trade });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
