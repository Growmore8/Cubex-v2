import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export async function notify(tenantId: string, userId: string, title: string, body?: string, type?: string) {
  const n = await prisma.notification.create({ data: { tenantId, userId, title, body, type: type || "NOTICE" } }).catch(() => null);
  sendPushToUser(userId, { title, body, url: "/client" }).catch(() => {});
  return n;
}

export async function notifyTenantAdmins(tenantId: string, title: string, body?: string) {
  const admins = await prisma.user.findMany({ where: { tenantId, role: "ADMIN" }, select: { id: true } });
  if (!admins.length) return null;
  const r = await prisma.notification.createMany({ data: admins.map((a) => ({ tenantId, userId: a.id, title, body })) });
  await Promise.all(admins.map((a) => sendPushToUser(a.id, { title, body, url: "/client" }))).catch(() => {});
  return r;
}

export async function notifyTenantClients(tenantId: string, title: string, body?: string) {
  const users = await prisma.user.findMany({ where: { tenantId, role: "CLIENT" }, select: { id: true } });
  if (!users.length) return null;
  const r = await prisma.notification.createMany({ data: users.map((u) => ({ tenantId, userId: u.id, title, body })) });
  await Promise.all(users.map((u) => sendPushToUser(u.id, { title, body, url: "/client" }))).catch(() => {});
  return r;
}

// Route an event to the right staff: all tenant admins + (optionally) the
// specific manager who owns the client. `type` drives the client-side sound.
export async function notifyStaff(
  tenantId: string,
  opts: { title: string; body?: string; type?: string },
  managerId?: string | null,
) {
  const or: any[] = [{ role: "ADMIN" }];
  if (managerId) or.push({ id: managerId, role: "MANAGER" });
  const recipients = await prisma.user.findMany({ where: { tenantId, OR: or }, select: { id: true } });
  if (!recipients.length) return null;
  await prisma.notification.createMany({
    data: recipients.map((u) => ({ tenantId, userId: u.id, title: opts.title, body: opts.body || null, type: opts.type || "NOTICE" })),
  }).catch(() => {});
  await Promise.all(recipients.map((u) => sendPushToUser(u.id, { title: opts.title, body: opts.body }))).catch(() => {});
  return recipients.length;
}

export function listNotifications(userId: string) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 });
}

export function markRead(userId: string, id?: string) {
  if (id) return prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
  return prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
