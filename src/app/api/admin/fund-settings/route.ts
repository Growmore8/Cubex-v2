import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { getFundsPnlOnly, setFundsPnlOnly } from "@/services/fundSettings.service";
import { audit } from "@/lib/audit";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, pnlOnly: await getFundsPnlOnly(s.tenantId!) });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    await setFundsPnlOnly(s.tenantId!, !!b.pnlOnly);
    await audit(s.tenantId!, "settings.fundsPnlOnly", b.pnlOnly ? "ON" : "OFF", s.email);
    return NextResponse.json({ ok: true, pnlOnly: !!b.pnlOnly });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
