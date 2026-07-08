import { NextResponse } from "next/server";
import { verifySync } from "otplib";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const { code } = await req.json();
    if (!code) throw new Error("Verification code required");

    const user = await prisma.user.findUnique({ where: { id: s.sub }, select: { totpSecret: true, totpEnabled: true } });
    if (!user) throw new Error("User not found");
    if (user.totpEnabled) throw new Error("2FA is already enabled");
    if (!user.totpSecret) throw new Error("Run setup first — no secret found");

    const result = verifySync({ token: String(code).replace(/\s/g, ""), secret: user.totpSecret });
    if (!result.valid) throw new Error("Invalid code. Check your authenticator app and try again.");

    await prisma.user.update({ where: { id: s.sub }, data: { totpEnabled: true } });
    await audit(s.tenantId, "auth.2fa.enable", "Two-factor authentication enabled", s.email);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
