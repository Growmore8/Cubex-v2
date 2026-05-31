import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { manualPnl } from "@/services/account.service";

const schema = z.object({ amount: z.number(), note: z.string().optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { amount, note } = schema.parse(await req.json());
    await manualPnl(s.tenantId!, params.id, amount, note || "", s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}