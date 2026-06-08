import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notify, notifyStaff } from "@/services/notification.service";
import { assertSeatAvailable } from "@/services/tenant.service";

export function listClients(tenantId: string, managerId?: string | null) {
  return prisma.account.findMany({
    where: managerId ? { tenantId, managerId } : { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true, status: true, lastLoginIp: true, lastLoginAt: true, lastSeenAt: true, lastDevice: true } },
      manager: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
    },
  });
}

export async function nextLogin(tx: any, tenantId: string, type: string) {
  const name = type === "DEMO" ? "demo" : "live";
  const start = type === "DEMO" ? 100100 : 900000;
  let c = await tx.counter.findUnique({ where: { tenantId_name: { tenantId, name } } });
  if (!c) c = await tx.counter.create({ data: { tenantId, name, nextVal: BigInt(start) } });
  // Loop until we land on a login that doesn't already exist (handles gaps from
  // deletions or accounts created outside this counter).
  for (let i = 0; i < 200; i++) {
    const val = c.nextVal;
    c = await tx.counter.update({ where: { id: c.id }, data: { nextVal: val + BigInt(1) }, });
    const candidate = type === "DEMO" ? "DEMO" + val.toString() : val.toString();
    const taken = await tx.account.findFirst({ where: { tenantId, login: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Could not allocate a unique account ID — please try again.");
}

export async function createClient(tenantId: string, input: any, actor = "admin") {
  const type = input.type || "LIVE";
  const acc = await prisma.$transaction(async (tx) => {
    await assertSeatAvailable(tx, tenantId, type); // enforce the plan's account limit (live only)
    const email = input.email.toLowerCase();
    // One identity per person: an email used by a staff member can't also be a client.
    const staffClash = await tx.user.findFirst({ where: { tenantId, email, role: { in: ["ADMIN", "MANAGER"] } } });
    if (staffClash) throw new Error("This email is already in use by a staff member. Use a different email.");
    // Scope to CLIENT so a manager/admin sharing the email isn't reused as the owner.
    let user = await tx.user.findFirst({ where: { tenantId, email, role: "CLIENT" } });
    if (!user) {
      const passwordHash = await hashPassword(input.password);
      user = await tx.user.create({ data: { tenantId, email, name: input.name, passwordHash, role: "CLIENT" } });
    }
    if (type === "DEMO") {
      const demoCount = await tx.account.count({ where: { userId: user.id, type: "DEMO" } });
      if (demoCount >= 1) throw new Error("Client already has a demo account");
    }
    const login = await nextLogin(tx, tenantId, type);
    // Link every additional account to the client's primary (oldest) account, so
    // all linked accounts inherit the primary's KYC. The first account is the primary.
    const primary = await tx.account.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const parentId = input.parentId || primary?.id || null;
    return tx.account.create({
      data: {
        tenantId, login, userId: user.id, name: input.name, type, parentId,
        leverage: input.leverage || 100, currency: input.currency || "USD",
        managerId: input.managerId || null, phone: input.phone || null, country: input.country || null,
        isPool: !!input.isPool,
        deposit: type === "DEMO" ? new Prisma.Decimal(input.deposit ?? 10000) : new Prisma.Decimal(input.deposit ?? 0),
      },
    });
  });
  await audit(tenantId, "client.create", acc.login + " " + input.email, actor);
  return acc;
}

// Give a staff member (MANAGER / ADMIN) their own LIVE trading account so they can
// trade like a client. Idempotent — returns the existing account if they have one.
// No seat check: staff accounts are not client onboarding.
export async function createStaffAccount(tenantId: string, userId: string, name: string) {
  const existing = await prisma.account.findFirst({ where: { userId } });
  if (existing) return existing;
  const login = await nextLogin(prisma, tenantId, "LIVE");
  return prisma.account.create({
    // managerId = self so a MANAGER sees their own account within their scoped
    // client list (admins see all accounts regardless).
    data: { tenantId, login, userId, name, type: "LIVE", leverage: 100, currency: "USD", managerId: userId },
  });
}

export function getClient(tenantId: string, id: string) {
  return prisma.account.findFirst({
    where: { tenantId, id },
    include: {
      user: { select: { email: true, status: true } },
      manager: { select: { id: true, name: true } },
      financials: { orderBy: { appliedAt: "desc" }, take: 50 },
    },
  });
}

export async function updateClient(tenantId: string, id: string, data: any, actor = "admin") {
  const acc = await prisma.account.findFirst({ where: { tenantId, id } });
  if (!acc) throw new Error("Account not found");
  const patch: any = {};
  if (data.leverage !== undefined) patch.leverage = Number(data.leverage);
  if (data.locked !== undefined) patch.locked = !!data.locked;
  if (data.doNotLiquidate !== undefined) patch.doNotLiquidate = !!data.doNotLiquidate;
  if (data.mcLevel !== undefined) patch.mcLevel = new Prisma.Decimal(data.mcLevel);
  if (data.currency !== undefined) patch.currency = data.currency;
  if (data.managerId !== undefined) patch.managerId = data.managerId || null; if (data.phone !== undefined) patch.phone = data.phone || null; if (data.country !== undefined) patch.country = data.country || null; if (data.isPool !== undefined) patch.isPool = !!data.isPool; if (data.deactivated !== undefined) patch.deactivated = !!data.deactivated;
  if (data.name !== undefined) patch.name = data.name; if (data.email !== undefined) patch.email = data.email || null;
  const updated = await prisma.account.update({ where: { id }, data: patch });
  // One identity per person: shared profile fields propagate to ALL the client's
  // accounts (live + demo), so editing in one place reflects everywhere.
  const shared: any = {};
  for (const k of ["name", "email", "phone", "country"]) if (patch[k] !== undefined) shared[k] = patch[k];
  if (acc.userId && Object.keys(shared).length) {
    await prisma.account.updateMany({ where: { tenantId, userId: acc.userId, NOT: { id } }, data: shared }).catch(() => {});
  }
  await audit(tenantId, "client.update", acc.login + " " + JSON.stringify(patch), actor);
  return updated;
}

export async function adjustBalance(tenantId: string, id: string, type: string, amount: number, description: string, by: string, appliedAt?: Date | null) {
  const acc = await prisma.account.findFirst({ where: { tenantId, id } });
  if (!acc) throw new Error("Account not found");
  const amt = new Prisma.Decimal(amount);
  let data: any = {};
  if (type === "DEPOSIT") data = { deposit: { increment: amt } };
  else if (type === "WITHDRAWAL") data = { withdrawal: { increment: amt } };
  else if (type === "CREDIT_IN") data = { credit: { increment: amt } };
  else if (type === "CREDIT_OUT") data = { credit: { decrement: amt } };
  else if (type === "BONUS") data = { bonus: { increment: amt } };
  else if (type === "INSURANCE") data = { insurance: { increment: amt } };
  else throw new Error("Invalid type");
  const backdated = appliedAt && !isNaN(appliedAt.getTime());
  const res = await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id }, data });
    // appliedAt lets staff back-date a manual entry (Manual Date & Time mode)
    const fh: any = { accountId: id, type: type as any, amount: amt, description, mode: backdated ? "MANUAL" : "REALTIME", createdBy: by };
    if (backdated) fh.appliedAt = appliedAt;
    await tx.financialHistory.create({ data: fh });
    return tx.account.findUnique({ where: { id } });
  });
  await audit(tenantId, "balance." + type, acc.login + " " + amount, by);
  // Notify the client (funds sound) + their manager
  try {
    const verb: Record<string, string> = { DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal", CREDIT_IN: "Credit added", CREDIT_OUT: "Credit removed", BONUS: "Bonus", INSURANCE: "Insurance" };
    const label = (verb[type] || type) + " " + amount + (description ? " — " + description : "");
    if (acc.userId) await notify(tenantId, acc.userId, verb[type] || type, label, "FUNDS");
    await notifyStaff(tenantId, { type: "FUNDS", title: (verb[type] || type), body: acc.login + " " + amount }, acc.managerId);
  } catch {}
  return res;
}

export async function manualPnl(tenantId: string, id: string, amount: number, note: string, by: string) {
  const acc = await prisma.account.findFirst({ where: { tenantId, id } });
  if (!acc) throw new Error("Account not found");
  await prisma.account.update({ where: { id }, data: { pnl: { increment: new Prisma.Decimal(amount) } } });
  await audit(tenantId, "client.manualPnl", acc.login + " " + amount + " " + (note || ""), by);
  return { ok: true };
}

export async function resetPassword(tenantId: string, id: string, newPass: string, by: string) {
  const acc = await prisma.account.findFirst({ where: { tenantId, id } });
  if (!acc || !acc.userId) throw new Error("Account not found");
  const passwordHash = await hashPassword(newPass);
  await prisma.user.update({ where: { id: acc.userId }, data: { passwordHash } });
  await audit(tenantId, "client.resetPassword", acc.login, by);
  return { ok: true };
}

export async function deleteClient(tenantId: string, id: string, by = "admin") {
  const acc = await prisma.account.findFirst({ where: { tenantId, id } });
  if (!acc) throw new Error("Account not found");
  await prisma.account.delete({ where: { id } });
  if (acc.userId) await prisma.user.delete({ where: { id: acc.userId } }).catch(() => {});
  await audit(tenantId, "client.delete", acc.login, by);
  return { ok: true };
}
