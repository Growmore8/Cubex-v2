import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveTenant } from "@/lib/tenant";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

const PK_CHALLENGE_COOKIE = "cubex_pk_chal";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  return { rpID: host.split(":")[0], origin: (req.headers.get("x-forwarded-proto") || "http") + "://" + host };
}

// Pre-auth: generate WebAuthn authentication options for passwordless sign-in.
// If an email is supplied we scope to that user's credentials; otherwise we use a
// usernameless (discoverable-credential) flow so the device offers any passkey.
export async function POST(req: Request) {
  try {
    const { rpID } = rpInfo(req);
    const body = await req.json().catch(() => ({}));
    const email = body.email ? String(body.email).toLowerCase() : "";
    let allowCredentials: { id: string }[] | undefined;
    if (email) {
      const tenant = await resolveTenant(req.headers.get("host"));
      const user = await prisma.user.findFirst({ where: { email, ...(tenant ? { tenantId: tenant.id } : {}), role: "CLIENT" }, select: { id: true } });
      if (user) {
        const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id }, select: { credentialId: true } });
        if (creds.length) allowCredentials = creds.map((c) => ({ id: c.credentialId }));
      }
    }
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", ...(allowCredentials ? { allowCredentials } : {}) });
    const res = NextResponse.json({ ok: true, options });
    // Short-lived httpOnly challenge cookie (no session to attach it to yet).
    res.cookies.set(PK_CHALLENGE_COOKIE, options.challenge, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
