import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// The signed-in client's own additional-account requests + their status.
export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const requests = await prisma.accountRequest.findMany({
    where: { tenantId: s.tenantId!, userId: s.sub },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, leverage: true, currency: true, status: true, note: true, createdAt: true, reviewedAt: true },
  });
  return NextResponse.json({ ok: true, requests });
}
