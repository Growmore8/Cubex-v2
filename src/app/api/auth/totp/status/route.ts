import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: s.sub }, select: { totpEnabled: true } });
  return NextResponse.json({ ok: true, totpEnabled: user?.totpEnabled ?? false });
}
