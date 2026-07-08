import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { runSwapRollover } from "@/services/swap.service";

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const result = await runSwapRollover(b.tenantId || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
