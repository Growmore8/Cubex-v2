import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const setting = await prisma.setting.findUnique({ where: { key: "platform" } }).catch(() => null);
  const mode = (setting && (setting.value as any) && (setting.value as any).mode) || "OPEN";
  return NextResponse.json({ ok: true, mode });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const mode = b.mode;
    if (["OPEN", "READONLY", "LOCKED"].indexOf(mode) === -1) throw new Error("Invalid mode");
    await prisma.setting.upsert({ where: { key: "platform" }, create: { key: "platform", value: { mode } }, update: { value: { mode } } });
    try { await audit((s.tenantId as any), "platform.mode", mode, s.email); } catch (e) {}
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}