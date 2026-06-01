import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { listFinnhub } from "@/lib/finnhub";

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const cat = new URL(req.url).searchParams.get("category") || "forex";
    const items = await listFinnhub(cat);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 500 });
  }
}