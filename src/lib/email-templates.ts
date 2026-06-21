// Shared branded, mobile-responsive HTML email templates.
// Every tenant's brand name, colours and logo are injected at send time so a
// broker's clients never see "CubeX". Footer = brand name + "Finance Department"
// + an automated "do not reply" notice (these are no-reply emails).

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export interface BrandInfo {
  brandName: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
}

// Wrap body content in the branded shell (header bar + footer).
export function brandedEmail(brand: BrandInfo, heading: string, bodyHtml: string): string {
  const name = esc(brand.brandName || "Statement");
  const primary = esc(brand.primaryColor || "#2563eb");
  const accent = esc(brand.accentColor || "#22c55e");
  const logo = brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="${name}" style="height:34px;width:auto;display:block;margin-bottom:6px"/>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @media only screen and (max-width:600px){
    .em-card{width:100% !important;border-radius:10px !important}
    .em-head{padding:18px 18px !important}
    .em-body{padding:22px 18px 4px !important}
    .em-h{font-size:17px !important}
    .em-code{font-size:30px !important;letter-spacing:8px !important;padding:12px 12px 12px 20px !important}
    .em-btn{display:block !important;text-align:center !important}
    .em-foot{padding:16px 18px 20px !important}
  }
</style></head>
<body style="margin:0;background:#f4f6fb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div class="em-card" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px -10px rgba(0,0,0,.25)">
    <div class="em-head" style="padding:22px 28px;color:#fff;background:linear-gradient(135deg,${primary},${accent})">
      ${logo}<div style="font-size:19px;font-weight:800">${name}</div>
    </div>
    <div class="em-body" style="padding:30px 30px 8px;color:#1f2937">
      <h3 class="em-h" style="font-size:19px;margin:0 0 8px;color:#111827">${esc(heading)}</h3>
      ${bodyHtml}
    </div>
    <div class="em-foot" style="padding:20px 30px 26px;border-top:1px solid #eef1f5;margin-top:14px">
      <div style="font-size:13px;font-weight:800;color:#111827">${name}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">Finance Department</div>
      <div style="font-size:11px;color:#b91c1c;margin-top:10px">This is an automated message — please do not reply to this email.</div>
    </div>
  </div>
</body></html>`;
}

export function verificationEmail(brand: BrandInfo, code: string): string {
  return brandedEmail(brand, "Verify your email address", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Welcome to ${esc(brand.brandName)}. Use the code below to verify your email and activate your trading account.</p>
    <div style="text-align:center;margin:26px 0">
      <span class="em-code" style="display:inline-block;font-size:38px;font-weight:800;letter-spacing:12px;color:#111827;background:#f3f4f6;border-radius:10px;padding:14px 22px 14px 34px">${esc(code)}</span>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 16px">This code expires in 15 minutes. If you didn't create an account, you can safely ignore this email.</p>`);
}

export function resetPasswordEmail(brand: BrandInfo, resetLink: string): string {
  const primary = esc(brand.primaryColor || "#2563eb");
  return brandedEmail(brand, "Reset your password", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">We received a request to reset the password for your ${esc(brand.brandName)} account. Click the button below to choose a new password.</p>
    <div style="text-align:center;margin:24px 0 18px">
      <a class="em-btn" href="${esc(resetLink)}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:9px;background:${primary}">Reset password</a>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 16px">This link expires in 15 minutes. If you didn't request a reset, ignore this email — your password won't change.</p>`);
}

// Creative, fully-branded "your email works" confirmation (the SMTP test mail).
export function smtpTestEmail(brand: BrandInfo): string {
  const primary = esc(brand.primaryColor || "#2563eb");
  const accent = esc(brand.accentColor || "#22c55e");
  const name = esc(brand.brandName);
  return brandedEmail(brand, "Your email is working 🎉", `
    <div style="text-align:center;margin:6px 0 20px">
      <div style="display:inline-block;width:86px;height:86px;line-height:86px;border-radius:50%;text-align:center;color:#fff;font-size:46px;font-weight:800;background:linear-gradient(135deg,${primary},${accent});box-shadow:0 10px 26px -8px ${accent}">&#10003;</div>
    </div>
    <p style="font-size:16px;line-height:1.6;color:#111827;font-weight:700;margin:0 0 10px;text-align:center">All set — email delivery is working.</p>
    <p style="font-size:13px;line-height:1.7;color:#6b7280;margin:0 0 18px;text-align:center">This is a test message confirming that <strong>${name}</strong> can reach your clients. Verification codes, password resets and account statements will now be delivered from this address.</p>
    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 8px;margin:4px 0 14px">
      <tr><td style="padding:10px 14px;background:#f6f8fc;border-radius:9px;font-size:13px;color:#374151">&#9993;&nbsp; Email verification (OTP)</td></tr>
      <tr><td style="padding:10px 14px;background:#f6f8fc;border-radius:9px;font-size:13px;color:#374151">&#128274;&nbsp; Password reset links</td></tr>
      <tr><td style="padding:10px 14px;background:#f6f8fc;border-radius:9px;font-size:13px;color:#374151">&#128196;&nbsp; Account statements (PDF)</td></tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px;text-align:center">No action needed — you can safely ignore this email.</p>`);
}

// Demo/trial welcome — sent to a prospect with their link, admin + client login,
// and expiry, so they can explore BOTH the back office and the trading app.
export function demoWelcomeEmail(brand: BrandInfo, o: { url: string; email: string; password: string; endsAt?: string | null; client?: { email: string; password: string } | null }): string {
  const primary = esc(brand.primaryColor || "#2563eb");
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px;white-space:nowrap">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;font-weight:700;font-size:13px;color:#111827;word-break:break-all">${v}</td></tr>`;
  const head = (label: string) => `<div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin:14px 0 4px">${esc(label)}</div>`;
  const ends = o.endsAt ? new Date(o.endsAt).toLocaleDateString() : null;
  return brandedEmail(brand, "Your demo is ready 🎉", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Welcome! Your <strong>${esc(brand.brandName)}</strong> trading platform demo is live. Use the logins below to explore both sides${ends ? ` — your trial runs until <strong>${esc(ends)}</strong>` : ""}.</p>
    <div style="text-align:center;margin:20px 0 6px">
      <a href="${esc(o.url)}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:9px;background:${primary}">Open the platform</a>
    </div>
    ${head("Admin / Back office — manage clients, trades, payments")}
    <table style="width:100%;border-collapse:collapse">
      ${row("URL", `<a href="${esc(o.url)}" style="color:${primary}">${esc(o.url.replace(/^https?:\/\//, ""))}</a>`)}
      ${row("Email", esc(o.email))}
      ${row("Password", esc(o.password))}
    </table>
    ${o.client ? head("Client / Trading app — the trader experience") + `<table style="width:100%;border-collapse:collapse">${row("Email", esc(o.client.email))}${row("Password", esc(o.client.password))}</table>` : ""}
    ${ends ? `<p style="font-size:12px;color:#9ca3af;margin:14px 0 0">Trial ends ${esc(ends)}.</p>` : ""}
    <p style="font-size:12px;color:#9ca3af;margin:10px 0 0">Reply to this email to go live with your own domain.</p>`);
}

export interface StatementSummary {
  holderName: string;
  periodLabel: string;
  login: string | number;
  type: string;
  balance: string;
  pnl: string;
  pnlPositive: boolean;
  openCount: number;
  deposits: string;
  withdrawals: string;
  pdfFileName: string;
}

export function statementEmail(brand: BrandInfo, s: StatementSummary): string {
  const row = (k: string, v: string, cls = "") =>
    `<tr><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827${cls}">${esc(v)}</td></tr>`;
  return brandedEmail(brand, "Your account statement", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Dear ${esc(s.holderName)}, please find your account statement for <strong>${esc(s.periodLabel)}</strong> attached as a PDF. A summary is shown below.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", s.login + " · " + s.type)}
      ${row("Balance", s.balance)}
      ${row("Closed P/L (period)", s.pnl, s.pnlPositive ? ";color:#16a34a !important" : ";color:#dc2626 !important")}
      ${row("Open (running) trades", String(s.openCount))}
      ${row("Deposits / Withdrawals", s.deposits + " / " + s.withdrawals)}
    </table>
    <div style="display:flex;align-items:center;gap:12px;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:4px 0 20px">
      <div style="width:38px;height:46px;border-radius:6px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none">PDF</div>
      <div><div style="font-size:13px;font-weight:700;color:#111827">${esc(s.pdfFileName)}</div><div style="font-size:11px;color:#9ca3af">Full statement</div></div>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 16px">Figures are indicative. The attached PDF is the full record of trades, financials and requests.</p>`);
}
