import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";
import { IMP_RETURN_COOKIE } from "@/app/api/auth/impersonate/route";
import { cookies } from "next/headers";

// GET /api/auth/impersonate-exit
// Restores the superadmin's original session from the backup cookie and
// redirects back to the tenants management page.
export async function GET(req: NextRequest) {
  const original = (await cookies()).get(IMP_RETURN_COOKIE)?.value;
  const res = NextResponse.redirect(new URL("/superadmin/tenants", req.url));

  if (original) {
    res.cookies.set(SESSION_COOKIE, original, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  // Always clear the backup cookie
  res.cookies.set(IMP_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
