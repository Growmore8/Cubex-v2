import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";
import { googleEnabled } from "@/lib/google";
import { prisma } from "@/lib/prisma";

// Public brand summary for the auth pages (no auth required).
export async function GET() {
  const b = await getBrand();
  // Google login is useless on demo (TRIALING) tenants — their subdomain is not
  // in Google's authorized redirect URIs and they have no SMTP fallback.
  let gEnabled = googleEnabled();
  if (gEnabled && b.tenantId) {
    const sub = await prisma.subscription.findUnique({ where: { tenantId: b.tenantId }, select: { status: true } });
    if (sub?.status === "TRIALING") gEnabled = false;
  }
  return NextResponse.json({ ok: true, tenantId: b.tenantId, allowRegistration: b.allowRegistration, name: b.name, websiteUrl: b.websiteUrl, logoUrl: b.logoUrl, slogan: b.slogan, primaryColor: b.primaryColor, accentColor: b.accentColor, googleEnabled: gEnabled });
}
