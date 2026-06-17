import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { verifySmtp, sendTenantMail, noReplyAddress } from "@/lib/mailer";
import { smtpTestEmail, type BrandInfo } from "@/lib/email-templates";

// SuperAdmin SMTP diagnostics. Verifies a tenant's SMTP credentials/host and,
// when a `to` address is given, sends a real test email so you can confirm
// delivery end-to-end. Returns the real SMTP error on failure.
export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const t: any = await prisma.tenant.findUnique({ where: { id: b.tenantId } });
    if (!t) return NextResponse.json({ ok: false, error: "Tenant not found" }, { status: 404 });
    if (!t.smtpEmail || !t.smtpPassword) return NextResponse.json({ ok: false, error: "This tenant has no SMTP email/password saved. Re-enter the SMTP password and save." }, { status: 400 });

    const v = await verifySmtp(t.smtpEmail, t.smtpPassword, t.smtpHost);
    if (!v.ok) return NextResponse.json({ ok: false, host: v.host, error: `SMTP connection/login failed (${v.host}): ${v.error}` }, { status: 400 });

    // Optional: send a real test email to confirm delivery.
    const to = String(b.to || "").trim();
    if (to) {
      const brandName = t.brandName || t.name;
      const brand: BrandInfo = { brandName, primaryColor: t.primaryColor, accentColor: t.accentColor, logoUrl: t.logoUrl };
      try {
        await sendTenantMail(t.smtpEmail, t.smtpPassword, {
          to,
          subject: `Your email is working — ${brandName}`,
          fromName: brandName,
          replyTo: noReplyAddress(t.smtpEmail),
          html: smtpTestEmail(brand),
        }, t.smtpHost);
      } catch (e: any) {
        return NextResponse.json({ ok: false, host: v.host, error: `Login OK but send failed: ${e?.message || e}` }, { status: 400 });
      }
      return NextResponse.json({ ok: true, host: v.host, sent: to });
    }
    return NextResponse.json({ ok: true, host: v.host });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 400 });
  }
}
