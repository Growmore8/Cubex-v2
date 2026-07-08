import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const signals = await prisma.signal.findMany({
    where: { tenantId: s.tenantId!, active: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, signals });
}
