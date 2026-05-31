import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const data: any = {};
    if (b.name) data.name = b.name;
    if (b.email) data.email = b.email;
    if (b.password) { if (b.password.length < 6) throw new Error("Password too short"); data.passwordHash = await hashPassword(b.password); }
    if (Object.keys(data).length === 0) throw new Error("Nothing to update");
    await prisma.user.update({ where: { id: s.sub }, data });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}