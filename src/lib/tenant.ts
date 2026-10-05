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

// In-memory tenant cache: avoids a DB round-trip on every page render.
// getBrand() is called by layout, metadata, icon, manifest — all per-request.
// 60-second TTL is short enough that logo/colour changes propagate quickly.
const _cache = new Map<string, { data: any; exp: number }>();
const TTL = 60_000;

export function invalidateTenantCache(host?: string) {
  if (host) _cache.delete(host.split(":")[0].toLowerCase());
  else _cache.clear();
}

export async function resolveTenant(host: string | null) {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();

  const hit = _cache.get(h);
  if (hit && hit.exp > Date.now()) return hit.data;

  const sub = parseSubdomain(h);
  const data = sub
    ? await prisma.tenant.findUnique({ where: { subdomain: sub } })
    : await prisma.tenant.findUnique({ where: { customDomain: h } });

  _cache.set(h, { data, exp: Date.now() + TTL });
  return data;
}
