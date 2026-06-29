import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const rec = await prisma.setting.findUnique({ where: { key: "sa_config" } }).catch(() => null);
  const cfg = (rec?.value as any) || {};
  return NextResponse.json({ ok: true, publicApiUrl: cfg.publicApiUrl || "" });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const data: any = {};
    if (b.name) data.name = b.name;
    if (b.email) data.email = b.email;
    if (b.password) { if (b.password.length < 6) throw new Error("Password too short"); data.passwordHash = await hashPassword(b.password); }
    if (Object.keys(data).length > 0) await prisma.user.update({ where: { id: s.sub }, data });

    // Save non-profile settings (publicApiUrl etc.) to sa_config setting row
    if (b.publicApiUrl !== undefined) {
      const existing: any = (await prisma.setting.findUnique({ where: { key: "sa_config" } }).catch(() => null))?.value || {};
      await prisma.setting.upsert({
        where: { key: "sa_config" },
        create: { key: "sa_config", value: { ...existing, publicApiUrl: String(b.publicApiUrl).trim() } },
        update: { value: { ...existing, publicApiUrl: String(b.publicApiUrl).trim() } },
      });
    }

    if (Object.keys(data).length === 0 && b.publicApiUrl === undefined) throw new Error("Nothing to update");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}