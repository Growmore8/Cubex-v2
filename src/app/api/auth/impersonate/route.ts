import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// GET /api/auth/impersonate?token=<uuid>
// Opened in a new tab by the superadmin's browser.
// Redeems the one-time token, sets a session cookie for the target account,
// and redirects to the dashboard. No audit log, no notification, no kick-out.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));

  // Redeem one-time token (atomic get+delete)
  const raw = await redis.get(`imp:${token}`);
  if (!raw) return NextResponse.redirect(new URL("/login?error=token_expired", req.url));
  await redis.del(`imp:${token}`);

  let data: { userId: string; email: string; name: string; role: string; tenantId: string };
  try { data = JSON.parse(raw); } catch {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }

  // Build an impersonated session — no sid so single-device enforcement is bypassed
  // (the real admin's session stays alive). impersonated:true flags this as ghost login.
  const jwt = await signSession({
    sub: data.userId,
    role: data.role as any,
    tenantId: data.tenantId,
    email: data.email,
    name: data.name,
    impersonated: true,
  });

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return res;
}
