import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// Peek the next account ID (Live ID) that would be assigned — WITHOUT consuming
// the counter. Used to preview the Live ID on the create-client form (pool).
export async function GET(req: Request) {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const type = new URL(req.url).searchParams.get("type") === "DEMO" ? "DEMO" : "LIVE";
  const name = type === "DEMO" ? "demo" : "live";
  const start = type === "DEMO" ? 100100 : 900000;
  const counter = await prisma.counter.findUnique({ where: { tenantId_name: { tenantId: s.tenantId!, name } } });
  let val = counter ? Number(counter.nextVal) : start;
  // Skip any logins already taken (mirrors nextLogin), but never increment the DB.
  for (let i = 0; i < 500; i++) {
    const candidate = type === "DEMO" ? "DEMO" + val : String(val);
    const exists = await prisma.account.findFirst({ where: { tenantId: s.tenantId!, login: candidate }, select: { id: true } });
    if (!exists) return NextResponse.json({ ok: true, login: candidate });
    val++;
  }
  return NextResponse.json({ ok: true, login: String(val) });
}
