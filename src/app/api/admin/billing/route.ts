import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: s.tenantId! },
    orderBy: { createdAt: "desc" },
  });
  const sub = await prisma.subscription.findUnique({ where: { tenantId: s.tenantId! } });
  return NextResponse.json({ ok: true, invoices, subscription: sub });
}
