import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PAGE  = 50;
const NAVY  = "#0b0f17";
const ACCENT= "#16c79a";
const GRAY1 = "#f8fafc";
const GRAY2 = "#eef2f7";
const TEXT  = "#0f172a";
const TEXT2 = "#64748b";
const GREEN = "#15803d";
const RED   = "#b91c1c";
const AMBER = "#b45309";
const BLUE  = "#1d4ed8";

function money(n: number) {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDt(d: Date | string) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

type ColDef = { label: string; w: number; align: "left" | "right" };

function buildPdf(
  tab: "requests" | "ledger",
  rows: any[],
  kpis: { label: string; value: string; color: string }[],
  brandName: string,
  subtitle: string,
  generated: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape", bufferPages: true });
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW  = doc.page.width;
    const PH  = doc.page.height;
    const L   = 36;
    const W   = PW - 72;
    const BOT = PH - 30; // rows must stay above footer strip

    // ── HEADER (44pt) ──────────────────────────────────────────────────────
    doc.save().rect(0, 0, PW, 44).fill(NAVY).restore();
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(14)
       .text(brandName, L, 10, { lineBreak: false });
    const bw = doc.widthOfString(brandName);
    const titleLabel = tab === "requests" ? "  Payment Requests" : "  Financial Ledger";
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(12)
       .text(titleLabel, L + bw + 2, 11, { lineBreak: false });
    doc.fillColor("#7fa8d4").font("Helvetica").fontSize(7.5)
       .text(subtitle, L, 30, { lineBreak: false })
       .text("Generated: " + generated, L, 30, { width: W, align: "right", lineBreak: false });

    let y = 54; // header 44pt + 10pt gap

    // ── KPI CARDS (34pt tall, 42pt total) ──────────────────────────────────
    const cardW = W / kpis.length;
    kpis.forEach((k, i) => {
      const cx = L + i * cardW;
      doc.save().roundedRect(cx + 2, y, cardW - 8, 34, 3).fill(GRAY1).restore();
      doc.roundedRect(cx + 2, y, cardW - 8, 34, 3).lineWidth(0.4).stroke("#e5e7eb");
      doc.save().rect(cx + 2, y, 4, 34).fill(k.color).restore();
      doc.fillColor(TEXT2).font("Helvetica").fontSize(6)
         .text(k.label.toUpperCase(), cx + 12, y + 5, { width: cardW - 24, lineBreak: false });
      doc.fillColor(k.color).font("Helvetica-Bold").fontSize(11)
         .text(k.value, cx + 12, y + 15, { width: cardW - 24, lineBreak: false });
    });
    y += 42;

    // ── TABLE ───────────────────────────────────────────────────────────────
    const headH = 15;
    const rowH  = 12;
    const pad   = 4;
    const fontSz = 6.5;

    const cols: ColDef[] = tab === "requests"
      ? [
          { label: "Date / Time", w: 85,  align: "left"  },
          { label: "Tenant",      w: 80,  align: "left"  },
          { label: "Login",       w: 68,  align: "left"  },
          { label: "Client",      w: 88,  align: "left"  },
          { label: "Type",        w: 75,  align: "left"  },
          { label: "Method",      w: 62,  align: "left"  },
          { label: "Amount",      w: 62,  align: "right" },
          { label: "Status",      w: 54,  align: "left"  },
          { label: "Note",        w: 0,   align: "left"  },
        ]
      : [
          { label: "Date / Time", w: 85,  align: "left"  },
          { label: "Tenant",      w: 85,  align: "left"  },
          { label: "Login",       w: 68,  align: "left"  },
          { label: "Client",      w: 90,  align: "left"  },
          { label: "Type",        w: 70,  align: "left"  },
          { label: "Description", w: 0,   align: "left"  },
          { label: "Amount",      w: 68,  align: "right" },
          { label: "Mode",        w: 52,  align: "left"  },
          { label: "Applied By",  w: 108, align: "left"  },
        ];

    const fixedW = cols.filter((c) => c.w > 0).reduce((s, c) => s + c.w, 0);
    cols.forEach((c) => { if (c.w === 0) c.w = W - fixedW; });

    function drawHeader(yy: number) {
      doc.save().rect(L, yy, W, headH).fill(GRAY2).restore();
      let x = L;
      doc.fillColor(TEXT2).font("Helvetica-Bold").fontSize(6);
      cols.forEach((c) => {
        doc.text(c.label.toUpperCase(), x + pad, yy + 4, { width: c.w - 2 * pad, align: c.align, lineBreak: false });
        x += c.w;
      });
      return yy + headH;
    }

    y = drawHeader(y);

    const inFlowSet   = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);
    const statusColor = (st: string) => st === "APPROVED" ? GREEN : st === "PENDING" ? AMBER : st === "REJECTED" ? RED : TEXT2;
    const typeColor   = (t: string) =>
      inFlowSet.has(t) || t === "CREDIT_REQUEST" ? GREEN :
      ["WITHDRAWAL","CREDIT_OUT","CREDIT_CLEAR"].includes(t) ? RED :
      ["BONUS","REFERRAL"].includes(t) ? "#7c3aed" : TEXT2;

    doc.font("Helvetica").fontSize(fontSz);

    rows.forEach((r, ri) => {
      if (y + rowH > BOT) {
        doc.addPage();
        y = 36;
        y = drawHeader(y);
        doc.font("Helvetica").fontSize(fontSz);
      }

      if (ri % 2 === 1) doc.save().rect(L, y, W, rowH).fill(GRAY1).restore();

      let x = L;
      const cells: { v: string; c: string }[] = tab === "requests"
        ? [
            { v: fmtDt(r.createdAt),                        c: TEXT2 },
            { v: r.account.tenant.name,                     c: TEXT  },
            { v: r.account.login,                           c: TEXT  },
            { v: r.account.name || r.account.email || "—", c: TEXT  },
            { v: r.kind.replace(/_/g, " "),                 c: typeColor(r.kind)    },
            { v: r.method || "—",                           c: TEXT2 },
            { v: money(parseFloat(r.amount)),               c: typeColor(r.kind)    },
            { v: r.status,                                  c: statusColor(r.status)},
            { v: r.note || "—",                             c: TEXT2 },
          ]
        : [
            { v: fmtDt(r.appliedAt),                        c: TEXT2 },
            { v: r.account.tenant.name,                     c: TEXT  },
            { v: r.account.login,                           c: TEXT  },
            { v: r.account.name || "—",                     c: TEXT  },
            { v: r.type.replace(/_/g, " "),                 c: typeColor(r.type) },
            { v: r.description || "—",                      c: TEXT2 },
            { v: money(parseFloat(r.amount)),               c: typeColor(r.type) },
            { v: r.mode,                                    c: r.mode === "REALTIME" ? BLUE : TEXT2 },
            { v: r.createdBy || "system",                   c: TEXT2 },
          ];

      cells.forEach((cell, i) => {
        doc.fillColor(cell.c)
           .text(cell.v, x + pad, y + 3, {
             width: cols[i].w - 2 * pad,
             align: cols[i].align,
             lineBreak: false,
             ellipsis: true,
           });
        x += cols[i].w;
      });

      doc.moveTo(L, y + rowH).lineTo(L + W, y + rowH).lineWidth(0.2).stroke("#f0f1f3");
      y += rowH;
    });

    // ── FOOTER — must set margins.bottom = 0 to prevent PDFKit auto-adding a page ──
    const range      = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let pg = range.start; pg < range.start + range.count; pg++) {
      doc.switchToPage(pg);
      doc.page.margins.bottom = 0; // KEY: without this, writing at PH-18 triggers an extra blank page
      const FY = PH - 18;
      doc.save().rect(0, FY - 3, PW, 21).fill(GRAY1).restore();
      doc.moveTo(0, FY - 3).lineTo(PW, FY - 3).lineWidth(0.4).stroke("#e2e8f0");
      doc.fillColor(TEXT2).font("Helvetica").fontSize(6.5)
         .text(`${brandName}  ·  ${rows.length} records  ·  ${subtitle}`, L, FY, {
           width: W - 50, lineBreak: false, ellipsis: true,
         });
      doc.fillColor(TEXT2).font("Helvetica").fontSize(6.5)
         .text(`${pg - range.start + 1} / ${totalPages}`, L, FY, {
           width: W, align: "right", lineBreak: false,
         });
    }

    doc.end();
  });
}

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return json({ ok: false, error: "Forbidden" }, 403);

  const u = new URL(req.url);
  const tab         = u.searchParams.get("tab") || "requests";
  const tenantId    = u.searchParams.get("tenantId") || "";
  const search      = u.searchParams.get("search")?.trim() || "";
  const status      = u.searchParams.get("status") || "";
  const kind        = u.searchParams.get("kind") || "";
  const type        = u.searchParams.get("type") || "";
  const accountType = u.searchParams.get("accountType") || "";
  const dateFrom    = u.searchParams.get("dateFrom") || "";
  const dateTo      = u.searchParams.get("dateTo") || "";
  const page        = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
  const doExport    = u.searchParams.get("export");

  const tenants    = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const tenantName = tenantId ? (tenants.find((t) => t.id === tenantId)?.name || tenantId) : "All Tenants";
  const generated  = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const accountWhere: any = {};
  if (tenantId)    accountWhere.tenantId = tenantId;
  if (accountType) accountWhere.type     = accountType;
  if (search) {
    accountWhere.OR = [
      { login: { contains: search } },
      { name:  { contains: search } },
      { email: { contains: search } },
    ];
  }

  const isExport = !!doExport;

  function dateRange(field: string) {
    if (!dateFrom && !dateTo) return {};
    const range: any = {};
    if (dateFrom) range.gte = new Date(dateFrom);
    if (dateTo)   range.lte = new Date(dateTo + "T23:59:59.999Z");
    return { [field]: range };
  }

  // ── LEDGER ──────────────────────────────────────────────────────────────────
  if (tab === "ledger") {
    // Build ledger WHERE: match active accounts via accountWhere OR orphaned records (account deleted)
    const ledgerWhere: any = { ...dateRange("appliedAt") };
    if (type) ledgerWhere.type = type;
    const hasAccFilter = tenantId || accountType || search;
    if (hasAccFilter) {
      ledgerWhere.OR = [
        { account: accountWhere },
        // Also include orphaned rows (accountId=null) that still carry the tenantId snapshot
        ...(tenantId && !accountType && !search ? [{ accountId: null, tenantId }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.financialHistory.findMany({
        where: ledgerWhere,
        orderBy: { appliedAt: "desc" },
        ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
        include: {
          account: {
            select: { login: true, name: true, type: true, tenantId: true, tenant: { select: { name: true } } },
          },
        },
      }),
      prisma.financialHistory.count({ where: ledgerWhere }),
    ]);

    // Helper: resolve display fields using live account data or snapshot fallback
    const ledgAcc = (r: any) => ({
      tenantName: r.account?.tenant?.name ?? tenantId ? (tenants.find(t => t.id === (r.tenantId || tenantId))?.name ?? r.tenantId ?? "—") : "—",
      login:      r.account?.login ?? r.accountLogin ?? "—",
      name:       r.account?.name  ?? r.accountName  ?? "—",
      type:       r.account?.type  ?? "—",
    });

    if (doExport === "csv") {
      const csv = toCsv(
        ["Date", "Tenant", "Login", "Client", "Account Type", "Type", "Description", "Amount", "Mode", "Applied By"],
        rows.map((r) => { const a = ledgAcc(r); return [fmtDt(r.appliedAt), a.tenantName, a.login, a.name, a.type, r.type, r.description || "", r.amount.toString(), r.mode, r.createdBy || "system"]; })
      );
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"ledger-export.csv\"" } });
    }

    if (doExport === "pdf") {
      const inflows  = rows.filter((r) => new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]).has(r.type)).reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
      const outflows = rows.filter((r) => ["WITHDRAWAL","CREDIT_OUT"].includes(r.type)).reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
      const net      = inflows - outflows;
      const kpis = [
        { label: "Total Inflows",  value: money(inflows),      color: GREEN },
        { label: "Total Outflows", value: money(outflows),     color: RED   },
        { label: "Net Balance",    value: money(net),          color: net >= 0 ? GREEN : RED },
        { label: "Transactions",   value: String(rows.length), color: BLUE  },
      ];
      const subtitle = [
        `Tenant: ${tenantName}`,
        type        ? `Type: ${type}`                 : "",
        accountType ? `Accounts: ${accountType} only` : "",
        dateFrom    ? `From: ${dateFrom}`             : "",
        dateTo      ? `To: ${dateTo}`                 : "",
        search      ? `Search: "${search}"`           : "",
      ].filter(Boolean).join("  ·  ");
      // Attach resolved display fields so buildPdf can access them
      const pdfRows = rows.map(r => { const a = ledgAcc(r); return { ...r, account: { login: a.login, name: a.name, type: a.type, tenant: { name: a.tenantName } } }; });
      const pdf = await buildPdf("ledger", pdfRows, kpis, tenantName, subtitle, generated);
      return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${tenantName.replace(/\s/g, "-")}-ledger.pdf"` },
      });
    }

    const agg = await prisma.financialHistory.groupBy({ by: ["type"], where: ledgerWhere, _sum: { amount: true }, _count: { id: true } });
    // Attach resolved display fields onto rows for the UI
    const ledgerRows = rows.map(r => { const a = ledgAcc(r); return { ...r, _display: a }; });
    return json({ ok: true, tab: "ledger", rows: ledgerRows, total, page, pages: Math.ceil(total / PAGE), agg, tenants });
  }

  // ── PAYMENT REQUESTS ────────────────────────────────────────────────────────
  const where: any = { ...dateRange("createdAt") };
  if (status)   where.status   = status;
  if (kind)     where.kind     = kind;
  if (tenantId) where.tenantId = tenantId;

  const accFilter: any = { ...accountWhere };
  delete accFilter.tenantId;
  if (Object.keys(accFilter).length > 0) where.account = accFilter;

  const [rows, total, pending] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
      include: {
        account: {
          select: { login: true, name: true, email: true, type: true, tenant: { select: { name: true } } },
        },
      },
    }),
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.count({ where: { ...where, status: "PENDING" } }),
  ]);

  // Helper: resolve display fields for payment requests using live account or snapshot fallback
  const reqAcc = (r: any) => ({
    tenantName: r.account?.tenant?.name ?? (tenants.find(t => t.id === r.tenantId)?.name ?? r.tenantId ?? "—"),
    login:      r.account?.login ?? r.accountLogin ?? "—",
    name:       r.account?.name  ?? r.accountName  ?? "—",
    email:      r.account?.email ?? "—",
    type:       r.account?.type  ?? "—",
  });

  if (doExport === "csv") {
    const csv = toCsv(
      ["Date", "Tenant", "Login", "Client", "Email", "Account Type", "Type", "Method", "Amount", "Status", "Note"],
      rows.map((r) => { const a = reqAcc(r); return [fmtDt(r.createdAt), a.tenantName, a.login, a.name, a.email, a.type, r.kind, r.method || "", r.amount.toString(), r.status, r.note || ""]; })
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"payment-requests-export.csv\"" } });
  }

  if (doExport === "pdf") {
    const approvedDep = rows.filter((r) => r.kind === "DEPOSIT"    && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
    const approvedWd  = rows.filter((r) => r.kind === "WITHDRAWAL" && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
    const kpis = [
      { label: "Approved Deposits",    value: money(approvedDep),  color: GREEN },
      { label: "Approved Withdrawals", value: money(approvedWd),   color: RED   },
      { label: "Pending Requests",     value: String(pending),     color: AMBER },
      { label: "Total Records",        value: String(rows.length), color: BLUE  },
    ];
    const subtitle = [
      `Tenant: ${tenantName}`,
      kind        ? kind.replace(/_/g, " ")         : "",
      status      ? `Status: ${status}`             : "",
      accountType ? `Accounts: ${accountType} only` : "",
      dateFrom    ? `From: ${dateFrom}`             : "",
      dateTo      ? `To: ${dateTo}`                 : "",
      search      ? `Search: "${search}"`           : "",
    ].filter(Boolean).join("  ·  ");
    const pdfReqRows = rows.map(r => { const a = reqAcc(r); return { ...r, account: { login: a.login, name: a.name, email: a.email, type: a.type, tenant: { name: a.tenantName } } }; });
    const pdf = await buildPdf("requests", pdfReqRows, kpis, tenantName, subtitle, generated);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${tenantName.replace(/\s/g, "-")}-payment-requests.pdf"` },
    });
  }

  const kindAgg = await prisma.paymentRequest.groupBy({
    by: ["kind", "status"],
    where: { ...where, status: { in: ["APPROVED","PENDING"] } },
    _sum: { amount: true }, _count: { id: true },
  });

  const reqRows = rows.map(r => { const a = reqAcc(r); return { ...r, _display: a }; });
  return json({ ok: true, tab: "requests", rows: reqRows, total, page, pages: Math.ceil(total / PAGE), pending, kindAgg, tenants });
}
