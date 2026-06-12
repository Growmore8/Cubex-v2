import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { PACKAGES } from "@/config/packages";

const PKG_SETTING_KEY = "platform.packages";

// The default account limit baked into the code.
export function seatsForPlan(plan?: string): number {
  return (PACKAGES as any)[plan || "STARTER"]?.seats ?? 5;
}

// The default manager limit per plan.
export function managersForPlan(plan?: string): number {
  return (PACKAGES as any)[plan || "STARTER"]?.managers ?? 1;
}

// Helper: read overrideable plan value from the super-admin Packages & Pricing setting.
async function effectivePlanValue(client: any, plan: string, field: "seats" | "managers", fallback: number): Promise<number> {
  try {
    const setting = await client.setting.findUnique({ where: { key: PKG_SETTING_KEY } });
    const override = Number((setting?.value as any)?.[plan]?.[field]);
    return Number.isFinite(override) && override > 0 ? override : fallback;
  } catch {
    return fallback;
  }
}

// The LIVE account limit for a plan, overrideable in Packages & Pricing.
export async function effectiveSeatsForPlan(client: any, plan?: string): Promise<number> {
  const key = plan || "STARTER";
  return effectivePlanValue(client, key, "seats", seatsForPlan(key));
}

// The manager limit for a plan, overrideable in Packages & Pricing.
export async function effectiveManagersForPlan(client: any, plan?: string): Promise<number> {
  const key = plan || "STARTER";
  return effectivePlanValue(client, key, "managers", managersForPlan(key));
}

// Throws if the tenant has reached its plan's LIVE account limit.
// Demo accounts are unlimited.
export async function assertSeatAvailable(client: any, tenantId: string, type: string = "LIVE") {
  if (type !== "LIVE") return;
  const sub = await client.subscription.findUnique({ where: { tenantId } });
  const limit = await effectiveSeatsForPlan(client, sub?.plan);
  const used = await client.account.count({ where: { tenantId, type: "LIVE" } });
  if (used >= limit) {
    const plan = sub?.plan || "current";
    throw new Error(`Live account limit reached (${used}/${limit} on the ${plan} plan). Please contact support or upgrade your package.`);
  }
}

// Throws if the tenant has reached its plan's manager limit.
export async function assertManagerAvailable(client: any, tenantId: string) {
  const sub = await client.subscription.findUnique({ where: { tenantId } });
  const limit = await effectiveManagersForPlan(client, sub?.plan);
  const used = await client.user.count({ where: { tenantId, role: "MANAGER" } });
  if (used >= limit) {
    const plan = sub?.plan || "current";
    throw new Error(`Manager limit reached (${used}/${limit} on the ${plan} plan). Please contact support or upgrade your package.`);
  }
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
  logoUrl?: string; slogan?: string; companyInfo?: string; customDomain?: string; supportEmail?: string;
  contactName?: string; contactPhone?: string;
  smtpEmail?: string; smtpPassword?: string; smtpHost?: string;
}) {
  const sub = input.subdomain.trim().toLowerCase();
  const exists = await prisma.tenant.findUnique({ where: { subdomain: sub } });
  if (exists) throw new Error("Subdomain already taken");

  const customDomain = input.customDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") || null;
  if (customDomain) {
    const dom = await prisma.tenant.findUnique({ where: { customDomain } });
    if (dom) throw new Error("That custom domain is already used by another tenant");
  }
  const passwordHash = await hashPassword(input.adminPassword);
  const seats = await effectiveSeatsForPlan(prisma, input.plan);
  return prisma.tenant.create({
    data: {
      name: input.name,
      slug: sub,
      subdomain: sub,
      brandName: input.brandName || input.name,
      primaryColor: input.primaryColor || "#2563eb",
      accentColor: input.accentColor || "#22c55e",
      logoUrl: input.logoUrl || null,
      ...(customDomain ? { customDomain } as any : {}),
      ...(input.supportEmail ? { supportEmail: input.supportEmail } as any : {}),
      ...(input.smtpEmail ? { smtpEmail: input.smtpEmail } as any : {}),
      ...(input.smtpPassword ? { smtpPassword: input.smtpPassword } as any : {}),
      ...(input.smtpHost ? { smtpHost: input.smtpHost } as any : {}),
      ...(input.slogan ? { slogan: input.slogan } as any : {}),
      ...(input.companyInfo ? { companyInfo: input.companyInfo } as any : {}),
      ...(input.contactName ? { contactName: input.contactName } as any : {}),
      ...(input.contactPhone ? { contactPhone: input.contactPhone } as any : {}),
      subscription: { create: { plan: input.plan || "STARTER", status: "ACTIVE", seats } },
      users: { create: { email: input.adminEmail.toLowerCase(), name: input.adminName, passwordHash, role: "ADMIN" } },
    },
    include: { subscription: true },
  });
}

export function updateTenant(id: string, data: {
  name?: string; brandName?: string; logoUrl?: string; primaryColor?: string; accentColor?: string;
  supportEmail?: string; status?: any; customDomain?: string | null; allowRegistration?: boolean;
}) {
  return prisma.tenant.update({ where: { id }, data });
}

export function updateSubscription(tenantId: string, data: { plan?: any; status?: any; seats?: number }) {
  return prisma.subscription.update({ where: { tenantId }, data });
}

export function deleteTenant(id: string) {
  return prisma.tenant.delete({ where: { id } });
}
