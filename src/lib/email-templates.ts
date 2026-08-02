// Shared branded, mobile-responsive HTML email templates.
// Every tenant's brand name, colours and logo are injected at send time so a
// broker's clients never see "CubeX". Footer = brand name + "Finance Department"
// + an automated "do not reply" notice (these are no-reply emails).

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export interface BrandInfo {
  brandName: string;
  companyName?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
}

// Wrap body content in the branded shell (header bar + footer).
export function brandedEmail(brand: BrandInfo, heading: string, bodyHtml: string): string {
  const name = brand.companyName ? `${esc(brand.brandName)} | ${esc(brand.companyName)}` : esc(brand.brandName || "Statement");
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

// Sent to the tenant's contact email when a trial is converted to a paid plan.
export function tenantActiveEmail(brand: BrandInfo, o: { url: string }): string {
  const primary = esc(brand.primaryColor || "#2563eb");
  return brandedEmail(brand, "Your platform is now live 🚀", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Thank you for choosing <strong>${esc(brand.brandName)}</strong>. Your trading platform has been upgraded from trial to a full subscription and is now live.</p>
    <div style="text-align:center;margin:22px 0 18px">
      <a href="${esc(o.url)}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:9px;background:${primary}">Open your platform</a>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">You can now configure your own SMTP, connect a custom domain and onboard real clients. Your invoice will follow separately. Reply to this email anytime for support.</p>`);
}

// Invoice email to the tenant's contact email (platform → tenant billing).
export function invoiceEmail(brand: BrandInfo, inv: { number: string; period: string; plan: string; amount: string; dueAt?: string | null; status?: string }): string {
  const row = (k: string, v: string) => `<tr><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${esc(v)}</td></tr>`;
  const due = inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : "—";
  return brandedEmail(brand, `Invoice ${inv.number}`, `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Please find your <strong>${esc(brand.brandName)}</strong> platform invoice below.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 16px">
      ${row("Invoice #", inv.number)}
      ${row("Period", inv.period)}
      ${row("Plan", inv.plan)}
      ${row("Amount", "$" + inv.amount)}
      ${row("Due date", due)}
      ${inv.status ? row("Status", inv.status) : ""}
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">Reply to this email with any billing questions.</p>`);
}

// Invoice sent FROM the platform (OrbitFxSolution) TO the tenant admin.
// platformName = process.env.APP_NAME, tenantName = tenant's brand.
export function platformInvoiceEmail(
  platformName: string,
  tenantName: string,
  inv: { number: string; period: string; plan: string; amount: string; dueAt?: string | null; status?: string; notes?: string | null },
): string {
  const platform = esc(platformName);
  const row = (k: string, v: string) => `<tr><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${esc(v)}</td></tr>`;
  const due = inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : "—";
  const statusColor = inv.status === "PAID" ? "#16a34a" : inv.status === "OVERDUE" ? "#dc2626" : "#b45309";
  const platformBrand: BrandInfo = { brandName: platformName, primaryColor: "#1a56db", accentColor: "#22c55e", logoUrl: null };
  return brandedEmail(platformBrand, `Invoice ${inv.number}`, `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear <strong>${esc(tenantName)}</strong>, please find your subscription invoice from <strong>${platform}</strong> below.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 16px">
      ${row("Invoice #", inv.number)}
      ${row("Billed To", tenantName)}
      ${row("Period", inv.period)}
      ${row("Plan", inv.plan)}
      ${row("Amount Due", "$" + inv.amount)}
      ${row("Due Date", due)}
      ${inv.status ? `<tr><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">Status</td><td style="padding:9px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:${statusColor}">${esc(inv.status === "PENDING" ? "UNPAID" : inv.status)}</td></tr>` : ""}
      ${inv.notes ? row("Notes", inv.notes) : ""}
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">To pay or query this invoice, reply to this email or contact ${platform} support.</p>`);
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
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Dear ${esc(s.holderName)}, please find your account statement for <strong>${esc(s.periodLabel)}</strong> below.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", s.login + " · " + s.type)}
      ${row("Balance", s.balance)}
      ${row("Closed P/L (period)", s.pnl, s.pnlPositive ? ";color:#16a34a !important" : ";color:#dc2626 !important")}
      ${row("Open (running) trades", String(s.openCount))}
      ${row("Deposits / Withdrawals", s.deposits + " / " + s.withdrawals)}
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 16px">Figures are indicative. The attached PDF contains the full record of trades, financials and requests.</p>`);
}

// ── Transactional trade + account notification emails ──────────────────────

export interface TradeInfo {
  ticket: string | number;
  symbol: string;
  side: string;         // "BUY" | "SELL"
  lots: number;
  openPrice: number;
  closePrice?: number;
  pnl?: number;
  closeReason?: string;
  login: string | number;
  holderName: string;
}

const sideColor = (s: string) => s === "BUY" ? "#16a34a" : "#dc2626";

export function tradeOpenEmail(brand: BrandInfo, t: TradeInfo): string {
  const side = esc(String(t.side).toUpperCase());
  const col = sideColor(side);
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${v}</td></tr>`;
  return brandedEmail(brand, "Trade opened", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(t.holderName)}, a new position has been opened on your account.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", esc(String(t.login)))}
      ${row("Ticket", esc(String(t.ticket)))}
      ${row("Symbol", esc(t.symbol))}
      ${row("Direction", `<span style="color:${col};font-weight:800">${side}</span>`)}
      ${row("Lots", esc(String(t.lots)))}
      ${row("Open Price", esc(String(t.openPrice)))}
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">Log in to your trading account to monitor and manage this position.</p>`);
}

export function tradeCloseEmail(brand: BrandInfo, t: TradeInfo): string {
  const side = esc(String(t.side).toUpperCase());
  const col = sideColor(side);
  const pnl = t.pnl ?? 0;
  const pnlCol = pnl >= 0 ? "#16a34a" : "#dc2626";
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${v}</td></tr>`;
  return brandedEmail(brand, "Trade closed", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(t.holderName)}, a position has been closed on your account.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", esc(String(t.login)))}
      ${row("Ticket", esc(String(t.ticket)))}
      ${row("Symbol", esc(t.symbol))}
      ${row("Direction", `<span style="color:${col};font-weight:800">${side}</span>`)}
      ${row("Lots", esc(String(t.lots)))}
      ${row("Open Price", esc(String(t.openPrice)))}
      ${t.closePrice != null ? row("Close Price", esc(String(t.closePrice))) : ""}
      ${t.closeReason ? row("Reason", esc(t.closeReason)) : ""}
      ${row("P / L", `<span style="color:${pnlCol};font-weight:800">${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}</span>`)}
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">Log in to your account to view your updated balance and history.</p>`);
}

export function depositWithdrawalEmail(brand: BrandInfo, o: {
  holderName: string;
  kind: "DEPOSIT" | "WITHDRAWAL";
  amount: string | number;
  method?: string | null;
  status: "APPROVED" | "REJECTED";
  login: string | number;
}): string {
  const approved = o.status === "APPROVED";
  const kind = o.kind === "DEPOSIT" ? "Deposit" : "Withdrawal";
  const statusCol = approved ? "#16a34a" : "#dc2626";
  const statusLabel = approved ? "Approved ✓" : "Rejected";
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${v}</td></tr>`;
  return brandedEmail(brand, `${kind} ${statusLabel}`, `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(o.holderName)}, your ${kind.toLowerCase()} request has been reviewed.</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", esc(String(o.login)))}
      ${row("Type", esc(kind))}
      ${row("Amount", `$${esc(String(o.amount))}`)}
      ${o.method ? row("Method", esc(o.method)) : ""}
      ${row("Status", `<span style="color:${statusCol};font-weight:800">${esc(statusLabel)}</span>`)}
    </table>
    ${approved
      ? `<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Your account balance has been ${o.kind === "DEPOSIT" ? "credited" : "debited"} accordingly.</p>`
      : `<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">If you have questions about this decision, please contact support.</p>`}
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">Log in to your account to view your updated balance.</p>`);
}

export function marginCallEmail(brand: BrandInfo, o: {
  holderName: string;
  login: string | number;
  marginLevel: number;
  equity: number;
  usedMargin: number;
}): string {
  const levelCol = o.marginLevel < 100 ? "#dc2626" : "#d97706";
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${v}</td></tr>`;
  return brandedEmail(brand, "⚠️ Margin Call Warning", `
    <div style="background:#fef3cd;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;margin:0 0 18px">
      <strong style="color:#92400e;font-size:14px">⚠️ Your margin level is critically low.</strong>
      <p style="color:#92400e;font-size:13px;margin:6px 0 0">Positions may be automatically liquidated to protect your account if the margin level falls below the minimum threshold. Please add funds or reduce your exposure.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", esc(String(o.login)))}
      ${row("Margin Level", `<span style="color:${levelCol};font-weight:800">${o.marginLevel.toFixed(1)}%</span>`)}
      ${row("Equity", `$${o.equity.toFixed(2)}`)}
      ${row("Used Margin", `$${o.usedMargin.toFixed(2)}`)}
    </table>
    <p style="font-size:13px;color:#4b5563;margin:0 0 14px">To avoid automatic liquidation, you can: <strong>deposit additional funds</strong> or <strong>close some open positions</strong>.</p>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">This is an automated alert. Log in immediately to manage your account.</p>`);
}

export function priceAlertEmail(brand: BrandInfo, o: {
  holderName: string;
  symbol: string;
  condition: "ABOVE" | "BELOW";
  targetPrice: string | number;
  note?: string | null;
}): string {
  const condLabel = o.condition === "ABOVE" ? "risen above" : "fallen below";
  const col = o.condition === "ABOVE" ? "#16a34a" : "#dc2626";
  return brandedEmail(brand, `Price Alert: ${esc(o.symbol)}`, `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(o.holderName)}, your price alert for <strong>${esc(o.symbol)}</strong> has triggered.</p>
    <div style="text-align:center;margin:20px 0">
      <div style="display:inline-block;background:#f3f4f6;border-radius:12px;padding:16px 28px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:4px">${esc(o.symbol)} has <strong style="color:${col}">${condLabel}</strong></div>
        <div style="font-size:32px;font-weight:800;color:${col}">${esc(String(o.targetPrice))}</div>
      </div>
    </div>
    ${o.note ? `<p style="font-size:14px;color:#4b5563;margin:0 0 14px">Note: ${esc(o.note)}</p>` : ""}
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">This alert has been automatically removed. Log in to set new alerts or take action.</p>`);
}

export function kycStatusEmail(brand: BrandInfo, o: {
  holderName: string;
  status: "APPROVED" | "REJECTED";
  note?: string | null;
}): string {
  const approved = o.status === "APPROVED";
  const col = approved ? "#16a34a" : "#dc2626";
  const heading = approved ? "KYC Verified ✓" : "KYC Review Update";
  return brandedEmail(brand, heading, `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(o.holderName)},</p>
    ${approved
      ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px 16px;margin:0 0 18px">
           <strong style="color:#15803d;font-size:15px">✓ Your identity has been verified.</strong>
           <p style="color:#166534;font-size:13px;margin:6px 0 0">You can now deposit funds and trade on your live account.</p>
         </div>`
      : `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;margin:0 0 18px">
           <strong style="color:#991b1b;font-size:15px">Your KYC documents were not accepted.</strong>
           ${o.note ? `<p style="color:#991b1b;font-size:13px;margin:6px 0 0">Reason: ${esc(o.note)}</p>` : ""}
           <p style="color:#991b1b;font-size:13px;margin:6px 0 0">Please log in and upload clear, valid documents to complete your verification.</p>
         </div>`}
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">Log in to your account to view your KYC status${approved ? " and start trading" : " and re-submit your documents"}.</p>`);
}

export function stopOutEmail(brand: BrandInfo, o: {
  holderName: string;
  login: string | number;
  symbol: string;
  side: string;
  lots: number;
  openPrice: number;
  closePrice: number;
  pnl: number;
  marginLevel: number;
}): string {
  const pnlCol = o.pnl >= 0 ? "#16a34a" : "#dc2626";
  const pnlStr = (o.pnl >= 0 ? "+" : "") + "$" + Math.abs(o.pnl).toFixed(2);
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:13px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;font-size:13px;color:#111827">${v}</td></tr>`;
  return brandedEmail(brand, "⛔ Stop-Out Executed", `
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 14px">Dear ${esc(o.holderName)},</p>
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;margin:0 0 18px">
      <strong style="color:#991b1b;font-size:14px">⛔ A position on your account was automatically closed.</strong>
      <p style="color:#991b1b;font-size:13px;margin:6px 0 0">Your margin level dropped to <strong>${o.marginLevel.toFixed(1)}%</strong>, triggering a stop-out. The largest losing position was closed to protect your remaining balance.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">
      ${row("Account", esc(String(o.login)))}
      ${row("Symbol", esc(o.symbol))}
      ${row("Direction", esc(o.side))}
      ${row("Volume", o.lots.toFixed(2) + " lots")}
      ${row("Open Price", o.openPrice.toFixed(5))}
      ${row("Close Price", o.closePrice.toFixed(5))}
      ${row("P &amp; L", `<span style="color:${pnlCol};font-weight:800">${esc(pnlStr)}</span>`)}
      ${row("Margin Level at Close", `<span style="color:#dc2626;font-weight:800">${o.marginLevel.toFixed(1)}%</span>`)}
    </table>
    <p style="font-size:13px;color:#4b5563;margin:0 0 14px">To prevent future stop-outs: <strong>deposit additional funds</strong> to increase your free margin, or <strong>reduce position sizes</strong> to lower your margin usage.</p>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">This is an automated notification. Log in to your account to review your open positions and current balance.</p>`);
}
