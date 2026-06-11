import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { reloadFeeds } from "@/lib/realtime";

// Market-data feed keys + primary/secondary, managed by the platform owner.
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const rec = await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null);
  const v: any = (rec && rec.value) || {};
  return NextResponse.json({ ok: true, feeds: { tdKey: v.tdKey || "", finnhubKey: v.finnhubKey || "", primary: v.primary === "FH" ? "FH" : "TD" } });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const value: any = {
      tdKey: String(b.tdKey || "").trim(),
      finnhubKey: String(b.finnhubKey || "").trim(),
      primary: b.primary === "FH" ? "FH" : "TD",
    };
    await prisma.setting.upsert({ where: { key: "feeds" }, create: { key: "feeds", value }, update: { value } });
    reloadFeeds(); // hot-reload the price engine — no restart needed
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
