import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { reloadCatalog } from "@/lib/realtime";
import { seedDefaultSpreads } from "@/services/spreadDefaults.service";

async function autoSeedAllTenants() {
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      await seedDefaultSpreads(t.id, false).catch(() => {});
    }
  } catch {}
}

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const symbols = await prisma.globalSymbol.findMany({
    orderBy: [{ category: "asc" }, { symbol: "asc" }],
  });
  return NextResponse.json({ ok: true, symbols });
}

// Toggle enabled/disabled — single symbol OR bulk array
// Single: { symbol: "AAPL", enabled: false }
// Bulk:   { symbols: ["AAPL","MSFT"], enabled: false }
export async function PATCH(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  if (Array.isArray(body.symbols)) {
    await prisma.globalSymbol.updateMany({ where: { symbol: { in: body.symbols } }, data: { enabled: body.enabled } });
  } else {
    if (!body.symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
    await prisma.globalSymbol.update({ where: { symbol: body.symbol }, data: { enabled: body.enabled } });
  }
  reloadCatalog();
  // Auto-seed newly enabled symbols to all tenants in background
  if (body.enabled !== false) autoSeedAllTenants();
  return NextResponse.json({ ok: true });
}
