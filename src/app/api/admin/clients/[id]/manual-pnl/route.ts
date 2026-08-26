import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrManager } from "@/lib/guard";
import { manualPnl } from "@/services/account.service";
import { assertCan } from "@/lib/perms";

const schema = z.object({ amount: z.number(), note: z.string().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  await assertCan(s, "editFinancial");
  try {
    const { amount, note } = schema.parse(await req.json());
    await manualPnl(s.tenantId!, id, amount, note || "", s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}