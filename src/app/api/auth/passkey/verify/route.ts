import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { sessionForUser } from "@/services/auth.service";
import { signSession, SESSION_COOKIE, signDeviceToken, DEVICE_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";
import { audit } from "@/lib/audit";

const PK_CHALLENGE_COOKIE = "cubex_pk_chal";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  return { rpID: host.split(":")[0], origin: (req.headers.get("x-forwarded-proto") || "http") + "://" + host };
}

// Pre-auth: verify a passkey assertion and, on success, issue a full session.
export async function POST(req: Request) {
  try {
    const { rpID, origin } = rpInfo(req);
    const jar = await cookies();
    const challenge = jar.get(PK_CHALLENGE_COOKIE)?.value;
    if (!challenge) throw new Error("Sign-in expired — please try again");
    const body = await req.json();
    // The assertion id maps to a stored credential, which maps to its owner.
    const cred = await prisma.webAuthnCredential.findFirst({ where: { credentialId: body.id } });
    if (!cred) throw new Error("Passkey not recognized");
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: cred.credentialId,
        credentialPublicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: cred.transports ? (cred.transports.split(",") as any) : undefined,
      },
    });
    if (!verification.verified) throw new Error("Verification failed");
    await prisma.webAuthnCredential.update({ where: { id: cred.id }, data: { counter: verification.authenticationInfo.newCounter } });

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
    const session = await sessionForUser(cred.userId, ip, h.get("user-agent") || undefined);
    audit(session.tenantId, "auth.login", `CLIENT "${session.name}" signed in with passkey` + (ip ? ` (${ip})` : ""), session.email, session.role as any);

    const token = await signSession(session, "30d");
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[session.role] });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
    res.cookies.set(DEVICE_COOKIE, await signDeviceToken(session.sub), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    res.cookies.set(PK_CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Sign-in failed" }, { status: 400 });
  }
}
