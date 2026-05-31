import { prisma } from "@/lib/prisma";

export function parseSubdomain(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return null;
  const root = (process.env.ROOT_DOMAIN || "localhost:3000").split(":")[0].toLowerCase();
  if (h === root) return null;
  if (h.endsWith("." + root)) {
    const sub = h.slice(0, -(root.length + 1));
    return sub || null;
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
