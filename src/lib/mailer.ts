import nodemailer from "nodemailer";

function inferSmtpHost(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "smtp.gmail.com";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") return "smtp.office365.com";
  if (domain === "yahoo.com" || domain === "yahoo.co.uk" || domain === "ymail.com") return "smtp.mail.yahoo.com";
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") return "smtp.mail.me.com";
  if (domain === "zoho.com") return "smtp.zoho.com";
  // Generic: smtp.<domain>
  return `smtp.${domain}`;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  /** Display name shown as the sender (e.g. the tenant brand). */
  fromName?: string;
  /** Reply-To address. For no-reply mails pass a no-reply@<domain> address. */
  replyTo?: string;
  attachments?: MailAttachment[];
}

// Derive a no-reply address from an SMTP mailbox (no-reply@<its domain>).
export function noReplyAddress(smtpEmail: string): string {
  const domain = smtpEmail.split("@")[1] || "localhost";
  return `no-reply@${domain}`;
}

export async function sendTenantMail(
  smtpEmail: string,
  smtpPassword: string,
  opts: MailOptions,
) {
  const host = inferSmtpHost(smtpEmail);
  const transporter = nodemailer.createTransport({
    host,
    port: 587,
    secure: false,
    auth: { user: smtpEmail, pass: smtpPassword },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({
    from: opts.from || `"${opts.fromName || "CubeX"}" <${smtpEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
    // Discourage auto-responders / out-of-office replies to automated mail.
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  });
}

// For platform-level emails (superadmin) — uses env vars
export async function sendPlatformMail(opts: MailOptions) {
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpEmail || !smtpPassword) throw new Error("Platform SMTP not configured");
  return sendTenantMail(smtpEmail, smtpPassword, opts);
}
