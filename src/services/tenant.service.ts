import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { PACKAGES } from "@/config/packages";

const PKG_SETTING_KEY = "platform.packages";

// The default account limit baked into the code.
export function seatsForPlan(plan?: string): number {
  return (PACKAGES as any)[plan || "STARTER"]?.seats ?? 5;
}

// The LIVE account limit for a plan: the package default overridden by whatever the
// super admin saved in Packages & Pricing. Read fresh so a seat-count change in that
// section applies to every tenant on that plan immediately — no snapshot.
export async function effectiveSeatsForPlan(client: any, plan?: string): Promise<number> {
  const key = plan || "STARTER";
  const def = seatsForPlan(key);
  try {
    const setting = await client.setting.findUnique({ where: { key: PKG_SETTING_KEY } });
    const override = Number((setting?.value as any)?.[key]?.seats);
    return Number.isFinite(override) && override > 0 ? override : def;
  } catch {
    return def;
  }
}

// Throws if the tenant has reached its plan's account limit. Only LIVE accounts
// count against the limit — demo accounts are unlimited practice accounts.
export async function assertSeatAvailable(client: any, tenantId: string, type: string = "LIVE") {
  if (type !== "LIVE") return; // demos don't consume a seat
  const sub = await client.subscription.findUnique({ where: { tenantId } });
  const limit = await effectiveSeatsForPlan(client, sub?.plan);
  const used = await client.account.count({ where: { tenantId, type: "LIVE" } });
  if (used >= limit) throw new Error(`Account limit reached (${used}/${limit} live accounts on the ${sub?.plan || "current"} plan). Upgrade your package or contact sales.`);
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
      ...(input.slogan ? { slogan: input.slogan } as any : {}),
      ...(input.companyInfo ? { companyInfo: input.companyInfo } as any : {}),
      subscription: { create: { plan: input.plan || "STARTER", status: "ACTIVE", seats } },
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
