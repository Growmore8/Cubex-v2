import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { generateRegistrationOptions } from "@simplewebauthn/server";

function rpInfo(req: Request) {
  const host = req.headers.get("host") || "localhost:3000";
  const hostname = host.split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return { rpID: hostname, origin: proto + "://" + host };
}

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const user = await prisma.user.findUnique({ where: { id: s.sub } });
  if (!user) return NextResponse.json({ ok: false, error: "No user" }, { status: 404 });
  const { rpID } = rpInfo(req);
  const existing = await prisma.webAuthnCredential.findMany({ where: { userId: s.sub } });
  const options = await generateRegistrationOptions({
    rpName: "CubeX",
    rpID,
    userName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await prisma.user.update({ where: { id: s.sub }, data: { webauthnChallenge: options.challenge } });
  return NextResponse.json({ ok: true, options });
}