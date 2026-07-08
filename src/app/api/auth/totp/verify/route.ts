import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { verifySync } from "otplib";
import { prisma } from "@/lib/prisma";
import { verifyTotpPending, TOTP_PENDING_COOKIE, signSession, SESSION_COOKIE, signDeviceToken, DEVICE_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";
import { audit } from "@/lib/audit";
import { notifyStaff, notifySuperAdmins } from "@/services/notification.service";
import { deviceFromUA } from "@/lib/presence";
import { randomBytes } from "crypto";
import type { Role } from "@/config/roles";

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });

    const jar = await cookies();
    const pendingToken = jar.get(TOTP_PENDING_COOKIE)?.value;
    if (!pendingToken) return NextResponse.json({ ok: false, error: "No pending login. Please sign in again." }, { status: 401 });

    const pending = await verifyTotpPending(pendingToken);
    if (!pending) return NextResponse.json({ ok: false, error: "Session expired. Please sign in again." }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: pending.userId },
      select: { id: true, email: true, name: true, role: true, tenantId: true, totpSecret: true, totpEnabled: true, status: true },
    });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      return NextResponse.json({ ok: false, error: "2FA not configured. Please sign in again." }, { status: 401 });
    }
    if (user.status === "SUSPENDED") return NextResponse.json({ ok: false, error: "Your account has been deactivated." }, { status: 403 });

    const result = verifySync({ token: String(code).replace(/\s/g, ""), secret: user.totpSecret });
    if (!result.valid) return NextResponse.json({ ok: false, error: "Invalid code. Try again." }, { status: 401 });

    // 2FA passed — complete the login.
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
    const ua = h.get("user-agent") || undefined;
    const isStaff = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPERADMIN";
    const sid = isStaff ? randomBytes(16).toString("hex") : undefined;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastSeenAt: new Date(),
        ...(ip ? { lastLoginIp: ip } : {}),
        ...(ua ? { lastDevice: deviceFromUA(ua) } : {}),
        ...(isStaff ? { activeSession: sid } : {}),
      },
    });

    const role = user.role as Role;
    const session = { sub: user.id, role, tenantId: user.tenantId, email: user.email, name: user.name, ...(sid ? { sid } : {}) };
    audit(session.tenantId, "auth.login", `${session.role} "${session.name}" logged in (2FA)` + (ip ? ` (${ip})` : ""), session.email, session.role as any);

    if (session.tenantId) {
      try {
        const dev = deviceFromUA(ua);
        const meta = (ip ? ` · IP ${ip}` : "") + (dev ? ` · ${dev}` : "");
        if (session.role === "CLIENT") {
          const acc = await prisma.account.findFirst({ where: { tenantId: session.tenantId, userId: session.sub }, select: { managerId: true, login: true } });
          notifyStaff(session.tenantId, { type: "LOGIN", title: "Client login", body: `${session.name} (${acc?.login || ""}) signed in${meta}` }, acc?.managerId).catch(() => {});
        } else if (session.role === "MANAGER") {
          notifyStaff(session.tenantId, { type: "LOGIN", title: "Manager login", body: `${session.name} signed in${meta}` }).catch(() => {});
        } else if (session.role === "ADMIN") {
          notifySuperAdmins(session.tenantId, { type: "LOGIN", title: "Admin login", body: `${session.name} signed in${meta}` }).catch(() => {});
        }
      } catch {}
    }

    const token = await signSession(session, pending.remember ? "30d" : undefined);
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[role] });

    res.cookies.set(TOTP_PENDING_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/",
      ...(pending.remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    });

    if (session.role === "CLIENT") {
      res.cookies.set(DEVICE_COOKIE, await signDeviceToken(session.sub), {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: 60 * 60 * 24 * 180,
      });
    }

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Verification failed" }, { status: 400 });
  }
}
