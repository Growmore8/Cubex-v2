import { NextResponse } from "next/server";
import { exchangeAndProfile, redirectUriFor, verifyState } from "@/lib/google";
import { googleSignIn } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

// Google redirects back here with ?code & ?state. We verify, fetch the profile,
// sign in / sign up the user, set the session cookie, and send them to their home.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  const fail = (reason: string) => NextResponse.redirect(new URL("/login?reason=" + reason, req.url));

  if (url.searchParams.get("error")) return fail("google-cancelled");
  if (!code) return fail("google-failed");
  const state = await verifyState(stateRaw);
  if (!state) return fail("google-failed");

  try {
    const profile = await exchangeAndProfile(code, redirectUriFor(state.host));
    if (!profile || !profile.email) return fail("google-failed");
    if (!profile.verified) return fail("google-unverified");

    const session = await googleSignIn(state.host, profile.email, profile.name, state.type);
    const token = await signSession(session);
    const res = NextResponse.redirect(new URL(ROLE_HOME[session.role] || "/", req.url));
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
    return res;
  } catch (e: any) {
    console.error("[google] callback failed:", e?.message);
    return NextResponse.redirect(new URL("/login?reason=" + encodeURIComponent(e?.message || "google-failed"), req.url));
  }
}
