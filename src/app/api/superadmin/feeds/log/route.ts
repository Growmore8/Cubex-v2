import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const logs = await prisma.feedFailoverLog.findMany({ orderBy: { ts: "desc" }, take: 50 });
  return NextResponse.json({ ok: true, logs });
}

export async function DELETE() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  await prisma.feedFailoverLog.deleteMany({});
  return NextResponse.json({ ok: true });
}
