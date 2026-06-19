import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { exchangeAndProfile, redirectUriFor, verifyState, originFor, sameHost, signHandoff } from "@/lib/google";
import { googleSignIn } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

// Single central callback for all tenants. Google verifies the user here; we then
// either set the session directly (if we're already on the tenant's domain) or
// hand a short-lived token to the tenant domain's /finish to set the cookie there.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  const here = (await headers()).get("host") || url.host;
  const fail = (reason: string) => NextResponse.redirect(new URL("/login?reason=" + reason, originFor(here)));

  if (url.searchParams.get("error")) return fail("google-cancelled");
  if (!code) return fail("google-failed");
  const state = await verifyState(stateRaw);
  if (!state) return fail("google-failed");

  try {
    const profile = await exchangeAndProfile(code, redirectUriFor(state.host));
    if (!profile || !profile.email) return fail("google-failed");
    if (!profile.verified) return fail("google-unverified");

    // If the user started on THIS same domain, finish here directly.
    if (sameHost(here, state.host)) {
      const session = await googleSignIn(state.host, profile.email, profile.name, state.type);
      const token = await signSession(session);
      const res = NextResponse.redirect(new URL(ROLE_HOME[session.role] || "/", originFor(here)));
      res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
      return res;
    }

    // Otherwise hand off to the tenant domain to set its own-domain cookie.
    const handoff = await signHandoff({ host: state.host, email: profile.email, name: profile.name, type: state.type });
    return NextResponse.redirect(`${originFor(state.host)}/api/auth/google/finish?token=${encodeURIComponent(handoff)}`);
  } catch (e: any) {
    console.error("[google] callback failed:", e?.message);
    return NextResponse.redirect(new URL("/login?reason=" + encodeURIComponent(e?.message || "google-failed"), originFor(here)));
  }
}
