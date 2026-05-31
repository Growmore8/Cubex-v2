import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, user: null });
  return NextResponse.json({
    ok: true,
    user: { id: s.sub, name: s.name, email: s.email, role: s.role, tenantId: s.tenantId },
  });
}
