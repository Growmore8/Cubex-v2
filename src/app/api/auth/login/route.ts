import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { authenticate } from "@/services/auth.service";
import { signSession, SESSION_COOKIE, signDeviceToken, DEVICE_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";
import { audit } from "@/lib/audit";
import { notifyStaff, notifySuperAdmins } from "@/services/notification.service";
import { prisma } from "@/lib/prisma";
import { deviceFromUA } from "@/lib/presence";
import { rateLimit } from "@/lib/rateLimit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1), remember: z.boolean().optional() });

export async function POST(req: Request) {
  try {
    const { email, password, remember } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
    if (!rateLimit(`login:${ip || "unknown"}`, 10, 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
    }
    const session = await authenticate(host, email, password, ip, h.get("user-agent") || undefined);
    audit(session.tenantId, "auth.login", `${session.role} "${session.name}" logged in` + (ip ? ` (${ip})` : ""), session.email, session.role as any);
    // Realtime login notifications + sound:
    //  CLIENT  -> tenant admins + owning manager + superadmins
    //  MANAGER -> tenant admins + superadmins
    //  ADMIN   -> superadmins only (platform-owner visibility)
    if (session.tenantId) {
      try {
        const dev = deviceFromUA(h.get("user-agent"));
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
    const token = await signSession(session, remember ? "30d" : undefined);
    const res = NextResponse.json({
      ok: true,
      redirect: ROLE_HOME[session.role],
      user: { name: session.name, role: session.role },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/",
      // "Remember me" -> persistent 30-day cookie (survives browser/tab close, auto-login).
      // Otherwise a SESSION cookie (no maxAge) the browser clears on close. The pagehide
      // beacon additionally covers tab-close logout best-effort for non-remembered sessions.
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    });
    // Mark this device as trusted so the user can later sign in with their PIN
    // (device-bound passwordless). CLIENT only; staff always use password.
    if (session.role === "CLIENT") {
      res.cookies.set(DEVICE_COOKIE, await signDeviceToken(session.sub), {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: 60 * 60 * 24 * 180,
      });
    }
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Login failed" }, { status: 401 });
  }
}
