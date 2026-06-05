import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { PACKAGES } from "@/config/packages";

const SETTING_KEY = "platform.packages";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  const overrides = (setting?.value as any) || {};

  // Merge defaults with any saved overrides
  const packages = Object.fromEntries(
    Object.entries(PACKAGES).map(([key, def]) => [
      key,
      { ...def, ...(overrides[key] || {}) },
    ])
  );

  // Count tenants per plan
  const subs = await prisma.subscription.groupBy({ by: ["plan"], _count: { _all: true } });
  const planCounts: Record<string, number> = {};
  subs.forEach((s) => { planCounts[s.plan] = s._count._all; });

  return NextResponse.json({ ok: true, packages, planCounts });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    // b.packages = { STARTER: { price, name, description, features[] }, ... }
    if (!b.packages) throw new Error("packages required");
    await prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: b.packages },
      update: { value: b.packages },
    });
    // Reflect any seat-count change onto every tenant currently on that plan, so the
    // limit + displayed seats update across all tenants immediately.
    for (const [plan, def] of Object.entries(b.packages as Record<string, any>)) {
      const seats = Number(def?.seats);
      if (Number.isFinite(seats) && seats > 0) {
        await prisma.subscription.updateMany({ where: { plan: plan as any }, data: { seats } });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
