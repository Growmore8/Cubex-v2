import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { googleEnabled, googleAuthUrl, redirectUriFor, signState } from "@/lib/google";

// Kick off Google OAuth. ?mode=login|register & ?type=DEMO|LIVE
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?reason=google-off", req.url));
  const host = (await headers()).get("host") || "";
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "register" ? "register" : "login";
  const type = url.searchParams.get("type") === "LIVE" ? "LIVE" : "DEMO";
  const redirectUri = redirectUriFor(host);
  const state = await signState({ host, mode, type });
  return NextResponse.redirect(googleAuthUrl(redirectUri, state));
}
