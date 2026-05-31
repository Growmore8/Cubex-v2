import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { pinHash: true } });
  return NextResponse.json({ ok: true, hasPin: !!(u && u.pinHash) });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const pin = String(b.pin || "");
    if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4-6 digits");
    const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { pinHash: true } });
    if (u && u.pinHash) {
      const cur = String(b.current || "");
      if (!(await verifyPassword(cur, u.pinHash))) throw new Error("Current PIN is incorrect");
    }
    const pinHash = await hashPassword(pin);
    await prisma.user.update({ where: { id: s.sub }, data: { pinHash } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}