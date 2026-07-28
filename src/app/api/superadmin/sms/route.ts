import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, brandName: true },
  });

  const keys = tenants.map((t) => `sms:${t.id}`);
  const settings = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value as any]));

  const result = tenants.map((t) => {
    const v = byKey[`sms:${t.id}`] || {};
    return {
      id: t.id,
      name: t.brandName || t.name,
      enabled: !!v.enabled,
      phones: Array.isArray(v.phones) ? v.phones : [],
    };
  });

  return NextResponse.json({ ok: true, tenants: result });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const b = await req.json();
    const { tenantId, enabled, phones } = b;
    if (!tenantId) return NextResponse.json({ ok: false, error: "tenantId required" }, { status: 400 });

    const cleanPhones = (Array.isArray(phones) ? phones : [])
      .map((p: any) => String(p).trim())
      .filter((p: string) => p.length > 0);

    const key = `sms:${tenantId}`;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: { enabled: !!enabled, phones: cleanPhones } },
      update: { value: { enabled: !!enabled, phones: cleanPhones } },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
