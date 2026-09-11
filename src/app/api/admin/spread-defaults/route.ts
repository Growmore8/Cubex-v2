import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { getSaDefaultSpreadPips } from "@/lib/spread";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false }, { status: 403 });
  const [forex, crypto, commodities, indices, stocks] = await Promise.all([
    getSaDefaultSpreadPips("forex"),
    getSaDefaultSpreadPips("crypto"),
    getSaDefaultSpreadPips("commodities"),
    getSaDefaultSpreadPips("indices"),
    getSaDefaultSpreadPips("stocks"),
  ]);
  return NextResponse.json({ ok: true, defaults: { forex, crypto, commodities, indices, stocks } });
}
