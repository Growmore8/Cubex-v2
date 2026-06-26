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
  return NextResponse.json({ ok: true, feeds: { tdKey: v.tdKey || "", finnhubKey: v.finnhubKey || "", massiveKey: v.massiveKey || "", primary: v.primary || "TD" } });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const validPrimary = ["TD", "FH", "MV"].includes(b.primary) ? b.primary : "TD";
    const value: any = {
      tdKey: String(b.tdKey || "").trim(),
      finnhubKey: String(b.finnhubKey || "").trim(),
      massiveKey: String(b.massiveKey || "").trim(),
      primary: validPrimary,
    };
    await prisma.setting.upsert({ where: { key: "feeds" }, create: { key: "feeds", value }, update: { value } });
    reloadFeeds(); // hot-reload the price engine — no restart needed
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
