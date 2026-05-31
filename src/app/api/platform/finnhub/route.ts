import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { listFinnhub } from "@/lib/finnhub";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || "forex";
  const q = (searchParams.get("q") || "").toUpperCase();
  try {
    let rows = await listFinnhub(category);
    if (q) rows = rows.filter((r: any) => r.symbol.includes(q) || (r.display || "").toUpperCase().includes(q));
    return NextResponse.json({ ok: true, symbols: rows.slice(0, 100) });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Finnhub error" }, { status: 400 }); }
}
