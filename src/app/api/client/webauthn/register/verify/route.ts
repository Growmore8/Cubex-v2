import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { verifyRegistrationResponse } from "@simplewebauthn/server";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  const hostname = host.split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return { rpID: hostname, origin: proto + "://" + host };
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { rpID, origin } = rpInfo(req);
    const user = await prisma.user.findUnique({ where: { id: s.sub } });
    if (!user || !user.webauthnChallenge) throw new Error("No registration in progress");
    const body = await req.json();
    const verification = await verifyRegistrationResponse({ response: body, expectedChallenge: user.webauthnChallenge, expectedOrigin: origin, expectedRPID: rpID });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Verification failed");
    const info = verification.registrationInfo;
    const pk = Buffer.from(info.credentialPublicKey).toString("base64url");
    await prisma.webAuthnCredential.create({ data: { userId: s.sub, credentialId: info.credentialID, publicKey: pk, counter: info.counter, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp } });
    await prisma.user.update({ where: { id: s.sub }, data: { webauthnChallenge: null } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}