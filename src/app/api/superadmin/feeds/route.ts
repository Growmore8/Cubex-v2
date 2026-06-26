import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { reloadFeeds } from "@/lib/realtime";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const rec = await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null);
  const v: any = (rec && rec.value) || {};
  const runtimePrimary = (global as any).__PRIMARY || v.manualPrimary || (v.tdKey ? "TD" : (v.finnhubKey ? "FH" : "TD"));
  return NextResponse.json({
    ok: true,
    feeds: {
      tdKey:        v.tdKey      || "",
      finnhubKey:   v.finnhubKey || "",
      massiveKey:   v.massiveKey || "",
      cryptoFeed:   v.cryptoFeed || "BN",
      forexFeed:    v.forexFeed  || "TD",
      commFeed:     v.commFeed   || "KR",
      idxFeed:      v.idxFeed    || "TD",
      manualPrimary: v.manualPrimary || null,
      currentPrimary: runtimePrimary,
    },
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const existing: any = (await prisma.setting.findUnique({ where: { key: "feeds" } }).catch(() => null))?.value || {};
    const value: any = {
      tdKey:      String(b.tdKey      ?? existing.tdKey      ?? "").trim(),
      finnhubKey: String(b.finnhubKey ?? existing.finnhubKey ?? "").trim(),
      massiveKey: String(b.massiveKey ?? existing.massiveKey ?? "").trim(),
      cryptoFeed: ["BN","KR","TD","FH"].includes(b.cryptoFeed) ? b.cryptoFeed : (existing.cryptoFeed || "BN"),
      forexFeed:  ["KR","TD","MV","FH"].includes(b.forexFeed)  ? b.forexFeed  : (existing.forexFeed  || "TD"),
      commFeed:   ["KR","TD"].includes(b.commFeed)   ? b.commFeed : (existing.commFeed || "KR"),
      idxFeed:    ["TD","FH"].includes(b.idxFeed)    ? b.idxFeed  : (existing.idxFeed  || "TD"),
      manualPrimary: ["TD","FH","MV","BN","KR"].includes(b.manualPrimary) ? b.manualPrimary : (existing.manualPrimary || null),
    };
    await prisma.setting.upsert({ where: { key: "feeds" }, create: { key: "feeds", value }, update: { value } });
    reloadFeeds();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
