import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  return { rpID: host.split(":")[0], origin: (req.headers.get("x-forwarded-proto") || "http") + "://" + host };
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { rpID, origin } = rpInfo(req);
    const user = await prisma.user.findUnique({ where: { id: s.sub } });
    if (!user || !user.webauthnChallenge) throw new Error("No authentication in progress");
    const body = await req.json();
    const cred = await prisma.webAuthnCredential.findFirst({ where: { userId: s.sub, credentialId: body.id } });
    if (!cred) throw new Error("Passkey not recognized");
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: user.webauthnChallenge,
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
    await prisma.user.update({ where: { id: s.sub }, data: { webauthnChallenge: null } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}