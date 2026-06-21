import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { resolveTenant } from "@/lib/tenant";
import { nextLogin } from "@/services/account.service";
import { assertSeatAvailable } from "@/services/tenant.service";
import { deviceFromUA } from "@/lib/presence";
import { sendTenantMail, noReplyAddress } from "@/lib/mailer";
import { verificationEmail, resetPasswordEmail, type BrandInfo } from "@/lib/email-templates";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notifyStaff } from "@/services/notification.service";
import { titleCaseName } from "@/lib/format";
import type { SessionPayload } from "@/types";
import type { Role } from "@/config/roles";

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function authenticate(host: string | null, email: string, password: string, ip?: string, ua?: string): Promise<SessionPayload> {
  const tenant = await resolveTenant(host);
  const tenantId = tenant?.id ?? null;

  const ident = String(email || "").trim();
  let candidates;
  if (/^\d{3,}$/.test(ident) && tenantId) {
    // Login by Live ID (account number) — used by POOL accounts that have no email.
    // Resolve the user(s) that own an account with this login in the tenant.
    const accs = await prisma.account.findMany({ where: { tenantId, login: ident }, select: { userId: true } });
    const uids = Array.from(new Set(accs.map((a) => a.userId).filter(Boolean) as string[]));
    candidates = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, orderBy: { createdAt: "asc" } }) : [];
  } else {
    const lower = ident.toLowerCase();
    // Several users can share an email under one tenant (e.g. a CLIENT trader who is
    // also a MANAGER), so match the password across all candidates with that email.
    candidates = tenantId
      ? await prisma.user.findMany({ where: { tenantId, email: lower }, orderBy: { createdAt: "asc" } })
      : await prisma.user.findMany({ where: { email: lower }, orderBy: { createdAt: "asc" } });
  }

  let user: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await verifyPassword(password, c.passwordHash)) { user = c; break; }
  }
  if (!user) throw new Error("Invalid email or password");
  // SUSPENDED = deactivated -> cannot sign in. LOCKED = read-only -> allowed (banner shown).
  if (user.status === "SUSPENDED") throw new Error("Your account has been deactivated. Please contact support.");
  // Tenant SUSPENDED = brokerage suspended → block sign-in. PENDING = not yet activated.
  if (tenant && tenant.status === "SUSPENDED") throw new Error("This brokerage has been suspended. Please contact support.");
  if (tenant && tenant.status === "PENDING") throw new Error("This workspace is not active yet");
  // Trial expiry: a TRIALING subscription past its endsAt blocks sign-in (until
  // converted to a paid plan). SuperAdmin can still extend or convert it.
  if (tenant) {
    const sub = await prisma.subscription.findUnique({ where: { tenantId: tenant.id }, select: { status: true, endsAt: true } });
    if (sub && sub.status === "TRIALING" && sub.endsAt && new Date(sub.endsAt).getTime() < Date.now()) {
      throw new Error("This demo has ended. Please contact sales to continue.");
    }
  }

  // Pending email verification: emailToken is set and is NOT a password-reset token.
  // Checked only after password is confirmed so we don't leak account existence.
  if ((user as any).emailToken && !String((user as any).emailToken).startsWith("reset:")) {
    throw new Error("Please verify your email before signing in. Check your inbox for the verification code.");
  }

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

// Build a session for a user who has been authenticated by a SECOND factor
// (passkey / device-bound PIN) rather than a password. Used by the passwordless
// sign-in routes. CLIENT-only (staff must use password + single-device sid).
export async function sessionForUser(userId: string, ip?: string, ua?: string): Promise<SessionPayload> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Account not found");
  if (user.role !== "CLIENT") throw new Error("Passwordless sign-in is only available for client accounts");
  if (user.status === "SUSPENDED") throw new Error("Your account has been deactivated. Please contact support.");
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } });
    if (tenant && tenant.status === "SUSPENDED") throw new Error("This brokerage has been suspended. Please contact support.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastSeenAt: new Date(), ...(ip ? { lastLoginIp: ip } : {}), ...(ua ? { lastDevice: deviceFromUA(ua) } : {}) },
  });
  return { sub: user.id, role: user.role as Role, tenantId: user.tenantId, email: user.email, name: user.name };
}

export type RegisterResult =
  | { needsVerification: true; email: string }
  | (SessionPayload & { needsVerification: false });

// Google sign-in / sign-up. The email is already verified by Google, so there's
// no OTP step. Existing users (any role) are signed in; unknown emails become a
// CLIENT (a DEMO account by default — no seat). Returns a session payload.
export async function googleSignIn(
  host: string | null,
  email: string,
  name: string,
  type: "DEMO" | "LIVE" = "DEMO",
): Promise<SessionPayload> {
  const tenant: any = await resolveTenant(host);
  if (!tenant) throw new Error("Sign-in is only available on a brand site");
  if (tenant.status === "SUSPENDED") throw new Error("This brokerage has been suspended. Please contact support.");
  const lowerEmail = email.toLowerCase();

  // Existing identity (client or staff) → sign in.
  const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: lowerEmail }, orderBy: { createdAt: "asc" } });
  if (existing) {
    if (existing.status === "SUSPENDED") throw new Error("Your account has been deactivated. Please contact support.");
    // A pending (unverified) password signup: Google verified the email, clear the OTP.
    if ((existing as any).emailToken && !String((existing as any).emailToken).startsWith("reset:")) {
      await (prisma.user.update as any)({ where: { id: existing.id }, data: { emailToken: null } }).catch(() => {});
    }
    return { sub: existing.id, role: existing.role as Role, tenantId: existing.tenantId, email: lowerEmail, name: existing.name };
  }

  // New email → register a client (if the broker allows self-registration).
  if (tenant.allowRegistration === false) throw new Error("Registration is currently disabled for this broker.");
  const cleanName = titleCaseName(name) || lowerEmail.split("@")[0];
  const passwordHash = await hashPassword(makeCode() + makeCode()); // unusable; user signs in via Google
  const session = await prisma.$transaction(async (tx) => {
    await assertSeatAvailable(tx, tenant.id, type);
    const user = await (tx.user.create as any)({ data: { tenantId: tenant.id, email: lowerEmail, name: cleanName, passwordHash, role: "CLIENT" } });
    const login = await nextLogin(tx, tenant.id, type);
    await tx.account.create({ data: { tenantId: tenant.id, login, userId: user.id, name: cleanName, type, leverage: 100, currency: "USD", mcLevel: new Prisma.Decimal(50), deposit: type === "DEMO" ? new Prisma.Decimal(10000) : new Prisma.Decimal(0) } });
    return { sub: user.id, role: "CLIENT" as Role, tenantId: tenant.id, email: lowerEmail, name: cleanName };
  });
  audit(tenant.id, "client.register", cleanName + " <" + lowerEmail + "> (Google " + type + ")", lowerEmail, "CLIENT").catch(() => {});
  notifyStaff(tenant.id, { title: "New client registered", body: cleanName + " (" + lowerEmail + ") via Google", type: "NOTICE" }).catch(() => {});
  return session;
}

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
  if ((tenant as any).allowRegistration === false) throw new Error("Registration is currently disabled for this broker.");

  const lowerEmail = email.toLowerCase();
  name = titleCaseName(name); // store the submitted name capitalised
  const passwordHash = await hashPassword(password);

  // Email verification (OTP) is mandatory. If the broker has no SMTP configured we
  // cannot send a code, so we block account creation entirely (no silent fallback).
  const hasSmtp = !!(tenant.smtpEmail && tenant.smtpPassword);
  if (!hasSmtp) throw new Error("Registration is temporarily unavailable for this broker (email verification is not configured). Please contact support.");
  const emailToken = makeCode();
  const brand: BrandInfo = { brandName: tenant.brandName || tenant.name, primaryColor: tenant.primaryColor, accentColor: tenant.accentColor, logoUrl: tenant.logoUrl };
  // Send (or re-send) the OTP to the address. Throws on delivery failure.
  const sendOtp = async () => {
    await sendTenantMail(tenant.smtpEmail, tenant.smtpPassword, {
      to: lowerEmail,
      subject: `Verify your email — ${brand.brandName}`,
      fromName: brand.brandName,
      replyTo: noReplyAddress(tenant.smtpEmail),
      html: verificationEmail(brand, emailToken),
    }, (tenant as any).smtpHost);
  };

  // Existing client identity with this email?
  const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: lowerEmail, role: "CLIENT" } });
  if (existing) {
    const pending = !!(existing as any).emailToken && !String((existing as any).emailToken).startsWith("reset:");
    if (!pending) {
      // Verified account — block self-signup, guide them to sign in (open an extra
      // account from the dashboard). Tag so the register page shows a "Sign in" CTA.
      const e: any = new Error("You already have an account with this email. Please sign in — you can open a Demo or Live account from your dashboard.");
      e.code = "EMAIL_EXISTS";
      throw e;
    }
    // Unverified (OTP never completed) — this is effectively a retry/resend. Refresh
    // the latest name + password and re-send a fresh code; do NOT create a second
    // account. This is what makes the "Resend code" button and re-submits work.
    await (prisma.user.update as any)({ where: { id: existing.id }, data: { name, passwordHash, emailToken } });
    try { await sendOtp(); }
    catch (e: any) {
      console.error("[register] OTP resend failed:", e?.message);
      throw new Error("We couldn't send the verification code to your email. Please check the address and try again, or contact support.");
    }
    return { needsVerification: true, email: lowerEmail };
  }

  const session = await prisma.$transaction(async (tx) => {
    // Race-safety: another request may have created this client between the check
    // above and here.
    const dupe = await tx.user.findFirst({ where: { tenantId: tenant!.id, email: lowerEmail, role: "CLIENT" } });
    if (dupe) { const e: any = new Error("Email already registered"); e.code = "EMAIL_EXISTS"; throw e; }
    // One identity per person: an email used by a staff member can't also be a client.
    const staffExists = await tx.user.findFirst({ where: { tenantId: tenant!.id, email: lowerEmail, role: { in: ["ADMIN", "MANAGER"] } } });
    if (staffExists) throw new Error("This email is already in use. Please use a different email.");
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
        leverage: 100, currency: "USD", mcLevel: new Prisma.Decimal(50),
        phone: phone || null, country: country || null,
        deposit: type === "DEMO" ? new Prisma.Decimal(10000) : new Prisma.Decimal(0),
      },
    });
    return { sub: user.id, role: "CLIENT" as Role, tenantId: tenant!.id, email: lowerEmail, name };
  });

  // Audit the self-signup + alert staff/superadmin that a new client registered.
  audit(tenant!.id, "client.register", name + " <" + lowerEmail + "> (" + (type || "LIVE") + ")", lowerEmail, "CLIENT").catch(() => {});
  notifyStaff(tenant!.id, { title: "New client registered", body: name + " (" + lowerEmail + ")", type: "NOTICE" }).catch(() => {});

  // Send the verification code and WAIT for it. If delivery fails we must not leave
  // behind an account that can never be verified — roll it back and tell the user.
  try {
    await sendOtp();
  } catch (e: any) {
    console.error("[register] OTP send failed:", e?.message);
    await prisma.account.deleteMany({ where: { userId: session.sub } }).catch(() => {});
    await prisma.user.delete({ where: { id: session.sub } }).catch(() => {});
    throw new Error("We couldn't send the verification code to your email. Please check the address and try again, or contact support.");
  }
  return { needsVerification: true, email: lowerEmail };
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
  let user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: lowerEmail } });
  if (!user) {
    // Fall back to the per-account email copy — covers clients whose login email
    // differs from account.email (or legacy data) — resolving to the owning user.
    const acc = await prisma.account.findFirst({ where: { tenantId: tenant.id, email: lowerEmail, userId: { not: null } }, select: { userId: true } });
    if (acc?.userId) user = await prisma.user.findUnique({ where: { id: acc.userId } });
  }
  // Always return success to the caller (don't reveal whether the email exists),
  // but log server-side so "no reset mail" is diagnosable.
  if (!user) { console.warn(`[forgot-password] no account matches "${lowerEmail}" in tenant ${tenant.id} — no mail sent`); return; }
  // Use the user's CANONICAL login email for the link + recipient, so the reset
  // page (which looks the user up by email) resolves correctly.
  const target = user.email;
  const token = makeCode() + makeCode(); // 12-digit reset token
  await (prisma.user.update as any)({ where: { id: user.id }, data: { emailToken: "reset:" + token } });
  // Build the link from the domain the user is actually on (request host), then
  // the tenant's custom domain — so every tenant's reset email points back to a
  // real, working domain instead of the placeholder *.cubexenterprises.com.
  const hostBase = host ? host.replace(/^https?:\/\//, "").replace(/\/+$/, "") : "";
  const base = process.env.NEXT_PUBLIC_APP_URL
    || (hostBase ? `https://${hostBase}` : "")
    || (tenant.customDomain ? `https://${tenant.customDomain}` : `https://${tenant.subdomain}.${process.env.PLATFORM_BASE_DOMAIN || "cubexenterprises.com"}`);
  const resetLink = `${base}/reset-password?email=${encodeURIComponent(target)}&token=${token}`;
  const brand: BrandInfo = { brandName: tenant.brandName || tenant.name, primaryColor: tenant.primaryColor, accentColor: tenant.accentColor, logoUrl: tenant.logoUrl };
  try {
    await sendTenantMail(tenant.smtpEmail, tenant.smtpPassword, {
      to: target,
      subject: `Reset your password — ${brand.brandName}`,
      fromName: brand.brandName,
      replyTo: noReplyAddress(tenant.smtpEmail),
      html: resetPasswordEmail(brand, resetLink),
    }, (tenant as any).smtpHost);
    console.log(`[forgot-password] reset email sent to ${target} (tenant ${tenant.id})`);
  } catch (e: any) {
    console.error(`[forgot-password] send failed to ${target}: ${e?.message || e}`);
    throw e;
  }
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
  audit(tenant.id, "auth.passwordReset", lowerEmail + " (self-service)", lowerEmail, (u2.role || "CLIENT")).catch(() => {});
}
