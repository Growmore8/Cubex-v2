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

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
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
    from: opts.from || `"CubeX" <${smtpEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

// For platform-level emails (superadmin) — uses env vars
export async function sendPlatformMail(opts: MailOptions) {
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpEmail || !smtpPassword) throw new Error("Platform SMTP not configured");
  return sendTenantMail(smtpEmail, smtpPassword, opts);
}
