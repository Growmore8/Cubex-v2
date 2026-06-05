import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { PACKAGES } from "@/config/packages";

// The account limit for a plan comes from its package definition.
export function seatsForPlan(plan?: string): number {
  return (PACKAGES as any)[plan || "STARTER"]?.seats ?? 5;
}

// Throws if the tenant has reached its plan's account limit.
export async function assertSeatAvailable(client: any, tenantId: string) {
  const sub = await client.subscription.findUnique({ where: { tenantId } });
  const limit = sub?.seats ?? 5;
  const used = await client.account.count({ where: { tenantId } });
  if (used >= limit) throw new Error(`Account limit reached (${used}/${limit} on the ${sub?.plan || "current"} plan). Upgrade your package or contact sales.`);
}

export function listTenants() {
  return prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { subscription: true, _count: { select: { users: true, accounts: true } } },
  });
}

export async function createTenant(input: {
  name: string; subdomain: string; adminEmail: string; adminName: string; adminPassword: string;
  plan?: any; seats?: number; brandName?: string; primaryColor?: string; accentColor?: string;
  logoUrl?: string; slogan?: string; companyInfo?: string;
}) {
  const sub = input.subdomain.trim().toLowerCase();
  const exists = await prisma.tenant.findUnique({ where: { subdomain: sub } });
  if (exists) throw new Error("Subdomain already taken");

  const passwordHash = await hashPassword(input.adminPassword);
  return prisma.tenant.create({
    data: {
      name: input.name,
      slug: sub,
      subdomain: sub,
      brandName: input.brandName || input.name,
      primaryColor: input.primaryColor || "#2563eb",
      accentColor: input.accentColor || "#22c55e",
      logoUrl: input.logoUrl || null,
      ...(input.slogan ? { slogan: input.slogan } as any : {}),
      ...(input.companyInfo ? { companyInfo: input.companyInfo } as any : {}),
      subscription: { create: { plan: input.plan || "STARTER", status: "ACTIVE", seats: seatsForPlan(input.plan) } },
      users: { create: { email: input.adminEmail.toLowerCase(), name: input.adminName, passwordHash, role: "ADMIN" } },
    },
    include: { subscription: true },
  });
}

export function updateTenant(id: string, data: {
  name?: string; brandName?: string; logoUrl?: string; primaryColor?: string; accentColor?: string;
  supportEmail?: string; status?: any; customDomain?: string | null;
}) {
  return prisma.tenant.update({ where: { id }, data });
}

export function updateSubscription(tenantId: string, data: { plan?: any; status?: any; seats?: number }) {
  return prisma.subscription.update({ where: { tenantId }, data });
}

export function deleteTenant(id: string) {
  return prisma.tenant.delete({ where: { id } });
}
