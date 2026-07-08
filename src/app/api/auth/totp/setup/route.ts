import { NextResponse } from "next/server";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: s.sub }, select: { totpEnabled: true, email: true } });
  if (!user) return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  if (user.totpEnabled) return NextResponse.json({ ok: false, error: "2FA is already enabled" }, { status: 400 });

  const secret = generateSecret();
  await prisma.user.update({ where: { id: s.sub }, data: { totpSecret: secret } });

  const otpauth = generateURI({ issuer: "CubeX", label: user.email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 200, margin: 2 });

  return NextResponse.json({ ok: true, secret, qrDataUrl });
}
