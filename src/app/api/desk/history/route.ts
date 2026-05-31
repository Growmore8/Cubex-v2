import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { listHistory } from "@/services/desk.service";

export async function GET() {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const history = await listHistory(s);
  return NextResponse.json({ ok: true, history });
}
