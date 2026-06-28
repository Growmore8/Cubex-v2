import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { fetchForexNews } from "@/lib/rss-news";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const items = await fetchForexNews();
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 500 });
  }
}
