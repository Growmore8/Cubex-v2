import { prisma } from "@/lib/prisma";
import { sendTenantMail, noReplyAddress } from "@/lib/mailer";
import type { BrandInfo } from "@/lib/email-templates";

export interface TenantBrand extends BrandInfo {
  smtpEmail: string;
  smtpPassword: string;
  smtpHost: string | null;
}

/** Fetch tenant SMTP creds + brand info in one query. Returns null if SMTP not configured. */
export async function getTenantBrand(tenantId: string): Promise<TenantBrand | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      smtpEmail: true,
      smtpPassword: true,
      smtpHost: true,
      brandName: true,
      name: true,
      primaryColor: true,
      accentColor: true,
      logoUrl: true,
    },
  });
  if (!t?.smtpEmail || !t?.smtpPassword) return null;
  return {
    smtpEmail: t.smtpEmail,
    smtpPassword: t.smtpPassword,
    smtpHost: t.smtpHost ?? null,
    brandName: t.brandName || t.name,
    primaryColor: t.primaryColor,
    accentColor: t.accentColor,
    logoUrl: t.logoUrl,
  };
}

/**
 * Resolve tenant SMTP + brand, then send mail to a user by ID.
 * `buildEmail` receives the real brand so templates render with tenant colours/name.
 * Never throws — fire-and-forget safe.
 */
export async function sendUserMail(
  tenantId: string,
  userId: string,
  subject: string,
  buildEmail: (brand: BrandInfo) => string
) {
  try {
    const [brand, user] = await Promise.all([
      getTenantBrand(tenantId),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!brand || !user?.email) return;
    const html = buildEmail(brand);
    await sendTenantMail(
      brand.smtpEmail,
      brand.smtpPassword,
      { to: user.email, subject, html, fromName: brand.brandName, replyTo: noReplyAddress(brand.smtpEmail) },
      brand.smtpHost ?? undefined
    );
  } catch {
    // fire-and-forget — email failure must never break the primary operation
  }
}

/**
 * Same as sendUserMail but accepts a known email address directly
 * (for cases where the user record may not have an email set, e.g. admin payments).
 */
export async function sendToEmail(
  tenantId: string,
  toEmail: string,
  subject: string,
  buildEmail: (brand: BrandInfo) => string
) {
  try {
    const brand = await getTenantBrand(tenantId);
    if (!brand) return;
    const html = buildEmail(brand);
    await sendTenantMail(
      brand.smtpEmail,
      brand.smtpPassword,
      { to: toEmail, subject, html, fromName: brand.brandName, replyTo: noReplyAddress(brand.smtpEmail) },
      brand.smtpHost ?? undefined
    );
  } catch {
    // fire-and-forget
  }
}
