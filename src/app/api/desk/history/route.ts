import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { listHistory } from "@/services/desk.service";

export async function GET(req: Request) {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") || undefined;
  const history = await listHistory(s, accountId);
  return NextResponse.json({ ok: true, history });
}
