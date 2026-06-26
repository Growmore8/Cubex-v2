import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { seedDefaultSpreads } from "@/services/spreadDefaults.service";

// SuperAdmin: seed default spreads for ALL tenants that have no spreads configured yet.
// Safe to run multiple times — overwrite=false means manual spreads are never touched.
export async function POST() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    const results: { tenant: string; seeded: number }[] = [];
    for (const t of tenants) {
      const count = await seedDefaultSpreads(t.id, false); // never overwrite existing manual spreads
      results.push({ tenant: t.name, seeded: count });
    }
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
