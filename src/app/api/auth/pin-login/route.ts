import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { sessionForUser } from "@/services/auth.service";
import { signSession, SESSION_COOKIE, DEVICE_COOKIE, verifyDeviceToken } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";

// Pre-auth: passwordless PIN sign-in. Secure because it is DEVICE-BOUND — it only
// works on a device that has already completed a full password login (which set the
// httpOnly, signed DEVICE_COOKIE). The PIN alone is never sufficient.
export async function POST(req: Request) {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
    if (!rateLimit(`pinlogin:${ip || "unknown"}`, 8, 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
    }
    const jar = await cookies();
    const deviceTok = jar.get(DEVICE_COOKIE)?.value;
    const uid = deviceTok ? await verifyDeviceToken(deviceTok) : null;
    if (!uid) throw new Error("PIN sign-in isn't set up on this device. Sign in with your password once first.");
    const body = await req.json().catch(() => ({}));
    const pin = String(body.pin || "");
    if (!/^\d{4,6}$/.test(pin)) throw new Error("Enter your 4–6 digit PIN");
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, pinHash: true } });
    if (!user || !user.pinHash) throw new Error("No PIN is set for this account");
    if (!(await verifyPassword(pin, user.pinHash))) throw new Error("Incorrect PIN");

    const session = await sessionForUser(user.id, ip, h.get("user-agent") || undefined);
    audit(session.tenantId, "auth.login", `CLIENT "${session.name}" signed in with PIN` + (ip ? ` (${ip})` : ""), session.email, session.role as any);
    const token = await signSession(session, "30d");
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[session.role] });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Sign-in failed" }, { status: 400 });
  }
}
