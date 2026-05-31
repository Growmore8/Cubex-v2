import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const items = await prisma.notification.findMany({ where: { userId: s.sub }, orderBy: { createdAt: "desc" }, take: 30 });
  const unread = items.filter((n) => !n.read).length;
  return NextResponse.json({ ok: true, items, unread });
}

export async function POST() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  await prisma.notification.updateMany({ where: { userId: s.sub, read: false }, data: { read: true } });
  return NextResponse.json({ ok: true });
}