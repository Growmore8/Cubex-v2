import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { resolveTenant } from "@/lib/tenant";
import { nextLogin } from "@/services/account.service";
import { assertSeatAvailable } from "@/services/tenant.service";
import { deviceFromUA } from "@/lib/presence";
import { sendTenantMail } from "@/lib/mailer";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/types";
import type { Role } from "@/config/roles";

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function authenticate(host: string | null, email: string, password: string, ip?: string, ua?: string): Promise<SessionPayload> {
  const tenant = await resolveTenant(host);
  const tenantId = tenant?.id ?? null;

  const user = tenantId
    ? await prisma.user.findFirst({
        where: { tenantId, email: email.toLowerCase() },
      })
    : await prisma.user.findFirst({
        where: { email: email.toLowerCase() },
        orderBy: { createdAt: "asc" },
      });

  if (!user) throw new Error("Invalid email or password");
  // SUSPENDED = deactivated -> cannot sign in. LOCKED = read-only -> allowed (banner shown).
  if (user.status === "SUSPENDED") throw new Error("Your account has been deactivated. Please contact support.");
  // Tenant SUSPENDED = read-only (allowed). PENDING = not yet activated (blocked).
  if (tenant && tenant.status === "PENDING") throw new Error("This workspace is not active yet");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid email or password");

  // Single-device enforcement for staff roles: issue a fresh session id that
  // supersedes any previous login. CLIENT may use multiple devices.
  const isStaff = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPERADMIN";
  const sid = isStaff ? Math.random().toString(36).slice(2) + Date.now().toString(36) : undefined;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lastSeenAt: new Date(),
      ...(ip ? { lastLoginIp: ip } : {}),
      ...(ua ? { lastDevice: deviceFromUA(ua) } : {}),
      ...(isStaff ? { activeSession: sid } : {}),
    },
  });

  return { sub: user.id, role: user.role as Role, tenantId: user.tenantId, email: user.email, name: user.name, ...(sid ? { sid } : {}) };
}

export type RegisterResult =
  | { needsVerification: true; email: string }
  | (SessionPayload & { needsVerification: false });

export async function registerClient(
  host: string | null,
  name: string,
  email: string,
  password: string,
  phone?: string,
  country?: string,
  type: "DEMO" | "LIVE" = "LIVE",
  tenantSlug?: string,
): Promise<RegisterResult> {
  let tenant: any = await resolveTenant(host);
  if (!tenant && tenantSlug) {
    tenant = await prisma.tenant.findFirst({
      where: { OR: [{ slug: tenantSlug }, { subdomain: tenantSlug }] },
    });
  }
  if (!tenant) throw new Error("Registration is only available on a brand site");

  const lowerEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);

  // If tenant has SMTP configured, send a verification email before creating the session
  const hasSmtp = !!(tenant.smtpEmail && tenant.smtpPassword);
  const emailToken = hasSmtp ? makeCode() : null;

  const session = await prisma.$transaction(async (tx) => {
    const exists = await tx.user.findFirst({ where: { tenantId: tenant!.id, email: lowerEmail } });
    if (exists) throw new Error("Email already registered");
    // Only LIVE accounts consume a seat
    await assertSeatAvailable(tx, tenant!.id, type);

    const user = await (tx.user.create as any)({
      data: {
        tenantId: tenant!.id, email: lowerEmail, name, passwordHash, role: "CLIENT",
        ...(emailToken ? { emailToken } : {}),
      },
    });
    const login = await nextLogin(tx, tenant!.id, type);
    await tx.account.create({
      data: {
        tenantId: tenant!.id, login, userId: user.id, name, type,
        leverage: 100, currency: "USD",
        phone: phone || null, country: country || null,
        deposit: type === "DEMO" ? new Prisma.Decimal(10000) : new Prisma.Decimal(0),
      },
    });
    return { sub: user.id, role: "CLIENT" as Role, tenantId: tenant!.id, email: lowerEmail, name };
  });

  if (hasSmtp && emailToken) {
    // Send verification email — non-blocking so registration succeeds even if SMTP fails
    sendTenantMail(tenant.smtpEmail, tenant.smtpPassword, {
      to: lowerEmail,
      subject: "Verify your email address",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="margin:0 0 8px">Welcome to ${tenant.brandName || tenant.name}</h2>
          <p style="color:#555;margin:0 0 24px">Enter the code below to verify your email address and activate your trading account.</p>
          <div style="text-align:center;margin:32px 0">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#1a2332">${emailToken}</span>
          </div>
          <p style="color:#888;font-size:12px">This code expires in 15 minutes. If you didn't register, you can ignore this email.</p>
        </div>
      `,
    }).catch(() => {});
    return { needsVerification: true, email: lowerEmail };
  }

  return { ...session, needsVerification: false };
}

export async function verifyEmail(
  host: string | null,
  email: string,
  token: string,
): Promise<SessionPayload> {
  const tenant = await resolveTenant(host);
  if (!tenant) throw new Error("Tenant not found");
  const lowerEmail = email.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: lowerEmail },
  });
  const u = user as any;
  if (!u || !u.emailToken) throw new Error("Verification not pending");
  if (u.emailToken !== token.trim()) throw new Error("Incorrect code — please try again");
  await (prisma.user.update as any)({ where: { id: u.id }, data: { emailToken: null } });
  return { sub: u.id, role: u.role as Role, tenantId: tenant.id, email: lowerEmail, name: u.name };
}

export async function sendForgotPassword(host: string | null, email: string): Promise<void> {
  const tenant: any = await resolveTenant(host);
  if (!tenant) throw new Error("Tenant not found");
  if (!tenant.smtpEmail || !tenant.smtpPassword) throw new Error("Password reset emails are not configured for this broker. Please contact support.");
  const lowerEmail = email.toLowerCase();
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: lowerEmail } });
  // Always return success (don't reveal if email exists)
  if (!user) return;
  const token = makeCode() + makeCode(); // 12-digit reset token
  await (prisma.user.update as any)({ where: { id: user.id }, data: { emailToken: "reset:" + token } });
  const resetLink = `${process.env.NEXT_PUBLIC_APP_URL || `https://${tenant.subdomain}.cubexenterprises.com`}/reset-password?email=${encodeURIComponent(lowerEmail)}&token=${token}`;
  await sendTenantMail(tenant.smtpEmail, tenant.smtpPassword, {
    to: lowerEmail,
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 8px">Password Reset</h2>
        <p style="color:#555;margin:0 0 24px">Click the button below to reset your password. This link expires in 15 minutes.</p>
        <a href="${resetLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
        <p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, ignore this email. Your password won't change.</p>
      </div>
    `,
  });
}

export async function resetPassword(host: string | null, email: string, token: string, newPassword: string): Promise<void> {
  const tenant = await resolveTenant(host);
  if (!tenant) throw new Error("Tenant not found");
  const lowerEmail = email.toLowerCase();
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: lowerEmail } });
  const u2 = user as any;
  if (!u2?.emailToken || u2.emailToken !== `reset:${token}`) throw new Error("Invalid or expired reset link");
  const passwordHash = await hashPassword(newPassword);
  await (prisma.user.update as any)({ where: { id: u2.id }, data: { passwordHash, emailToken: null } });
}
