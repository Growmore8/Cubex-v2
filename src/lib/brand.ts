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
  tenantId: string | null;
}

export async function getBrand(): Promise<Brand> {
  const host = (await headers()).get("host");
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return { name: process.env.APP_NAME || "Cubex", slogan: null, companyInfo: null, supportEmail: null, primaryColor: "#2563eb", accentColor: "#22c55e", logoUrl: null, tenantId: null };
  }
  return {
    name: tenant.brandName || tenant.name,
    slogan: (tenant as any).slogan || null,
    companyInfo: (tenant as any).companyInfo || null,
    supportEmail: tenant.supportEmail || null,
    primaryColor: tenant.primaryColor || "#2563eb",
    accentColor: tenant.accentColor || "#22c55e",
    logoUrl: tenant.logoUrl,
    tenantId: tenant.id,
  };
}
