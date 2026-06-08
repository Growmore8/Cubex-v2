import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // Clients only see account activity (funds, KYC), news/maintenance and staff
  // messages — NOT automated trade events (TP/SL hit, stop out, pending filled).
  const raw = await prisma.notification.findMany({ where: { userId: s.sub, NOT: { type: "TRADE" } }, orderBy: { createdAt: "desc" }, take: 60 });
  // Deduplicate: same title+body sent to same user (e.g. from multiple accounts) → keep newest only
  const seen = new Set<string>();
  const items = raw.filter((n) => {
    const key = (n.title || "") + "||" + (n.body || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
  const unread = items.filter((n) => !n.read).length;
  return NextResponse.json({ ok: true, items, unread });
}

export async function POST() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  await prisma.notification.updateMany({ where: { userId: s.sub, read: false }, data: { read: true } });
  return NextResponse.json({ ok: true });
}