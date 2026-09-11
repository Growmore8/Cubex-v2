import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { Redis } from "ioredis";
import { cookies } from "next/headers";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Cookie that holds the superadmin's original session so it can be restored on exit.
export const IMP_RETURN_COOKIE = "cubex_imp_return";

// GET /api/auth/impersonate?token=<uuid>
// Called from the superadmin's own browser (same domain).
// Saves the current superadmin session as a backup cookie, then swaps cubex_session
// to the impersonated tenant admin session and redirects to the dashboard.
// No audit log, no login notification, no kick-out of the real tenant admin.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));

  // Redeem one-time token — deleted immediately so it cannot be replayed
  const raw = await redis.get(`imp:${token}`);
  if (!raw) return NextResponse.redirect(new URL("/login?error=token_expired", req.url));
  await redis.del(`imp:${token}`);

  let data: { userId: string; email: string; name: string; role: string; tenantId: string };
  try { data = JSON.parse(raw); } catch {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }

  // Save the current session (superadmin) so we can restore it on exit
  const currentSession = (await cookies()).get(SESSION_COOKIE)?.value;

  // Build impersonated session — no sid so single-device check is bypassed
  const jwt = await signSession({
    sub: data.userId,
    role: data.role as any,
    tenantId: data.tenantId,
    email: data.email,
    name: data.name,
    impersonated: true,
  });

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };

  const res = NextResponse.redirect(new URL("/", req.url));
  // Set the impersonated session as the active session
  res.cookies.set(SESSION_COOKIE, jwt, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  // Back up the superadmin session so "Exit" can restore it
  if (currentSession) {
    res.cookies.set(IMP_RETURN_COOKIE, currentSession, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  }
  return res;
}
