import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const tenantId = sp.get("tenantId") || undefined;
  const records = await prisma.expiredAccount.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { expiredAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ ok: true, records });
}
