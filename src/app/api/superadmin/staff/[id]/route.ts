import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const u: any = await prisma.user.findUnique({ where: { id: id } });
    if (!u) throw new Error("User not found");
    if (b.action === "lock") await prisma.user.update({ where: { id: u.id }, data: { status: "LOCKED" as any } });
    else if (b.action === "unlock") await prisma.user.update({ where: { id: u.id }, data: { status: "ACTIVE" as any } });
    else if (b.action === "resetPassword") { if (!b.password || b.password.length < 6) throw new Error("Password too short"); await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(b.password) } }); }
    else if (b.action === "perms") await prisma.user.update({ where: { id: u.id }, data: { perms: b.perms || {} } });
    else if (b.action === "delete") await prisma.user.delete({ where: { id: u.id } });
    else throw new Error("Unknown action");
    await audit(u.tenantId, "sa.staff." + b.action, u.email, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}