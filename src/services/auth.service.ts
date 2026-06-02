import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { resolveTenant } from "@/lib/tenant";
import type { SessionPayload } from "@/types";
import type { Role } from "@/config/roles";

export async function authenticate(host: string | null, email: string, password: string): Promise<SessionPayload> {
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
  if (user.status !== "ACTIVE") throw new Error("Account is " + user.status.toLowerCase());
  if (tenant && tenant.status !== "ACTIVE") throw new Error("This workspace is not active");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid email or password");

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { sub: user.id, role: user.role as Role, tenantId: user.tenantId, email: user.email, name: user.name };
}

export async function registerClient(host: string | null, name: string, email: string, password: string): Promise<SessionPayload> {
  const tenant = await resolveTenant(host);
  if (!tenant) throw new Error("Registration is only available on a brand site");

  const exists = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
  if (exists) throw new Error("Email already registered");

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, name, passwordHash, role: "CLIENT" },
  });

  return { sub: user.id, role: "CLIENT", tenantId: tenant.id, email: user.email, name: user.name };
}