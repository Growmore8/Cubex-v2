import { NextResponse } from "next/server";
import { requireClient, getClientSession } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/services/account.service";
import { emitRefresh } from "@/lib/realtime";

export async function GET() {
  const { session: s, suspended } = await getClientSession();
  if (suspended) return NextResponse.json({ ok: false, code: "TENANT_SUSPENDED" }, { status: 403 });
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const accounts = await prisma.account.findMany({
    where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, login: true, type: true, currency: true, leverage: true, deposit: true, withdrawal: true, credit: true, bonus: true, pnl: true, locked: true, deactivated: true, expiresAt: true },
  });
  return NextResponse.json({ ok: true, accounts: accounts.map((a) => ({ ...a, deposit: Number(a.deposit), withdrawal: Number(a.withdrawal), credit: Number(a.credit), bonus: Number(a.bonus), pnl: Number(a.pnl), expiresAt: a.expiresAt ?? null })) });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const type = b.type === "DEMO" ? "DEMO" : "LIVE";
    const user = await prisma.user.findUnique({ where: { id: s.sub } });
    if (!user) throw new Error("User not found");
    // Block only if the user account itself is suspended/locked by staff
    if (user.status !== "ACTIVE") throw new Error("Your account is restricted. Please contact support.");
    // Demo tenants: clients cannot open additional accounts — only the admin can create them.
    const tenantSub = await prisma.subscription.findUnique({ where: { tenantId: s.tenantId! }, select: { status: true } });
    if (tenantSub?.status === "TRIALING") throw new Error("Account creation is disabled on demo platforms. Please contact your broker.");
    if (type === "DEMO") {
      // a client may hold only one demo account
      const demoCount = await prisma.account.count({ where: { userId: s.sub, type: "DEMO" } });
      if (demoCount >= 1) throw new Error("You can only have one demo account");
    }
    if (type === "LIVE") {
      // First live account is auto-created. EVERY additional live account must be
      // approved by the tenant admin (limits data growth / package seats).
      const liveCount = await prisma.account.count({ where: { userId: s.sub, type: "LIVE" } });
      if (liveCount >= 1) {
        const existing = await prisma.accountRequest.findFirst({ where: { userId: s.sub, status: "PENDING" }, select: { id: true } });
        if (existing) throw new Error("You already have a live-account request awaiting approval.");
        await prisma.accountRequest.create({
          data: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE", leverage: Number(b.leverage) || 100, currency: b.currency || "USD" },
        });
        // Surface to tenant staff (admins + this client's manager, if any).
        const mine = await prisma.account.findFirst({ where: { userId: s.sub, type: "LIVE" }, select: { managerId: true } });
        const staff = await prisma.user.findMany({ where: { tenantId: s.tenantId!, OR: [{ role: "ADMIN" as any }, ...(mine?.managerId ? [{ id: mine.managerId }] : [])] }, select: { id: true } });
        if (staff.length) {
          await prisma.notification.createMany({ data: staff.map((u) => ({ tenantId: s.tenantId!, userId: u.id, title: "New account request", body: `${user.name} requested an additional live account. Review it in Requests.`, type: "NOTICE" })) });
          try { emitRefresh({ kind: "notification", users: staff.map((u) => u.id) }); } catch {}
        }
        return NextResponse.json({ ok: true, pending: true });
      }
    }
    // Note: a client opens their first live account WITHOUT prior KYC. The live
    // account is then locked to Profile + KYC (per-client gate) until verified —
    // so we must NOT block creation on KYC here, or it's a chicken-and-egg lock.
    const acc = await createClient(s.tenantId!, { email: user.email, name: user.name, type, leverage: Number(b.leverage) || 100, currency: b.currency || "USD" }, "client-self");
    return NextResponse.json({ ok: true, account: { id: acc.id, login: acc.login, type: acc.type } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}