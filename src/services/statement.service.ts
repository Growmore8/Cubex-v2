import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { sendTenantMail, noReplyAddress } from "@/lib/mailer";
import { statementEmail, type BrandInfo, type StatementSummary } from "@/lib/email-templates";
import { codeForCountry } from "@/config/countries";

function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dt(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

export interface LoadStatementOpts {
  tenantId: string;
  accountId: string;
  userId?: string;   // when set, also scope to this client (security)
  since?: Date;       // when set, closed-trades / financials / requests are limited to >= since
}

export async function loadStatement(opts: LoadStatementOpts) {
  const where: any = { id: opts.accountId, tenantId: opts.tenantId, deactivated: false };
  if (opts.userId) where.userId = opts.userId;
  const account = await prisma.account.findFirst({
    where,
    include: {
      user: { select: { name: true, email: true } },
      trades: { orderBy: { openedAt: "desc" } },
      history: { where: opts.since ? { closedAt: { gte: opts.since } } : undefined, orderBy: { closedAt: "desc" }, take: 500 },
      financials: { where: opts.since ? { appliedAt: { gte: opts.since } } : undefined, orderBy: { appliedAt: "desc" }, take: 500 },
    },
  });
  if (!account) return null;
  const requests = await prisma.paymentRequest.findMany({
    where: { accountId: account.id, ...(opts.since ? { createdAt: { gte: opts.since } } : {}) },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  return { account, tenant: tenant as any, requests };
}

type StatementData = NonNullable<Awaited<ReturnType<typeof loadStatement>>>;

function brandOf(t: any): BrandInfo {
  return { brandName: t?.brandName || t?.name || "Statement", primaryColor: t?.primaryColor, accentColor: t?.accentColor, logoUrl: t?.logoUrl };
}

// ── PDF generation (pdfkit — built-in fonts, no Chromium) ──
export function buildStatementPdf(data: StatementData, periodLabel: string): Promise<Buffer> {
  const { account, tenant, requests } = data;
  const t: any = tenant || {};
  const brand = brandOf(t);
  const accent = brand.primaryColor || "#2563eb";

  const deposit = Number(account.deposit), withdrawal = Number(account.withdrawal);
  const credit = Number(account.credit), bonus = Number(account.bonus), pnl = Number(account.pnl);
  const balance = deposit - withdrawal + credit + bonus + pnl;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const left = 40;
      const totalW = doc.page.width - 80;

      // Header
      doc.fillColor(accent).font("Helvetica-Bold").fontSize(20).text(brand.brandName, left, 42);
      if (t.slogan) doc.fillColor("#6b7280").font("Helvetica").fontSize(9).text(String(t.slogan), left, 66);
      doc.fillColor("#6b7280").font("Helvetica").fontSize(9)
        .text("ACCOUNT STATEMENT", left, 44, { width: totalW, align: "right" })
        .text(periodLabel, left, 58, { width: totalW, align: "right" })
        .text("Generated " + dt(new Date()), left, 72, { width: totalW, align: "right" });
      doc.moveTo(left, 92).lineTo(left + totalW, 92).strokeColor(accent).lineWidth(2).stroke();

      let y = 104;
      const heading = (label: string) => {
        if (y > doc.page.height - 90) { doc.addPage(); y = 50; }
        doc.fillColor("#374151").font("Helvetica-Bold").fontSize(11).text(label, left, y);
        y += 18;
      };
      const kv = (pairs: [string, string, string?][]) => {
        const colW = totalW / 3;
        pairs.forEach((p, i) => {
          const col = i % 3; const cx = left + col * colW;
          if (col === 0 && i > 0) y += 30;
          doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(p[0], cx, y);
          doc.fillColor(p[2] || "#111827").font("Helvetica-Bold").fontSize(12).text(p[1], cx, y + 10);
        });
        y += 34;
      };

      const table = (cols: { label: string; w: number; align?: "left" | "right" }[], rows: string[][], emptyMsg: string) => {
        const headH = 18, rowH = 15, pad = 4;
        if (y + headH + rowH > doc.page.height - 50) { doc.addPage(); y = 50; }
        doc.save().rect(left, y, totalW, headH).fill("#f3f4f6").restore();
        let x = left;
        doc.fillColor("#374151").font("Helvetica-Bold").fontSize(7.5);
        cols.forEach((c) => { doc.text(c.label, x + pad, y + 5.5, { width: c.w - 2 * pad, align: c.align || "left", lineBreak: false }); x += c.w; });
        y += headH;
        if (!rows.length) {
          doc.fillColor("#9ca3af").font("Helvetica").fontSize(8).text(emptyMsg, left + pad, y + 4);
          y += rowH + 4; return;
        }
        doc.font("Helvetica").fontSize(7.5);
        for (const r of rows) {
          if (y + rowH > doc.page.height - 45) { doc.addPage(); y = 50; }
          x = left;
          r.forEach((cell, i) => {
            const c = cols[i];
            doc.fillColor(i === 0 ? "#111827" : "#1f2937").text(cell, x + pad, y + 3.5, { width: c.w - 2 * pad, align: c.align || "left", lineBreak: false });
            x += c.w;
          });
          doc.moveTo(left, y + rowH).lineTo(left + totalW, y + rowH).strokeColor("#eef1f5").lineWidth(0.5).stroke();
          y += rowH;
        }
        y += 6;
      };

      heading("Account");
      kv([
        ["Account", String(account.login)],
        ["Holder", account.name || account.user?.name || ""],
        ["Type / Leverage", `${account.type} · 1:${account.leverage}`],
      ]);

      heading("Balance Summary");
      kv([
        ["Deposit", money(deposit), "#16a34a"],
        ["Withdrawal", money(withdrawal), "#dc2626"],
        ["Closed P/L", money(pnl), pnl >= 0 ? "#16a34a" : "#dc2626"],
        ["Credit", money(credit)],
        ["Bonus", money(bonus)],
        ["Balance", money(balance)],
      ]);
      y += 4;

      heading("Running Trades");
      table(
        [{ label: "Ticket", w: 70 }, { label: "Symbol", w: 70 }, { label: "Side", w: 45 }, { label: "Lots", w: 50, align: "right" }, { label: "Open", w: 70, align: "right" }, { label: "SL", w: 60, align: "right" }, { label: "TP", w: 60, align: "right" }, { label: "Opened", w: 90 }],
        account.trades.map((o) => [o.ticket.toString(), o.symbol, o.type, Number(o.lots).toFixed(2), String(Number(o.openPrice)), Number(o.sl) ? String(Number(o.sl)) : "—", Number(o.tp) ? String(Number(o.tp)) : "—", dt(o.openedAt)]),
        "No open trades.",
      );

      heading("Closed Trades");
      table(
        [{ label: "Ticket", w: 64 }, { label: "Symbol", w: 60 }, { label: "Side", w: 38 }, { label: "Lots", w: 42, align: "right" }, { label: "Open", w: 58, align: "right" }, { label: "Close", w: 58, align: "right" }, { label: "P/L", w: 62, align: "right" }, { label: "Closed", w: 93 }],
        account.history.map((h) => [h.ticket.toString(), h.symbol, h.side, Number(h.lots).toFixed(2), String(Number(h.openPrice)), String(Number(h.closePrice)), money(Number(h.pnl)), dt(h.closedAt)]),
        "No closed trades in this period.",
      );

      heading("Deposit / Withdrawal Requests");
      table(
        [{ label: "Type", w: 80 }, { label: "Amount", w: 80, align: "right" }, { label: "Method", w: 100 }, { label: "Status", w: 90 }, { label: "Date", w: 125 }],
        requests.map((r) => [r.kind, money(Number(r.amount)), r.method || "", r.status, dt(r.createdAt)]),
        "No requests in this period.",
      );

      heading("Financial History");
      table(
        [{ label: "Type", w: 90 }, { label: "Amount", w: 80, align: "right" }, { label: "Description", w: 180 }, { label: "Date", w: 125 }],
        account.financials.map((f) => [f.type, money(Number(f.amount)), f.description || "", dt(f.appliedAt)]),
        "No transactions in this period.",
      );

      if (y > doc.page.height - 70) { doc.addPage(); y = 50; }
      y = Math.max(y, doc.page.height - 60);
      doc.moveTo(left, y).lineTo(left + totalW, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      doc.fillColor("#9ca3af").font("Helvetica").fontSize(8)
        .text(`${brand.brandName} — Finance Department`, left, y + 6, { width: totalW, align: "center" })
        .text("This statement was generated automatically. Figures are indicative.", left, y + 18, { width: totalW, align: "center" });

      doc.end();
    } catch (e) { reject(e); }
  });
}

function summaryOf(data: StatementData, periodLabel: string, pdfFileName: string): StatementSummary {
  const a = data.account;
  const deposit = Number(a.deposit), withdrawal = Number(a.withdrawal);
  const balance = deposit - withdrawal + Number(a.credit) + Number(a.bonus) + Number(a.pnl);
  const periodPnl = a.history.reduce((s, h) => s + Number(h.pnl), 0);
  return {
    holderName: a.name || a.user?.name || "Trader",
    periodLabel,
    login: a.login,
    type: a.type,
    balance: money(balance),
    pnl: money(periodPnl),
    pnlPositive: periodPnl >= 0,
    openCount: a.trades.length,
    deposits: money(deposit),
    withdrawals: money(withdrawal),
    pdfFileName,
  };
}

export interface SendStatementResult { ok: boolean; to?: string; error?: string }

// Build + email a statement PDF for one account (no-reply, from the tenant's SMTP).
export async function sendStatementEmail(opts: { tenantId: string; accountId: string; userId?: string; to?: string; since?: Date; periodLabel?: string }): Promise<SendStatementResult> {
  const data = await loadStatement({ tenantId: opts.tenantId, accountId: opts.accountId, userId: opts.userId, since: opts.since });
  if (!data) return { ok: false, error: "Account not found" };
  const t: any = data.tenant;
  if (!t?.smtpEmail || !t?.smtpPassword) return { ok: false, error: "Email is not configured for this broker." };
  const to = (opts.to || data.account.user?.email || "").trim();
  if (!to) return { ok: false, error: "No recipient email on file." };

  const brand = brandOf(t);
  const periodLabel = opts.periodLabel || "Full account history";
  const pdfFileName = `Statement-${data.account.login}-${new Date().toISOString().slice(0, 10)}.pdf`;
  const pdf = await buildStatementPdf(data, periodLabel);
  const summary = summaryOf(data, periodLabel, pdfFileName);

  await sendTenantMail(t.smtpEmail, t.smtpPassword, {
    to,
    subject: `Account statement ${data.account.login} — ${brand.brandName}`,
    fromName: brand.brandName,
    replyTo: noReplyAddress(t.smtpEmail),
    html: statementEmail(brand, summary),
    attachments: [{ filename: pdfFileName, content: pdf, contentType: "application/pdf" }],
  }, t.smtpHost);
  return { ok: true, to };
}

// ── Periodic (weekly / monthly) batch, honouring each client's local time ──

// ISO alpha-2 country code → representative IANA timezone. Multi-timezone countries
// use their capital / most-populous zone. Falls back to UTC for unknown codes.
const CODE_TZ: Record<string, string> = {
  AD: "Europe/Andorra", AE: "Asia/Dubai", AF: "Asia/Kabul", AG: "America/Antigua", AI: "America/Anguilla",
  AL: "Europe/Tirane", AM: "Asia/Yerevan", AO: "Africa/Luanda", AR: "America/Argentina/Buenos_Aires",
  AT: "Europe/Vienna", AU: "Australia/Sydney", AW: "America/Aruba", AZ: "Asia/Baku", BA: "Europe/Sarajevo",
  BB: "America/Barbados", BD: "Asia/Dhaka", BE: "Europe/Brussels", BF: "Africa/Ouagadougou", BG: "Europe/Sofia",
  BH: "Asia/Bahrain", BI: "Africa/Bujumbura", BJ: "Africa/Porto-Novo", BM: "Atlantic/Bermuda", BN: "Asia/Brunei",
  BO: "America/La_Paz", BR: "America/Sao_Paulo", BS: "America/Nassau", BT: "Asia/Thimphu", BW: "Africa/Gaborone",
  BY: "Europe/Minsk", BZ: "America/Belize", CA: "America/Toronto", CD: "Africa/Kinshasa", CF: "Africa/Bangui",
  CG: "Africa/Brazzaville", CH: "Europe/Zurich", CI: "Africa/Abidjan", CL: "America/Santiago", CM: "Africa/Douala",
  CN: "Asia/Shanghai", CO: "America/Bogota", CR: "America/Costa_Rica", CU: "America/Havana", CV: "Atlantic/Cape_Verde",
  CY: "Asia/Nicosia", CZ: "Europe/Prague", DE: "Europe/Berlin", DJ: "Africa/Djibouti", DK: "Europe/Copenhagen",
  DM: "America/Dominica", DO: "America/Santo_Domingo", DZ: "Africa/Algiers", EC: "America/Guayaquil",
  EE: "Europe/Tallinn", EG: "Africa/Cairo", ER: "Africa/Asmara", ES: "Europe/Madrid", ET: "Africa/Addis_Ababa",
  FI: "Europe/Helsinki", FJ: "Pacific/Fiji", FM: "Pacific/Pohnpei", FO: "Atlantic/Faroe", FR: "Europe/Paris",
  GA: "Africa/Libreville", GB: "Europe/London", GD: "America/Grenada", GE: "Asia/Tbilisi", GH: "Africa/Accra",
  GI: "Europe/Gibraltar", GM: "Africa/Banjul", GN: "Africa/Conakry", GQ: "Africa/Malabo", GR: "Europe/Athens",
  GT: "America/Guatemala", GW: "Africa/Bissau", GY: "America/Guyana", HK: "Asia/Hong_Kong", HN: "America/Tegucigalpa",
  HR: "Europe/Zagreb", HT: "America/Port-au-Prince", HU: "Europe/Budapest", ID: "Asia/Jakarta", IE: "Europe/Dublin",
  IL: "Asia/Jerusalem", IN: "Asia/Kolkata", IQ: "Asia/Baghdad", IR: "Asia/Tehran", IS: "Atlantic/Reykjavik",
  IT: "Europe/Rome", JM: "America/Jamaica", JO: "Asia/Amman", JP: "Asia/Tokyo", KE: "Africa/Nairobi",
  KG: "Asia/Bishkek", KH: "Asia/Phnom_Penh", KM: "Indian/Comoro", KN: "America/St_Kitts", KP: "Asia/Pyongyang",
  KR: "Asia/Seoul", KW: "Asia/Kuwait", KY: "America/Cayman", KZ: "Asia/Almaty", LA: "Asia/Vientiane",
  LB: "Asia/Beirut", LC: "America/St_Lucia", LI: "Europe/Vaduz", LK: "Asia/Colombo", LR: "Africa/Monrovia",
  LS: "Africa/Maseru", LT: "Europe/Vilnius", LU: "Europe/Luxembourg", LV: "Europe/Riga", LY: "Africa/Tripoli",
  MA: "Africa/Casablanca", MC: "Europe/Monaco", MD: "Europe/Chisinau", ME: "Europe/Podgorica", MG: "Indian/Antananarivo",
  MK: "Europe/Skopje", ML: "Africa/Bamako", MM: "Asia/Yangon", MN: "Asia/Ulaanbaatar", MO: "Asia/Macau",
  MR: "Africa/Nouakchott", MT: "Europe/Malta", MU: "Indian/Mauritius", MV: "Indian/Maldives", MW: "Africa/Blantyre",
  MX: "America/Mexico_City", MY: "Asia/Kuala_Lumpur", MZ: "Africa/Maputo", NA: "Africa/Windhoek", NE: "Africa/Niamey",
  NG: "Africa/Lagos", NI: "America/Managua", NL: "Europe/Amsterdam", NO: "Europe/Oslo", NP: "Asia/Kathmandu",
  NZ: "Pacific/Auckland", OM: "Asia/Muscat", PA: "America/Panama", PE: "America/Lima", PG: "Pacific/Port_Moresby",
  PH: "Asia/Manila", PK: "Asia/Karachi", PL: "Europe/Warsaw", PR: "America/Puerto_Rico", PS: "Asia/Gaza",
  PT: "Europe/Lisbon", PY: "America/Asuncion", QA: "Asia/Qatar", RO: "Europe/Bucharest", RS: "Europe/Belgrade",
  RU: "Europe/Moscow", RW: "Africa/Kigali", SA: "Asia/Riyadh", SB: "Pacific/Guadalcanal", SC: "Indian/Mahe",
  SD: "Africa/Khartoum", SE: "Europe/Stockholm", SG: "Asia/Singapore", SI: "Europe/Ljubljana", SK: "Europe/Bratislava",
  SL: "Africa/Freetown", SM: "Europe/San_Marino", SN: "Africa/Dakar", SO: "Africa/Mogadishu", SR: "America/Paramaribo",
  SS: "Africa/Juba", ST: "Africa/Sao_Tome", SV: "America/El_Salvador", SY: "Asia/Damascus", SZ: "Africa/Mbabane",
  TC: "America/Grand_Turk", TD: "Africa/Ndjamena", TG: "Africa/Lome", TH: "Asia/Bangkok", TJ: "Asia/Dushanbe",
  TL: "Asia/Dili", TM: "Asia/Ashgabat", TN: "Africa/Tunis", TO: "Pacific/Tongatapu", TR: "Europe/Istanbul",
  TT: "America/Port_of_Spain", TW: "Asia/Taipei", TZ: "Africa/Dar_es_Salaam", UA: "Europe/Kyiv", UG: "Africa/Kampala",
  US: "America/New_York", UY: "America/Montevideo", UZ: "Asia/Tashkent", VC: "America/St_Vincent", VE: "America/Caracas",
  VN: "Asia/Ho_Chi_Minh", VU: "Pacific/Efate", WS: "Pacific/Apia", YE: "Asia/Aden", ZA: "Africa/Johannesburg",
  ZM: "Africa/Lusaka", ZW: "Africa/Harare",
};
function tzFor(country?: string | null): string {
  if (!country) return "UTC";
  const c = country.trim();
  // Stored value is normally the country NAME; older records may hold an ISO code.
  const code = (/^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : codeForCountry(c)) || "";
  return CODE_TZ[code] || "UTC";
}
// Local weekday (0=Sun..6=Sat), day-of-month, and hour (0-23) for a timezone.
function localNow(tz: string): { weekday: number; day: number; hour: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", hour12: false });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
  return { weekday: wmap[parts.weekday] ?? 0, day: parseInt(parts.day, 10), hour, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

const SEND_HOUR = Number(process.env.REPORT_HOUR || 6); // local hour to send (default 06:00)
const sentKeys = new Set<string>(); // dedup within process: `${accountId}:${period}:${dateKey}`

// Called hourly. For each client account, if it's locally Monday/1st at SEND_HOUR,
// email that account's weekly/monthly statement once. Returns how many were sent.
export async function runStatementCron(): Promise<{ weekly: number; monthly: number }> {
  if (sentKeys.size > 50000) sentKeys.clear();
  const tenants = await prisma.tenant.findMany({ where: { NOT: { smtpEmail: null } } });
  let weekly = 0, monthly = 0;
  for (const t of tenants as any[]) {
    if (!t.smtpEmail || !t.smtpPassword) continue;
    const accounts = await prisma.account.findMany({
      where: { tenantId: t.id, deactivated: false, user: { role: "CLIENT" } },
      include: { user: { select: { email: true } } },
    });
    for (const a of accounts as any[]) {
      if (!a.user?.email) continue;
      const tz = tzFor(a.country);
      const { weekday, day, hour } = localNow(tz);
      if (hour !== SEND_HOUR) continue;
      const { dateKey } = localNow(tz);
      // Monthly takes precedence on the 1st so a client never gets two emails the same hour.
      if (day === 1) {
        const key = `${a.id}:monthly:${dateKey}`;
        if (!sentKeys.has(key)) {
          sentKeys.add(key);
          const since = new Date(Date.now() - 31 * 86400000);
          const r = await sendStatementEmail({ tenantId: t.id, accountId: a.id, since, periodLabel: "Monthly statement" }).catch((e) => ({ ok: false, error: String(e) }));
          if (r.ok) monthly++;
        }
        continue;
      }
      if (weekday === 1) {
        const key = `${a.id}:weekly:${dateKey}`;
        if (!sentKeys.has(key)) {
          sentKeys.add(key);
          const since = new Date(Date.now() - 7 * 86400000);
          const r = await sendStatementEmail({ tenantId: t.id, accountId: a.id, since, periodLabel: "Weekly statement" }).catch((e) => ({ ok: false, error: String(e) }));
          if (r.ok) weekly++;
        }
      }
    }
  }
  return { weekly, monthly };
}
