import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import Redis from "ioredis";

// POST /api/superadmin/fix-digits
// Scans all globalSymbols, reads their current price from Redis, and corrects
// any digits value that would give a pip larger than 0.1% of the price.
// Targets cheap crypto tokens (e.g. STRKUSD at $0.01 with digits=2 → pip=$0.10).
export async function POST() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const globals = await prisma.globalSymbol.findMany({
    select: { symbol: true, digits: true, category: true },
  });

  let rc: Redis | null = null;
  try {
    rc = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  } catch {}

  const symList = globals.map((g) => g.symbol);
  let rawPrices: (string | null)[] = symList.map(() => null);
  if (rc) {
    try {
      rawPrices = await rc.mget(symList.map((s) => "price:" + s));
    } catch {}
    rc.disconnect();
  }

  const updates: { symbol: string; oldDigits: number; newDigits: number; price: number }[] = [];

  for (let i = 0; i < globals.length; i++) {
    const g = globals[i];
    const raw = rawPrices[i];
    if (raw == null) continue;
    const price = parseFloat(raw);
    if (!isFinite(price) || price <= 0 || price >= 1) continue;

    const configDigits = g.digits ?? 5;
    // Ensure pip (10^-(d-1)) ≤ 0.1% of price
    const minDigits = Math.ceil(1 - Math.log10(price * 0.001));
    const needed = Math.min(Math.max(configDigits, minDigits), 8);
    if (needed > configDigits) {
      updates.push({ symbol: g.symbol, oldDigits: configDigits, newDigits: needed, price });
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, changes: [] });
  }

  // Apply all updates in parallel
  await Promise.all(
    updates.map((u) =>
      prisma.globalSymbol.updateMany({
        where: { symbol: u.symbol },
        data: { digits: u.newDigits },
      })
    )
  );

  // Also update tenantSymbol rows that still have the old (too-small) digits
  await Promise.all(
    updates.map((u) =>
      prisma.symbol.updateMany({
        where: { symbol: u.symbol, digits: { lte: u.oldDigits } },
        data: { digits: u.newDigits },
      })
    )
  );

  return NextResponse.json({ ok: true, updated: updates.length, changes: updates });
}
