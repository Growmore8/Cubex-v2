import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const rec = await prisma.setting.findUnique({ where: { key: `sms:${s.tenantId}` } }).catch(() => null);
  const v = (rec?.value as any) || {};
  return NextResponse.json({ ok: true, enabled: !!v.enabled, phones: Array.isArray(v.phones) ? v.phones : [] });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const phones = (Array.isArray(b.phones) ? b.phones : [])
      .map((p: any) => String(p).trim())
      .filter((p: string) => p.length > 0);
    const enabled = !!b.enabled;
    await prisma.setting.upsert({
      where: { key: `sms:${s.tenantId}` },
      create: { key: `sms:${s.tenantId}`, value: { enabled, phones } },
      update: { value: { enabled, phones } },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
