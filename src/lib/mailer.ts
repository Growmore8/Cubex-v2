import nodemailer from "nodemailer";

function inferSmtpHost(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "smtp.gmail.com";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") return "smtp.office365.com";
  if (domain === "yahoo.com" || domain === "yahoo.co.uk" || domain === "ymail.com") return "smtp.mail.yahoo.com";
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") return "smtp.mail.me.com";
  if (domain === "zoho.com" || domain === "zohomail.com") return "smtp.zoho.com";
  if (domain === "privateemail.com") return "mail.privateemail.com"; // Namecheap Private Email
  // Generic guess: smtp.<domain>. Custom-domain mailboxes (e.g. a Namecheap Private
  // Email address on your own domain) usually need an explicit smtpHost instead.
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

function buildTransport(smtpEmail: string, smtpPassword: string, smtpHost?: string | null) {
  const host = (smtpHost && smtpHost.trim()) || inferSmtpHost(smtpEmail);
  // Port 587 + STARTTLS is the common submission port. Timeouts keep a wrong/
  // unreachable host from hanging the request (which looks like "mail not coming").
  const transporter = nodemailer.createTransport({
    host,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: smtpEmail, pass: smtpPassword },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return { transporter, host };
}

export async function sendTenantMail(
  smtpEmail: string,
  smtpPassword: string,
  opts: MailOptions,
  smtpHost?: string | null,
) {
  const { transporter, host } = buildTransport(smtpEmail, smtpPassword, smtpHost);
  try {
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
  } catch (e: any) {
    // Log the real SMTP reason (host + provider message) so "mail not coming" is
    // diagnosable in server logs; rethrow so callers can surface a friendly error.
    console.error(`[mailer] send failed via ${host} as ${smtpEmail}: ${e?.message || e}`);
    throw e;
  }
}

// Validate SMTP credentials/host without sending — powers the "Test SMTP" tool.
// Returns { ok } on success or { ok:false, error } with the real reason.
export async function verifySmtp(
  smtpEmail: string,
  smtpPassword: string,
  smtpHost?: string | null,
): Promise<{ ok: boolean; host: string; error?: string }> {
  const { transporter, host } = buildTransport(smtpEmail, smtpPassword, smtpHost);
  try {
    await transporter.verify();
    return { ok: true, host };
  } catch (e: any) {
    return { ok: false, host, error: e?.message || String(e) };
  }
}

// For platform-level emails (superadmin) — uses env vars
export async function sendPlatformMail(opts: MailOptions) {
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpEmail || !smtpPassword) throw new Error("Platform SMTP not configured");
  return sendTenantMail(smtpEmail, smtpPassword, opts);
}
