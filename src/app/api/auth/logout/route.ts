import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { notifyStaff, notifySuperAdmins } from "@/services/notification.service";
import { emitRefresh } from "@/lib/realtime";

export async function POST() {
  try {
    const s = await getSession();
    if (s) {
      audit(s.tenantId, "auth.logout", `${s.role} "${s.name}" logged out`, s.email, s.role as any);
      // Flip presence offline at once + notify in realtime, routed by role:
      //  CLIENT  -> admins + owning manager + superadmins
      //  MANAGER -> admins + superadmins
      //  ADMIN   -> superadmins only
      if (s.tenantId && s.role !== "SUPERADMIN") {
        try {
          await prisma.user.update({ where: { id: s.sub }, data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) } }).catch(() => {});
          if (s.role === "CLIENT") {
            const acc = await prisma.account.findFirst({ where: { tenantId: s.tenantId, userId: s.sub }, select: { login: true, managerId: true } });
            notifyStaff(s.tenantId, { type: "LOGIN", title: "Client logged out", body: `${s.name} (${acc?.login || ""}) signed out` }, acc?.managerId).catch(() => {});
          } else if (s.role === "MANAGER") {
            notifyStaff(s.tenantId, { type: "LOGIN", title: "Manager logged out", body: `${s.name} signed out` }).catch(() => {});
          } else if (s.role === "ADMIN") {
            notifySuperAdmins(s.tenantId, { type: "LOGIN", title: "Admin logged out", body: `${s.name} signed out` }).catch(() => {});
          }
          emitRefresh({});
        } catch {}
      }
    }
  } catch {}
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
