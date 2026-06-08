import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { assertManagerAvailable } from "@/services/tenant.service";
import { createStaffAccount } from "@/services/account.service";

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
  await assertManagerAvailable(prisma, tenantId);
  const existing = await prisma.user.findFirst({ where: { tenantId, email: input.email.toLowerCase(), role: "MANAGER" } });
  if (existing) throw new Error("Email already in use by another manager");
  const passwordHash = await hashPassword(input.password);
  const manager = await prisma.user.create({
    data: {
      tenantId, email: input.email.toLowerCase(), name: input.name, passwordHash,
      role: "MANAGER", perms: input.perms || {},
    },
    select: { id: true, name: true, email: true, status: true, perms: true },
  });
  // Managers get their own trading account too (they trade like a client).
  await createStaffAccount(tenantId, manager.id, input.name).catch(() => {});
  return manager;
}

export async function updateManager(tenantId: string, id: string, data: any) {
  const m = await prisma.user.findFirst({ where: { tenantId, id, role: "MANAGER" } });
  if (!m) throw new Error("Manager not found");
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.status !== undefined) patch.status = data.status;
  if (data.perms !== undefined) patch.perms = data.perms;
  if (data.email) {
    const emailLower = String(data.email).toLowerCase();
    const clash = await prisma.user.findFirst({ where: { tenantId, email: emailLower, role: "MANAGER", NOT: { id } } });
    if (clash) throw new Error("Email already in use by another manager");
    patch.email = emailLower;
  }
  if (data.password) {
    if (String(data.password).length < 6) throw new Error("Password must be at least 6 characters");
    patch.passwordHash = await hashPassword(String(data.password));
  }
  return prisma.user.update({ where: { id }, data: patch, select: { id: true, name: true, email: true, status: true, perms: true } });
}

export async function deleteManager(tenantId: string, id: string) {
  const m = await prisma.user.findFirst({ where: { tenantId, id, role: "MANAGER" } });
  if (!m) throw new Error("Manager not found");
  await prisma.user.delete({ where: { id } });
  return { ok: true };
}
