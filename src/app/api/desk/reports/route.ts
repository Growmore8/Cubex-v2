import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { reports } from "@/services/desk.service";
import { assertCan } from "@/lib/perms";
export async function GET() {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "exportPdf");
    const data = await reports(s);
    return NextResponse.json({ ok: true, reports: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Not allowed" }, { status: 403 });
  }
}