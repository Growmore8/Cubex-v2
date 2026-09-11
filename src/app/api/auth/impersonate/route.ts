import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Not used for cross-domain impersonation, kept for the exit route import.
export const IMP_RETURN_COOKIE = "cubex_imp_return";

// Build the correct public base URL — behind nginx the internal req.url is
// localhost:3000, so we read x-forwarded-host / x-forwarded-proto instead.
function publicBase(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

// GET /api/auth/impersonate?token=<uuid>
// Opened in a new tab on the TENANT'S OWN DOMAIN (custom domain or subdomain).
// Different domain = separate cookie jar, so the superadmin session is untouched.
// No audit log, no login notification, no kick-out of the real tenant admin.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = publicBase(req);
  if (!token) return NextResponse.redirect(`${base}/login?error=invalid_token`);

  // Redeem one-time token — deleted immediately (single use)
  const raw = await redis.get(`imp:${token}`);
  if (!raw) return NextResponse.redirect(`${base}/login?error=token_expired`);
  await redis.del(`imp:${token}`);

  let data: { userId: string; email: string; name: string; role: string; tenantId: string };
  try { data = JSON.parse(raw); } catch {
    return NextResponse.redirect(`${base}/login?error=invalid_token`);
  }

  // Create session — no sid so single-device enforcement is bypassed
  const jwt = await signSession({
    sub: data.userId,
    role: data.role as any,
    tenantId: data.tenantId,
    email: data.email,
    name: data.name,
    impersonated: true,
  });

  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
