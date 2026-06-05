import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { resolveTenant } from "@/lib/tenant";
import { nextLogin } from "@/services/account.service";
import { assertSeatAvailable } from "@/services/tenant.service";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/types";
import type { Role } from "@/config/roles";

export async function authenticate(host: string | null, email: string, password: string, ip?: string): Promise<SessionPayload> {
  const tenant = await resolveTenant(host);
  const tenantId = tenant?.id ?? null;

  const user = tenantId
    ? await prisma.user.findFirst({
        where: { tenantId, email: email.toLowerCase() },
      })
    : await prisma.user.findFirst({
        where: { email: email.toLowerCase() },
        orderBy: { createdAt: "asc" },
      });

  if (!user) throw new Error("Invalid email or password");
  // SUSPENDED = deactivated -> cannot sign in. LOCKED = read-only -> allowed (banner shown).
  if (user.status === "SUSPENDED") throw new Error("Your account has been deactivated. Please contact support.");
  // Tenant SUSPENDED = read-only (allowed). PENDING = not yet activated (blocked).
  if (tenant && tenant.status === "PENDING") throw new Error("This workspace is not active yet");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid email or password");

  // Single-device enforcement for staff roles: issue a fresh session id that
  // supersedes any previous login. CLIENT may use multiple devices.
  const isStaff = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPERADMIN";
  const sid = isStaff ? Math.random().toString(36).slice(2) + Date.now().toString(36) : undefined;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(ip ? { lastLoginIp: ip } : {}),
      ...(isStaff ? { activeSession: sid } : {}),
    },
  });

  return { sub: user.id, role: user.role as Role, tenantId: user.tenantId, email: user.email, name: user.name, ...(sid ? { sid } : {}) };
}

export async function registerClient(
  host: string | null,
  name: string,
  email: string,
  password: string,
  phone?: string,
  country?: string,
  type: "DEMO" | "LIVE" = "LIVE",
  tenantSlug?: string,
): Promise<SessionPayload> {
  let tenant = await resolveTenant(host);
  if (!tenant && tenantSlug) {
    tenant = await prisma.tenant.findFirst({
      where: { OR: [{ slug: tenantSlug }, { subdomain: tenantSlug }] },
    });
  }
  if (!tenant) throw new Error("Registration is only available on a brand site");

  const passwordHash = await hashPassword(password);
  const session = await prisma.$transaction(async (tx) => {
    const lowerEmail = email.toLowerCase();
    const exists = await tx.user.findFirst({ where: { tenantId: tenant!.id, email: lowerEmail } });
    if (exists) throw new Error("Email already registered. Please log in to open more accounts.");
    // One registration = one LIVE (parent) account + one DEMO practice account.
    // Only the live account consumes a plan seat.
    await assertSeatAvailable(tx, tenant!.id, "LIVE");

    const user = await tx.user.create({
      data: { tenantId: tenant!.id, email: lowerEmail, name, passwordHash, role: "CLIENT" },
    });
    const common = {
      tenantId: tenant!.id,
      userId: user.id,
      name,
      leverage: 100,
      currency: "USD" as const,
      phone: phone || null,
      country: country || null,
    };
    // LIVE = the client's primary/parent account. KYC required before full access.
    const liveLogin = await nextLogin(tx, tenant!.id, "LIVE");
    await tx.account.create({
      data: { ...common, login: liveLogin, type: "LIVE", deposit: new Prisma.Decimal(0) },
    });
    // DEMO = instant practice, funded with virtual balance.
    const demoLogin = await nextLogin(tx, tenant!.id, "DEMO");
    await tx.account.create({
      data: { ...common, login: demoLogin, type: "DEMO", deposit: new Prisma.Decimal(10000) },
    });
    return { sub: user.id, role: "CLIENT" as Role, tenantId: tenant!.id, email: lowerEmail, name };
  });
  return session;
}
