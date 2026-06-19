import { SignJWT, jwtVerify } from "jose";

// Google OAuth (sign-in / sign-up). Configured via env:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// The redirect URI is per-host: https://<host>/api/auth/google/callback — add
// each tenant domain's callback URL in the Google Cloud OAuth client.

export function googleEnabled(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export type OAuthState = { host: string; mode: "login" | "register"; type: "DEMO" | "LIVE" };

export async function signState(s: OAuthState): Promise<string> {
  return new SignJWT({ ...s, kind: "goauth" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret());
}
export async function verifyState(token: string): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if ((payload as any).kind !== "goauth") return null;
    return { host: (payload as any).host, mode: (payload as any).mode, type: (payload as any).type };
  } catch { return null; }
}

export function redirectUriFor(host: string): string {
  const h = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const proto = h.startsWith("localhost") || h.startsWith("127.0.0.1") ? "http" : "https";
  return `${proto}://${h}/api/auth/google/callback`;
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Exchange the auth code for tokens, then fetch the verified profile.
export async function exchangeAndProfile(code: string, redirectUri: string): Promise<{ email: string; name: string; verified: boolean } | null> {
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) { console.error("[google] token exchange failed:", await tokRes.text().catch(() => "")); return null; }
  const tok = await tokRes.json();
  const access = tok.access_token;
  if (!access) return null;
  const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access}` } });
  if (!uiRes.ok) { console.error("[google] userinfo failed:", await uiRes.text().catch(() => "")); return null; }
  const ui = await uiRes.json();
  const email = String(ui.email || "").toLowerCase();
  if (!email) return null;
  return { email, name: ui.name || ui.given_name || email.split("@")[0], verified: ui.email_verified !== false };
}
