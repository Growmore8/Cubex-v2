import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { Redis } from "ioredis";
import { cookies } from "next/headers";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export const IMP_RETURN_COOKIE = "cubex_imp_return";

// Build the correct public base URL — behind nginx the internal req.url is
// localhost:3000, so we read x-forwarded-host / x-forwarded-proto instead.
function publicBase(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin; // direct (non-proxied) fallback
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = publicBase(req);
  if (!token) return NextResponse.redirect(`${base}/login?error=invalid_token`);

  const raw = await redis.get(`imp:${token}`);
  if (!raw) return NextResponse.redirect(`${base}/login?error=token_expired`);
  await redis.del(`imp:${token}`);

  let data: { userId: string; email: string; name: string; role: string; tenantId: string };
  try { data = JSON.parse(raw); } catch {
    return NextResponse.redirect(`${base}/login?error=invalid_token`);
  }

  const currentSession = (await cookies()).get(SESSION_COOKIE)?.value;

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
    maxAge: 60 * 60 * 8,
  };

  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(SESSION_COOKIE, jwt, cookieOpts);
  if (currentSession) {
    res.cookies.set(IMP_RETURN_COOKIE, currentSession, cookieOpts);
  }
  return res;
}
