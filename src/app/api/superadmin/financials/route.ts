import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PAGE = 50;
const NAVY   = "#0b0f17";
const ACCENT = "#16c79a";
const GRAY1  = "#f8fafc";
const GRAY2  = "#eef2f7";
const TEXT   = "#0f172a";
const TEXT2  = "#64748b";
const GREEN  = "#15803d";
const RED    = "#b91c1c";
const AMBER  = "#b45309";
const BLUE   = "#1d4ed8";

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
    const BOT = PH - 44;   // safe bottom

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.save().rect(0, 0, PW, 54).fill(NAVY).restore();
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(15)
       .text(brandName, L, 12, { lineBreak: false });
    const titleLabel = tab === "requests" ? "  Payment Requests Report" : "  Financial Ledger Report";
    const titleX = L + doc.widthOfString(brandName) + 2;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
       .text(titleLabel, titleX, 14, { lineBreak: false });
    doc.fillColor("#7fa8d4").font("Helvetica").fontSize(8)
       .text(subtitle, L, 38, { lineBreak: false })
       .text("Generated: " + generated, L, 38, { width: W, align: "right", lineBreak: false });

    let y = 66;

    // ── KPI CARDS ────────────────────────────────────────────────────────────
    const cardW = W / kpis.length;
    kpis.forEach((k, i) => {
      const cx = L + i * cardW;
      doc.save().roundedRect(cx + 2, y, cardW - 8, 44, 4).fill(GRAY1).restore();
      doc.roundedRect(cx + 2, y, cardW - 8, 44, 4).lineWidth(0.5).stroke("#e5e7eb");
      doc.save().rect(cx + 2, y, 4, 44).fill(k.color).restore();
      doc.fillColor(TEXT2).font("Helvetica").fontSize(6.5)
         .text(k.label.toUpperCase(), cx + 14, y + 8, { width: cardW - 26, lineBreak: false });
      doc.fillColor(k.color).font("Helvetica-Bold").fontSize(12)
         .text(k.value, cx + 14, y + 19, { width: cardW - 26, lineBreak: false });
    });
    y += 56;

    // ── TABLE ────────────────────────────────────────────────────────────────
    const headH = 18;
    const rowH  = 15;
    const pad   = 5;
    const fontSz = 7;

    // Landscape A4 usable ~769px
    const cols: ColDef[] = tab === "requests"
      ? [
          { label: "Date / Time",  w: 90,  align: "left"  },
          { label: "Tenant",       w: 82,  align: "left"  },
          { label: "Login",        w: 78,  align: "left"  },
          { label: "Client",       w: 88,  align: "left"  },
          { label: "Type",         w: 80,  align: "left"  },
          { label: "Method",       w: 68,  align: "left"  },
          { label: "Amount",       w: 68,  align: "right" },
          { label: "Status",       w: 58,  align: "left"  },
          { label: "Note",         w: 0,   align: "left"  },  // fills remainder
        ]
      : [
          { label: "Date / Time",  w: 90,  align: "left"  },
          { label: "Tenant",       w: 88,  align: "left"  },
          { label: "Login",        w: 78,  align: "left"  },
          { label: "Client",       w: 95,  align: "left"  },
          { label: "Type",         w: 78,  align: "left"  },
          { label: "Description",  w: 0,   align: "left"  },
          { label: "Amount",       w: 72,  align: "right" },
          { label: "Mode",         w: 52,  align: "left"  },
          { label: "Applied By",   w: 108, align: "left"  },
        ];

    const fixedW = cols.filter((c) => c.w > 0).reduce((s, c) => s + c.w, 0);
    cols.forEach((c) => { if (c.w === 0) c.w = W - fixedW; });

    function drawHeader(yy: number) {
      doc.save().rect(L, yy, W, headH).fill(GRAY2).restore();
      let x = L;
      doc.fillColor(TEXT2).font("Helvetica-Bold").fontSize(6.5);
      cols.forEach((c) => {
        doc.text(c.label.toUpperCase(), x + pad, yy + 5, { width: c.w - 2 * pad, align: c.align, lineBreak: false });
        x += c.w;
      });
      return yy + headH;
    }

    y = drawHeader(y);

    const inFlowTypes = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);
    const statusColor = (st: string) => st === "APPROVED" ? GREEN : st === "PENDING" ? AMBER : st === "REJECTED" ? RED : TEXT2;
    const typeColor   = (t: string) => (inFlowTypes.has(t) || t === "CREDIT_REQUEST") ? GREEN :
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
            { v: fmtDt(r.createdAt),                          c: TEXT2 },
            { v: r.account.tenant.name,                       c: TEXT  },
            { v: r.account.login,                             c: TEXT  },
            { v: r.account.name || r.account.email || "—",   c: TEXT  },
            { v: r.kind.replace(/_/g, " "),                   c: typeColor(r.kind) },
            { v: r.method || "—",                             c: TEXT2 },
            { v: money(parseFloat(r.amount)),                 c: typeColor(r.kind) },
            { v: r.status,                                    c: statusColor(r.status) },
            { v: r.note || "—",                               c: TEXT2 },
          ]
        : [
            { v: fmtDt(r.appliedAt),                          c: TEXT2 },
            { v: r.account.tenant.name,                       c: TEXT  },
            { v: r.account.login,                             c: TEXT  },
            { v: r.account.name || "—",                       c: TEXT  },
            { v: r.type.replace(/_/g, " "),                   c: typeColor(r.type) },
            { v: r.description || "—",                        c: TEXT2 },
            { v: money(parseFloat(r.amount)),                 c: typeColor(r.type) },
            { v: r.mode,                                      c: r.mode === "REALTIME" ? BLUE : TEXT2 },
            { v: r.createdBy || "system",                     c: TEXT2 },
          ];

      cells.forEach((cell, i) => {
        doc.fillColor(cell.c)
           .text(cell.v, x + pad, y + 4, {
             width: cols[i].w - 2 * pad,
             align: cols[i].align,
             lineBreak: false,
             ellipsis: true,
           });
        x += cols[i].w;
      });

      doc.moveTo(L, y + rowH).lineTo(L + W, y + rowH).lineWidth(0.25).stroke("#f0f1f3");
      y += rowH;
    });

    // ── FOOTER on every page ──────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let pg = range.start; pg < range.start + range.count; pg++) {
      doc.switchToPage(pg);
      doc.save().rect(0, PH - 24, PW, 24).fill("#f8fafc").restore();
      doc.moveTo(0, PH - 24).lineTo(PW, PH - 24).lineWidth(0.5).stroke("#e5e7eb");
      doc.fillColor(TEXT2).font("Helvetica").fontSize(7)
         .text(
           `${brandName} — Client Financials  ·  ${rows.length} records  ·  ${subtitle}  ·  Generated ${generated}`,
           L, PH - 16,
           { width: W - 40, lineBreak: false, ellipsis: true }
         )
         .text(`${pg - range.start + 1} / ${range.count}`, L, PH - 16, { width: W, align: "right", lineBreak: false });
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
  const accountType = u.searchParams.get("accountType") || "";   // "DEMO" | "LIVE" | ""
  const page        = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
  const doExport    = u.searchParams.get("export");              // "csv" | "pdf" | null

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
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

  // ── LEDGER ─────────────────────────────────────────────────────────────────
  if (tab === "ledger") {
    const where: any = { account: accountWhere };
    if (type) where.type = type;

    const [rows, total] = await Promise.all([
      prisma.financialHistory.findMany({
        where,
        orderBy: { appliedAt: "desc" },
        ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
        include: { account: { select: { login: true, name: true, type: true, tenantId: true, tenant: { select: { name: true } } } } },
      }),
      prisma.financialHistory.count({ where }),
    ]);

    if (doExport === "csv") {
      const csv = toCsv(
        ["Date", "Tenant", "Login", "Client", "Account Type", "Type", "Description", "Amount", "Mode", "Applied By"],
        rows.map((r) => [fmtDt(r.appliedAt), r.account.tenant.name, r.account.login, r.account.name || "", r.account.type, r.type, r.description || "", r.amount.toString(), r.mode, r.createdBy || "system"])
      );
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"ledger-export.csv\"" } });
    }

    if (doExport === "pdf") {
      const inFlowTypes = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);
      const inflows  = rows.filter(r => inFlowTypes.has(r.type)).reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
      const outflows = rows.filter(r => ["WITHDRAWAL","CREDIT_OUT"].includes(r.type)).reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
      const net = inflows - outflows;
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
        search      ? `Search: "${search}"`           : "",
      ].filter(Boolean).join("  ·  ");
      const pdf = await buildPdf("ledger", rows, kpis, tenantName, subtitle, generated);
      return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${tenantName.replace(/\s/g,"-")}-ledger.pdf"` },
      });
    }

    const agg = await prisma.financialHistory.groupBy({ by: ["type"], where, _sum: { amount: true }, _count: { id: true } });
    return json({ ok: true, tab: "ledger", rows, total, page, pages: Math.ceil(total / PAGE), agg, tenants });
  }

  // ── PAYMENT REQUESTS ───────────────────────────────────────────────────────
  const where: any = {};
  if (status)       where.status   = status;
  if (kind)         where.kind     = kind;
  if (tenantId)     where.tenantId = tenantId;

  // Attach account filters (type + search)
  const hasAccFilter = Object.keys(accountWhere).some(k => k !== "tenantId");
  const accFilter: any = { ...accountWhere };
  delete accFilter.tenantId; // tenantId already on PaymentRequest directly
  if (Object.keys(accFilter).length > 0) where.account = accFilter;

  const [rows, total, pending] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
      include: { account: { select: { login: true, name: true, email: true, type: true, tenant: { select: { name: true } } } } },
    }),
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.count({ where: { ...where, status: "PENDING" } }),
  ]);

  if (doExport === "csv") {
    const csv = toCsv(
      ["Date", "Tenant", "Login", "Client", "Email", "Account Type", "Type", "Method", "Amount", "Status", "Note"],
      rows.map((r) => [fmtDt(r.createdAt), r.account.tenant.name, r.account.login, r.account.name || "", r.account.email || "", r.account.type, r.kind, r.method || "", r.amount.toString(), r.status, r.note || ""])
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"payment-requests-export.csv\"" } });
  }

  if (doExport === "pdf") {
    const approvedDep = rows.filter(r => r.kind === "DEPOSIT" && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
    const approvedWd  = rows.filter(r => r.kind === "WITHDRAWAL" && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r.amount.toString()), 0);
    const kpis = [
      { label: "Approved Deposits",    value: money(approvedDep),  color: GREEN },
      { label: "Approved Withdrawals", value: money(approvedWd),   color: RED   },
      { label: "Pending Requests",     value: String(pending),     color: AMBER },
      { label: "Total Records",        value: String(rows.length), color: BLUE  },
    ];
    const subtitle = [
      `Tenant: ${tenantName}`,
      kind        ? kind.replace(/_/g," ")         : "",
      status      ? `Status: ${status}`            : "",
      accountType ? `Accounts: ${accountType} only`: "",
      search      ? `Search: "${search}"`          : "",
    ].filter(Boolean).join("  ·  ");
    const pdf = await buildPdf("requests", rows, kpis, tenantName, subtitle, generated);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${tenantName.replace(/\s/g,"-")}-payment-requests.pdf"` },
    });
  }

  const kindAgg = await prisma.paymentRequest.groupBy({
    by: ["kind", "status"],
    where: { ...where, status: { in: ["APPROVED","PENDING"] } },
    _sum: { amount: true }, _count: { id: true },
  });

  return json({ ok: true, tab: "requests", rows, total, page, pages: Math.ceil(total / PAGE), pending, kindAgg, tenants });
}
