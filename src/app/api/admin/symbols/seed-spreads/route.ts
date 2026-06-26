import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { Redis } from "ioredis";
import { seedDefaultSpreads } from "@/services/spreadDefaults.service";

// Manual "Realistic defaults" button — always overwrites all spreads.
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const count = await seedDefaultSpreads(s.tenantId!, true); // overwrite=true → force reset
    try { const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); await pub.publish("cubex:spreads", "1"); pub.disconnect(); } catch (_) {}
    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
