import { headers } from "next/headers";
import { resolveTenant } from "@/lib/tenant";

export interface Brand {
  name: string;
  slogan: string | null;
  companyInfo: string | null;
  supportEmail: string | null;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  tenantId: string | null;
  allowRegistration: boolean;
}

// No tenant (SuperAdmin / apex) → never offer client registration.
const DEFAULT_BRAND: Brand = { name: process.env.APP_NAME || "Cubex", slogan: null, companyInfo: null, supportEmail: null, primaryColor: "#2563eb", accentColor: "#22c55e", logoUrl: null, faviconUrl: null, tenantId: null, allowRegistration: false };

export async function getBrand(): Promise<Brand> {
  // Branding must never crash a page: if the DB is unreachable or not yet migrated,
  // fall back to the default brand so login/register still render.
  try {
    const host = (await headers()).get("host");
    const tenant = await resolveTenant(host);
    if (!tenant) return DEFAULT_BRAND;
    return {
      name: tenant.brandName || tenant.name,
      slogan: (tenant as any).slogan || null,
      companyInfo: (tenant as any).companyInfo || null,
      supportEmail: tenant.supportEmail || null,
      primaryColor: tenant.primaryColor || "#2563eb",
      accentColor: tenant.accentColor || "#22c55e",
      logoUrl: tenant.logoUrl,
      faviconUrl: (tenant as any).faviconUrl || null,
      tenantId: tenant.id,
      allowRegistration: (tenant as any).allowRegistration !== false,
    };
  } catch (e) {
    console.error("[brand] failed to resolve tenant brand:", (e as any)?.message);
    return DEFAULT_BRAND;
  }
}
