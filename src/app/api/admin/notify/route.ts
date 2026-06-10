import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { sendPushToUser } from "@/lib/push";
import { emitRefresh } from "@/lib/realtime";

export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // Only ADMIN/MANAGER-SENT broadcasts (senderId set) — not system events.
  const recent = await prisma.notification.findMany({
    where: { tenantId: s.tenantId!, senderId: { not: null }, senderRole: { in: ["ADMIN", "MANAGER"] as any } },
    orderBy: { createdAt: "desc" }, distinct: ["title"], take: 15,
    select: { title: true, body: true, image: true, createdAt: true, senderRole: true, type: true },
  });
  return NextResponse.json({ ok: true, recent });
}

export async function POST(req: Request) {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "sendNotifications");
    const b = await req.json();
    const title = (b.title || "").trim();
    if (!title) throw new Error("Title required");
    // Sign manually-sent notifications with the tenant's support footer.
    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { name: true, brandName: true } });
    const brand = (tenant?.brandName || tenant?.name || "").trim();
    const footer = `— ${brand ? brand + " " : ""}Support Team`;
    const body = ((b.body || "").trim() ? (b.body.trim() + "\n\n") : "") + footer;
    const image = b.image || null;
    const target = b.target || "all_clients";
    let userIds: string[] = [];
    if (target === "client" && b.accountId) {
      const acc = await prisma.account.findFirst({ where: { id: b.accountId, tenantId: s.tenantId! }, select: { userId: true } });
      if (acc && acc.userId) userIds = [acc.userId];
    } else if (target === "managers") {
      const us = await prisma.user.findMany({ where: { tenantId: s.tenantId!, role: "MANAGER" as any }, select: { id: true } });
      userIds = us.map((u) => u.id);
    } else {
      // All clients — a manager only reaches THEIR own clients.
      const accWhere: any = { tenantId: s.tenantId! };
      if (s.role === "MANAGER") accWhere.managerId = s.sub;
      const accs = await prisma.account.findMany({ where: accWhere, select: { userId: true } });
      userIds = Array.from(new Set(accs.map((a) => a.userId).filter(Boolean) as string[]));
      if (s.role !== "MANAGER") {
        const us = await prisma.user.findMany({ where: { tenantId: s.tenantId!, role: "CLIENT" as any }, select: { id: true } });
        userIds = Array.from(new Set([...userIds, ...us.map((u) => u.id)]));
      }
    }
    if (userIds.length === 0) throw new Error("No recipients for this target");
    await prisma.notification.createMany({ data: userIds.map((uid) => ({ tenantId: s.tenantId!, userId: uid, title, body, image, type: b.type || "NOTICE", senderId: s.sub, senderRole: s.role as any })) });
    await Promise.all(userIds.map((uid) => sendPushToUser(uid, { title, body, url: "/client" }))).catch(() => {}); // reaches closed apps
    try { emitRefresh({ kind: "notification", users: userIds }); } catch {} // open apps update instantly
    await audit(s.tenantId!, "notify", title + " -> " + target + " (" + userIds.length + ")", s.email);
    return NextResponse.json({ ok: true, count: userIds.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
