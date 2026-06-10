import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/perms";
import { createClient } from "@/services/account.service";
import { sendPushToUser } from "@/lib/push";
import { emitRefresh } from "@/lib/realtime";
import { audit } from "@/lib/audit";

// Approve or reject a client's additional-live-account request.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "createClients"); // approving creates an account
    const { id } = await params;
    const b = await req.json();
    const action = b.action === "approve" ? "approve" : "reject";
    const r = await prisma.accountRequest.findFirst({ where: { id, tenantId: s.tenantId! } });
    if (!r) return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
    if (r.status !== "PENDING") throw new Error("This request has already been reviewed.");
    // Managers may only review their own clients' requests.
    if (s.role === "MANAGER") {
      const owned = await prisma.account.findFirst({ where: { userId: r.userId, managerId: s.sub }, select: { id: true } });
      if (!owned) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const user = await prisma.user.findUnique({ where: { id: r.userId }, select: { email: true, name: true } });
    if (!user) throw new Error("Client not found");

    if (action === "approve") {
      const acc = await createClient(s.tenantId!, { email: user.email, name: user.name, type: "LIVE", leverage: r.leverage, currency: r.currency }, "approve:" + s.email);
      await prisma.accountRequest.update({ where: { id }, data: { status: "APPROVED", reviewedBy: s.email, reviewedAt: new Date() } });
      await prisma.notification.create({ data: { tenantId: s.tenantId!, userId: r.userId, title: "Account request approved", body: `Your new live account ${acc.login} is ready to use.`, type: "NOTICE" } });
      sendPushToUser(r.userId, { title: "Account request approved", body: `Your new live account ${acc.login} is ready.`, url: "/client" }).catch(() => {});
      try { emitRefresh({ kind: "notification", users: [r.userId] }); } catch {}
      await audit(s.tenantId!, "accountRequest.approve", `${user.email} -> ${acc.login}`, s.email);
      return NextResponse.json({ ok: true, login: acc.login });
    }
    await prisma.accountRequest.update({ where: { id }, data: { status: "REJECTED", reviewedBy: s.email, reviewedAt: new Date(), note: (b.note || "").trim() || null } });
    await prisma.notification.create({ data: { tenantId: s.tenantId!, userId: r.userId, title: "Account request declined", body: (b.note || "").trim() || "Your request for an additional live account was not approved. Contact support for details.", type: "NOTICE" } });
    sendPushToUser(r.userId, { title: "Account request declined", body: "Your additional account request was not approved.", url: "/client" }).catch(() => {});
    try { emitRefresh({ kind: "notification", users: [r.userId] }); } catch {}
    await audit(s.tenantId!, "accountRequest.reject", user.email, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
