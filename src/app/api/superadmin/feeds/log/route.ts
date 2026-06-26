import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "failover"; // failover | errors
  if (type === "errors") {
    const logs = await prisma.feedErrorLog.findMany({ orderBy: { ts: "desc" }, take: 100 });
    return NextResponse.json({ ok: true, logs });
  }
  const logs = await prisma.feedFailoverLog.findMany({ orderBy: { ts: "desc" }, take: 50 });
  return NextResponse.json({ ok: true, logs });
}

export async function DELETE(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "failover";
  if (type === "errors") {
    await prisma.feedErrorLog.deleteMany({});
  } else {
    await prisma.feedFailoverLog.deleteMany({});
  }
  return NextResponse.json({ ok: true });
}
