import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { sendTenantMail, noReplyAddress } from "@/lib/mailer";
import { statementEmail, type BrandInfo, type StatementSummary } from "@/lib/email-templates";
import { codeForCountry } from "@/config/countries";
import { pnlFor } from "@/lib/trademath";
import { runningContext } from "@/lib/livePrices";

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
  since?: Date;       // closed-trades / financials / requests limited to >= since
  until?: Date;       // ... and <= until (together they form a date range)
}

function rangeFilter(since?: Date, until?: Date): any {
  if (!since && !until) return undefined;
  const r: any = {};
  if (since) r.gte = since;
  if (until) r.lte = until;
  return r;
}

export async function loadStatement(opts: LoadStatementOpts) {
  const where: any = { id: opts.accountId, tenantId: opts.tenantId, deactivated: false };
  if (opts.userId) where.userId = opts.userId;
  const closedRange = rangeFilter(opts.since, opts.until);
  const appliedRange = rangeFilter(opts.since, opts.until);
  const createdRange = rangeFilter(opts.since, opts.until);
  const account = await prisma.account.findFirst({
    where,
    include: {
      user: { select: { name: true, email: true } },
      trades: { orderBy: { openedAt: "desc" } },
      history: { where: closedRange ? { closedAt: closedRange } : undefined, orderBy: { closedAt: "desc" }, take: 500 },
      financials: { where: appliedRange ? { appliedAt: appliedRange } : undefined, orderBy: { appliedAt: "desc" }, take: 500 },
    },
  });
  if (!account) return null;
  const requests = await prisma.paymentRequest.findMany({
    where: { accountId: account.id, ...(createdRange ? { createdAt: createdRange } : {}) },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  // Live prices + per-symbol category for the open trades (running-trade P&L).
  const { prices, catOf } = await runningContext(opts.tenantId, account.trades.map((t) => t.symbol));
  return { account, tenant: tenant as any, requests, prices, catOf };
}

type StatementData = NonNullable<Awaited<ReturnType<typeof loadStatement>>>;

// Resolve a statement date range + human label from a preset (week/month/year/
// custom/all) — shared by the client, admin and SuperAdmin statement endpoints.
export function statementRange(preset?: string, from?: string, to?: string): { since?: Date; until?: Date; label: string } {
  const now = new Date();
  const day = 86400000;
  if (preset === "week") return { since: new Date(now.getTime() - 7 * day), until: now, label: "Last 7 Days" };
  if (preset === "month") return { since: new Date(now.getTime() - 30 * day), until: now, label: "Last 30 Days" };
  if (preset === "year") return { since: new Date(now.getTime() - 365 * day), until: now, label: "Last 12 Months" };
  if (preset === "custom" && (from || to)) {
    const since = from ? new Date(from) : undefined;
    const until = to ? new Date(to + "T23:59:59") : undefined;
    const f = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "…");
    return { since, until, label: `${f(since)} – ${f(until)}` };
  }
  return { label: "All Time" };
}

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

      const left = 36;
      const totalW = doc.page.width - 72;
      const pageBottom = doc.page.height - 46;

      // ── Header band ──
      doc.save().rect(0, 0, doc.page.width, 60).fill(accent).restore();
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17).text(brand.brandName, left, 16, { width: totalW * 0.6, lineBreak: false });
      if (t.slogan) { doc.fillOpacity(0.85).font("Helvetica").fontSize(8).text(String(t.slogan), left, 38, { width: totalW * 0.6, lineBreak: false }); doc.fillOpacity(1); }
      doc.fillColor("#ffffff").font("Helvetica").fontSize(8)
        .text("ACCOUNT STATEMENT", left, 15, { width: totalW, align: "right" })
        .text(periodLabel, left, 28, { width: totalW, align: "right" })
        .text("Generated " + dt(new Date()), left, 41, { width: totalW, align: "right" });

      let y = 70;

      // ── Client identity + statement period ──
      const holderName = account.name || account.user?.name || "";
      const holderEmail = account.user?.email || (account as any).email || "";
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9).text(holderName, left, y, { width: totalW * 0.62, lineBreak: false });
      if (holderEmail) doc.fillColor("#64748b").font("Helvetica").fontSize(7.8).text(holderEmail, left, y + 11, { width: totalW * 0.62, lineBreak: false });
      doc.fillColor("#475569").font("Helvetica-Bold").fontSize(8).text("Statement Period", left, y, { width: totalW, align: "right" });
      doc.fillColor("#64748b").font("Helvetica").fontSize(7.8).text(periodLabel, left, y + 11, { width: totalW, align: "right" });
      y += 26;

      // ── Summary cards ──
      const cards: [string, string, string?][] = [
        ["Account", String(account.login)],
        ["Type / Leverage", `${account.type}  1:${account.leverage}`],
        ["Holder", account.name || account.user?.name || ""],
        ["Balance", money(balance)],
        ["Closed P/L", money(pnl), pnl >= 0 ? "#16a34a" : "#dc2626"],
        ["Deposit", money(deposit), "#16a34a"],
        ["Withdrawal", money(withdrawal), "#dc2626"],
        ["Credit + Bonus", money(credit + bonus)],
      ];
      const perRow = 4, cardW = totalW / perRow, cardH = 36, cardGap = 6;
      cards.forEach((c, i) => {
        const col = i % perRow, row = Math.floor(i / perRow);
        const cx = left + col * cardW, cy = y + row * (cardH + cardGap);
        doc.save().roundedRect(cx, cy, cardW - cardGap, cardH, 4).fill("#f8fafc").restore();
        doc.roundedRect(cx, cy, cardW - cardGap, cardH, 4).lineWidth(0.5).stroke("#e5e7eb");
        doc.fillColor("#64748b").font("Helvetica").fontSize(6.8).text(String(c[0]).toUpperCase(), cx + 7, cy + 7, { width: cardW - cardGap - 12, lineBreak: false });
        doc.fillColor(c[2] || "#0f172a").font("Helvetica-Bold").fontSize(10.5).text(c[1], cx + 7, cy + 17, { width: cardW - cardGap - 12, lineBreak: false });
      });
      y += Math.ceil(cards.length / perRow) * (cardH + cardGap) + 4;

      const heading = (label: string) => {
        if (y > pageBottom - 36) { doc.addPage(); y = 46; }
        doc.fillColor(accent).font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), left, y);
        doc.moveTo(left, y + 12).lineTo(left + totalW, y + 12).lineWidth(0.7).stroke("#e5e7eb");
        y += 17;
      };

      const table = (cols: { label: string; w: number; align?: "left" | "right" }[], rows: string[][], emptyMsg: string) => {
        const headH = 14, rowH = 13, pad = 4;
        if (y + headH + rowH > pageBottom) { doc.addPage(); y = 46; }
        doc.save().rect(left, y, totalW, headH).fill("#eef2f7").restore();
        let x = left;
        doc.fillColor("#475569").font("Helvetica-Bold").fontSize(6.8);
        cols.forEach((c) => { doc.text(c.label.toUpperCase(), x + pad, y + 4.5, { width: c.w - 2 * pad, align: c.align || "left", lineBreak: false }); x += c.w; });
        y += headH;
        if (!rows.length) {
          doc.fillColor("#9ca3af").font("Helvetica-Oblique").fontSize(7.5).text(emptyMsg, left + pad, y + 3);
          y += rowH; return;
        }
        doc.font("Helvetica").fontSize(7.5);
        rows.forEach((rw, ri) => {
          if (y + rowH > pageBottom) { doc.addPage(); y = 46; }
          if (ri % 2 === 1) doc.save().rect(left, y, totalW, rowH).fill("#fafbfc").restore();
          x = left;
          rw.forEach((cell, i) => { const c = cols[i]; doc.fillColor(i === 0 ? "#0f172a" : "#334155").text(cell, x + pad, y + 3, { width: c.w - 2 * pad, align: c.align || "left", lineBreak: false }); x += c.w; });
          y += rowH;
        });
        doc.moveTo(left, y).lineTo(left + totalW, y).lineWidth(0.5).stroke("#e5e7eb");
        y += 8;
      };

      const prices = data.prices || {};
      const catOf = data.catOf || {};
      const runPnlOf = (o: any): number | null => {
        const cur = prices[o.symbol];
        if (cur == null) return null;
        return pnlFor(o.symbol, o.type, Number(o.openPrice), cur, Number(o.lots), catOf[o.symbol]);
      };
      const floating = account.trades.reduce((s, o) => s + (runPnlOf(o) || 0), 0);

      heading(`Running Trades${account.trades.length ? `  —  Floating P/L ${money(floating)}` : ""}`);
      table(
        [{ label: "Ticket", w: 52 }, { label: "Symbol", w: 52 }, { label: "Side", w: 32 }, { label: "Lots", w: 36, align: "right" }, { label: "Open", w: 54, align: "right" }, { label: "Current", w: 54, align: "right" }, { label: "SL", w: 48, align: "right" }, { label: "TP", w: 48, align: "right" }, { label: "P/L", w: 55, align: "right" }, { label: "Opened", w: 88 }],
        account.trades.map((o) => {
          const cur = prices[o.symbol];
          const pl = runPnlOf(o);
          return [o.ticket.toString(), o.symbol, o.type, Number(o.lots).toFixed(2), String(Number(o.openPrice)), cur != null ? String(cur) : "—", Number(o.sl) ? String(Number(o.sl)) : "—", Number(o.tp) ? String(Number(o.tp)) : "—", pl != null ? money(pl) : "—", dt(o.openedAt)];
        }),
        "No open trades.",
      );

      heading("Closed Trades");
      table(
        [{ label: "Ticket", w: 52 }, { label: "Symbol", w: 50 }, { label: "Side", w: 30 }, { label: "Lots", w: 34, align: "right" }, { label: "Open", w: 46, align: "right" }, { label: "Close", w: 46, align: "right" }, { label: "P/L", w: 52, align: "right" }, { label: "Opened", w: 82 }, { label: "Closed", w: 82 }],
        account.history.map((h) => [h.ticket.toString(), h.symbol, h.side, Number(h.lots).toFixed(2), String(Number(h.openPrice)), String(Number(h.closePrice)), money(Number(h.pnl)), dt((h as any).openedAt), dt(h.closedAt)]),
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

      if (y + 32 > pageBottom) { doc.addPage(); y = 46; }
      y += 4;
      doc.moveTo(left, y).lineTo(left + totalW, y).lineWidth(0.5).stroke("#e5e7eb");
      doc.fillColor("#94a3b8").font("Helvetica").fontSize(7.5)
        .text(`${brand.brandName} — Finance Department`, left, y + 6, { width: totalW, align: "center" })
        .text("This statement was generated automatically. Figures are indicative.", left, y + 17, { width: totalW, align: "center" });

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
export async function sendStatementEmail(opts: { tenantId: string; accountId: string; userId?: string; to?: string; since?: Date; until?: Date; periodLabel?: string }): Promise<SendStatementResult> {
  const data = await loadStatement({ tenantId: opts.tenantId, accountId: opts.accountId, userId: opts.userId, since: opts.since, until: opts.until });
  if (!data) return { ok: false, error: "Account not found" };
  const t: any = data.tenant;
  if (!t?.smtpEmail || !t?.smtpPassword) return { ok: false, error: "Email is not configured for this broker." };
  const to = (opts.to || data.account.user?.email || "").trim();
  if (!to) return { ok: false, error: "No recipient email on file." };

  const brand = brandOf(t);
  const fmtD = (d?: Date) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const periodLabel = opts.periodLabel || ((opts.since || opts.until) ? `${fmtD(opts.since) || "start"} – ${fmtD(opts.until) || "now"}` : "Full account history");
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
