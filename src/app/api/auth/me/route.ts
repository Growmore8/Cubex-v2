import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { effectivePerms } from "@/lib/perms";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, user: null });
  const perms = await effectivePerms(s);
  return NextResponse.json({
    ok: true,
    user: { id: s.sub, name: s.name, email: s.email, role: s.role, tenantId: s.tenantId },
    perms,
  });
}
