import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

// Session health for the client-side SessionGuard:
//  - ok:false reason:other-device  -> superseded by another login (staff single-device)
//  - ok:false reason:deactivated   -> user SUSPENDED / all accounts deactivated -> force logout
//  - ok:true  readOnly:true        -> user LOCKED or tenant SUSPENDED -> show read-only banner
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, reason: "expired" });
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ ok: false, reason: "expired" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { status: true, activeSession: true, role: true, tenantId: true },
    });
    if (!user) return NextResponse.json({ ok: false, reason: "deactivated" });

    // Deactivated user -> logout
    if (user.status === "SUSPENDED") return NextResponse.json({ ok: false, reason: "deactivated" });

    const isStaff = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPERADMIN";
    // Single-device enforcement for staff
    if (isStaff && session.sid && user.activeSession && user.activeSession !== session.sid) {
      return NextResponse.json({ ok: false, reason: "other-device" });
    }

    // Tenant suspended -> the brokerage is suspended: force an instant logout for
    // every admin / manager / client of that tenant.
    if (user.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } });
      if (t && t.status === "SUSPENDED") return NextResponse.json({ ok: false, reason: "suspended" });
    }
    const tenantSuspended = false;

    // Client: check subscription expiry + account expiry
    if (user.role === "CLIENT" && user.tenantId) {
      // Trial subscription ended → kick out immediately
      const sub = await prisma.subscription.findUnique({ where: { tenantId: user.tenantId }, select: { status: true, endsAt: true } });
      if (sub?.status === "TRIALING" && sub.endsAt && new Date(sub.endsAt) < new Date()) {
        return NextResponse.json({ ok: false, reason: "suspended" });
      }
      // Count accounts that are not deactivated AND not past their expiry date
      const now = new Date();
      const activeAccounts = await prisma.account.count({
        where: { userId: session.sub, deactivated: false, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      });
      // No active non-expired accounts (covers cron-deleted AND all-deactivated AND all-expired)
      if (activeAccounts === 0) return NextResponse.json({ ok: false, reason: "deactivated" });
      const anyLocked = await prisma.account.count({ where: { userId: session.sub, locked: true } });
      return NextResponse.json({ ok: true, readOnly: anyLocked > 0 });
    }

    const readOnly = user.status === "LOCKED" || tenantSuspended;
    return NextResponse.json({ ok: true, readOnly });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
