import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listNotifications, markRead } from "@/services/notification.service";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, items: [] }, { status: 200 });
  const items = await listNotifications(s.sub);
  return NextResponse.json({ ok: true, items, unread: items.filter((i) => !i.read).length });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  await markRead(s.sub, body.id);
  return NextResponse.json({ ok: true });
}
