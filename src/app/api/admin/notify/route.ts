import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/perms";
import { sendPushToUser } from "@/lib/push";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const recent = await prisma.notification.findMany({ where: { tenantId: s.tenantId! }, orderBy: { createdAt: "desc" }, distinct: ["title"], take: 15, select: { title: true, body: true, image: true, createdAt: true } });
  return NextResponse.json({ ok: true, recent });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "sendNotifications");
    const b = await req.json();
    const title = (b.title || "").trim();
    if (!title) throw new Error("Title required");
    const body = b.body || null;
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
      const us = await prisma.user.findMany({ where: { tenantId: s.tenantId!, role: "CLIENT" as any }, select: { id: true } });
      userIds = us.map((u) => u.id);
    }
    if (userIds.length === 0) throw new Error("No recipients for this target");
    await prisma.notification.createMany({ data: userIds.map((uid) => ({ tenantId: s.tenantId!, userId: uid, title, body, image })) });
    await Promise.all(userIds.map((uid) => sendPushToUser(uid, { title, body, url: "/client" }))).catch(() => {});
    await audit(s.tenantId!, "notify", title + " -> " + target + " (" + userIds.length + ")", s.email);
    return NextResponse.json({ ok: true, count: userIds.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}