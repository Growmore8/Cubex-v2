import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listEnabled } from "@/services/globalSymbol.service";
import { getDisabledSetFor } from "@/services/symbolPerms.service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const all = await listEnabled();
    const hidden = await getDisabledSetFor(s);
    let symbols = hidden.size ? all.filter((x: any) => !hidden.has(x.symbol)) : all;

    // Filter NSE/BSE India stocks for tenants that don't have the indiaStocks feature enabled
    if (s.tenantId && s.role !== "SUPERADMIN") {
      const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { features: true } });
      const indiaEnabled = !!(tenant?.features as any)?.indiaStocks;
      if (!indiaEnabled) {
        symbols = symbols.filter((x: any) => !x.feed || !/^(NSE|BSE):/.test(x.feed));
      }
    }

    return NextResponse.json({ ok: true, symbols });
  } catch {
    return NextResponse.json({ ok: true, symbols: [] });
  }
}
