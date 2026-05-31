import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const pin = String(b.pin || "");
    const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { pinHash: true } });
    if (!u || !u.pinHash) return NextResponse.json({ ok: true, verified: true });
    const okv = await verifyPassword(pin, u.pinHash);
    return NextResponse.json({ ok: okv, verified: okv, error: okv ? undefined : "Incorrect PIN" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}