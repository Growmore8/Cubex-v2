import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  return { rpID: host.split(":")[0], origin: (req.headers.get("x-forwarded-proto") || "http") + "://" + host };
}

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { rpID } = rpInfo(req);
  const creds = await prisma.webAuthnCredential.findMany({ where: { userId: s.sub } });
  if (!creds.length) return NextResponse.json({ ok: false, error: "No passkeys registered" }, { status: 400 });
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    userVerification: "preferred",
  });
  await prisma.user.update({ where: { id: s.sub }, data: { webauthnChallenge: options.challenge } });
  return NextResponse.json({ ok: true, options });
}