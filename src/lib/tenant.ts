import { prisma } from "@/lib/prisma";

// Platform base domains that host tenant subdomains. Supports several so a
// neutral domain (PLATFORM_BASE_DOMAIN, e.g. fxtradehub.com) can run alongside
// the original ROOT_DOMAIN / DOMAIN.
export function platformBaseDomains(): string[] {
  const list = [process.env.ROOT_DOMAIN, process.env.PLATFORM_BASE_DOMAIN, process.env.DOMAIN]
    .map((d) => (d || "").split(":")[0].toLowerCase().trim())
    .filter(Boolean);
  return Array.from(new Set(list.length ? list : ["localhost"]));
}

export function parseSubdomain(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return null;
  for (const root of platformBaseDomains()) {
    if (h === root) return null;
    if (h.endsWith("." + root)) {
      const sub = h.slice(0, -(root.length + 1));
      // ignore reserved sub-hosts that are not tenants
      if (sub && !["www", "trade", "db", "files", "api"].includes(sub)) return sub;
      return null;
    }
  }
  if (h.endsWith(".localhost")) {
    return h.slice(0, -(".localhost".length)) || null;
  }
  return null;
}

export async function resolveTenant(host: string | null) {
  if (!host) return null;
  const sub = parseSubdomain(host);
  if (sub) return prisma.tenant.findUnique({ where: { subdomain: sub } });
  const domain = host.split(":")[0].toLowerCase();
  return prisma.tenant.findFirst({ where: { customDomain: domain } });
}
