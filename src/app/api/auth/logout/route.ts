import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST() {
  try {
    const s = await getSession();
    if (s) audit(s.tenantId, "auth.logout", `${s.role} "${s.name}" logged out`, s.email, s.role as any);
  } catch {}
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
