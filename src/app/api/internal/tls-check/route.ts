import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { platformBaseDomains } from "@/lib/tenant";

// Caddy on-demand TLS "ask" endpoint. Before issuing a Let's Encrypt cert for an
// incoming hostname, Caddy calls GET /api/internal/tls-check?domain=<host>.
//   200 -> Caddy issues the cert.   non-2xx -> Caddy refuses (prevents abuse).
//
// Allowed: the platform root domain and any of its subdomains (db., files., and
// each tenant subdomain), plus any tenant's configured custom domain.
export async function GET(req: Request) {
  const domain = (new URL(req.url).searchParams.get("domain") || "").toLowerCase().trim();
  if (!domain) return new NextResponse("missing domain", { status: 400 });

  // Allow every platform base domain (ROOT_DOMAIN / PLATFORM_BASE_DOMAIN / DOMAIN)
  // and all of their subdomains (trade., www., db., files., and tenant subdomains).
  for (const root of platformBaseDomains()) {
    if (domain === root || domain.endsWith("." + root)) return new NextResponse("ok", { status: 200 });
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { customDomain: domain },
      select: { id: true },
    });
    if (tenant) return new NextResponse("ok", { status: 200 });
  } catch (e) {
    // If the DB is briefly unreachable, refuse rather than mint a cert for an
    // unverified domain — Caddy will retry on the next request.
    return new NextResponse("lookup failed", { status: 503 });
  }

  return new NextResponse("unknown domain", { status: 403 });
}
