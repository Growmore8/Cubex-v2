import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// One-time: set the margin-call level to 50 for existing accounts that have it
// off (0). Accounts with a custom level are left untouched. New accounts already
// default to 50. Pass ?all=1 to force every account to 50.
export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const all = new URL(req.url).searchParams.get("all") === "1";
  const r = await prisma.account.updateMany({
    where: all ? {} : { mcLevel: new Prisma.Decimal(0) },
    data: { mcLevel: new Prisma.Decimal(50) },
  });
  return NextResponse.json({ ok: true, updated: r.count, mode: all ? "all" : "only-zero" });
}
