import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export function listManagers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId, role: "MANAGER" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, email: true, status: true, perms: true, createdAt: true,
      _count: { select: { managedAccounts: true } },
    },
  });
}

export async function createManager(tenantId: string, input: any) {
  const existing = await prisma.user.findFirst({ where: { tenantId, email: input.email.toLowerCase() } });
  if (existing) throw new Error("Email already in use");
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      tenantId, email: input.email.toLowerCase(), name: input.name, passwordHash,
      role: "MANAGER", perms: input.perms || {},
    },
    select: { id: true, name: true, email: true, status: true, perms: true },
  });
}

export async function updateManager(tenantId: string, id: string, data: any) {
  const m = await prisma.user.findFirst({ where: { tenantId, id, role: "MANAGER" } });
  if (!m) throw new Error("Manager not found");
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.status !== undefined) patch.status = data.status;
  if (data.perms !== undefined) patch.perms = data.perms;
  return prisma.user.update({ where: { id }, data: patch, select: { id: true, name: true, email: true, status: true, perms: true } });
}

export async function deleteManager(tenantId: string, id: string) {
  const m = await prisma.user.findFirst({ where: { tenantId, id, role: "MANAGER" } });
  if (!m) throw new Error("Manager not found");
  await prisma.user.delete({ where: { id } });
  return { ok: true };
}
