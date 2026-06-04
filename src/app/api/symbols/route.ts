import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listEnabled } from "@/services/globalSymbol.service";
import { getDisabledSetFor } from "@/services/symbolPerms.service";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const all = await listEnabled();
    const hidden = await getDisabledSetFor(s);
    const symbols = hidden.size ? all.filter((x: any) => !hidden.has(x.symbol)) : all;
    return NextResponse.json({ ok: true, symbols });
  } catch {
    return NextResponse.json({ ok: true, symbols: [] });
  }
}
