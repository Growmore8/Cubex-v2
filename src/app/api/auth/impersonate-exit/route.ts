import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";
import { IMP_RETURN_COOKIE } from "@/app/api/auth/impersonate/route";
import { cookies } from "next/headers";

function publicBase(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const original = (await cookies()).get(IMP_RETURN_COOKIE)?.value;
  const base = publicBase(req);
  const res = NextResponse.redirect(`${base}/superadmin/tenants`);

  if (original) {
    res.cookies.set(SESSION_COOKIE, original, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  res.cookies.set(IMP_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
