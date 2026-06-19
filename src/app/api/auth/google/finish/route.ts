import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyHandoff, sameHost, originFor } from "@/lib/google";
import { googleSignIn } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

// Runs ON the tenant domain: exchanges the one-time handoff token (signed by the
// central Google callback) for a session cookie set on this domain.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const here = (await headers()).get("host") || url.host;
  const fail = (reason: string) => NextResponse.redirect(new URL("/login?reason=" + reason, originFor(here)));
  const token = url.searchParams.get("token") || "";
  const h = await verifyHandoff(token);
  if (!h) return fail("google-failed");
  // The token is bound to a specific host — only that domain may consume it.
  if (!sameHost(here, h.host)) return fail("google-failed");
  try {
    const session = await googleSignIn(h.host, h.email, h.name, h.type);
    const jwt = await signSession(session);
    const res = NextResponse.redirect(new URL(ROLE_HOME[session.role] || "/", originFor(here)));
    res.cookies.set(SESSION_COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
    return res;
  } catch (e: any) {
    console.error("[google] finish failed:", e?.message);
    return NextResponse.redirect(new URL("/login?reason=" + encodeURIComponent(e?.message || "google-failed"), originFor(here)));
  }
}
