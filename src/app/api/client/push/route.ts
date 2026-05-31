import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "" });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const endpoint = String(b.endpoint || "");
    const p256dh = String((b.keys && b.keys.p256dh) || "");
    const auth = String((b.keys && b.keys.auth) || "");
    if (!endpoint || !p256dh || !auth) throw new Error("Invalid subscription");
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: s.sub, p256dh, auth },
      create: { userId: s.sub, endpoint, p256dh, auth },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}