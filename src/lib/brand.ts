import { headers } from "next/headers";
import { resolveTenant } from "@/lib/tenant";

export interface Brand {
  name: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  tenantId: string | null;
}

export async function getBrand(): Promise<Brand> {
  const host = headers().get("host");
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return { name: process.env.APP_NAME || "Cubex", primaryColor: "#2563eb", accentColor: "#22c55e", logoUrl: null, tenantId: null };
  }
  return {
    name: tenant.brandName || tenant.name,
    primaryColor: tenant.primaryColor || "#2563eb",
    accentColor: tenant.accentColor || "#22c55e",
    logoUrl: tenant.logoUrl,
    tenantId: tenant.id,
  };
}
