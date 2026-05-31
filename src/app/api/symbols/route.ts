import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listEnabled } from "@/services/globalSymbol.service";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { return NextResponse.json({ ok: true, symbols: await listEnabled() }); }
  catch { return NextResponse.json({ ok: true, symbols: [] }); }
}
