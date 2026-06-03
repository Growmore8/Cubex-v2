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
    const t: any = await prisma.tenant.findUnique({ where: { id: id } });
    if (!t) throw new Error("Outsource not found");
    if (b.action === "perms") await prisma.tenant.update({ where: { id: t.id }, data: { permissions: b.perms || {} } });
    else if (b.action === "open") await prisma.tenant.update({ where: { id: t.id }, data: { status: "ACTIVE" as any } });
    else if (b.action === "lock") await prisma.tenant.update({ where: { id: t.id }, data: { status: "SUSPENDED" as any } });
    else if (b.action === "resetPassword") {
      const admin = await prisma.user.findFirst({ where: { tenantId: t.id, role: "ADMIN" as any } });
      if (!admin) throw new Error("This outsource has no admin user");
      if (!b.password || b.password.length < 6) throw new Error("Password too short");
      await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(b.password) } });
    } else if (b.action === "delete") {
      await prisma.tenant.delete({ where: { id: t.id } });
    } else throw new Error("Unknown action");
    await audit(t.id, "sa.outsource." + b.action, t.name, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}