import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";

// BigInt (FinancialHistory.id) can't go through NextResponse.json — use a replacer.
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
function dt(d: Date | string) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function buildPdf(
  tab: "requests" | "ledger",
  rows: any[],
  kpis: { label: string; value: string; color: string }[],
  subtitle: string,
  generated: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W   = doc.page.width  - 72;   // usable width
    const L   = 36;                      // left margin
    const BOT = doc.page.height - 36;   // page bottom

    // ── HEADER BAR ──────────────────────────────────────────────────────────
    doc.save().rect(0, 0, doc.page.width, 52).fill(NAVY).restore();
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(16).text("GC TRADE", L, 12, { lineBreak: false });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
       .text(tab === "requests" ? "Payment Requests Report" : "Financial Ledger Report",
             L + 90, 14, { lineBreak: false });
    doc.fillColor("#7fa8d4").font("Helvetica").fontSize(8)
       .text(subtitle, L, 37, { lineBreak: false })
       .text("Generated: " + generated, L, 37, { width: W, align: "right", lineBreak: false });

    let y = 66;

    // ── KPI CARDS ───────────────────────────────────────────────────────────
    const cardW = W / kpis.length;
    kpis.forEach((k, i) => {
      const cx = L + i * cardW;
      doc.save().roundedRect(cx, y, cardW - 6, 42, 4).fill(GRAY1).restore();
      doc.roundedRect(cx, y, cardW - 6, 42, 4).lineWidth(0.5).stroke("#e5e7eb");
      doc.save().rect(cx, y, 3, 42).fill(k.color).restore();
      doc.fillColor(TEXT2).font("Helvetica").fontSize(6.5)
         .text(k.label.toUpperCase(), cx + 10, y + 7, { width: cardW - 22, lineBreak: false });
      doc.fillColor(k.color).font("Helvetica-Bold").fontSize(13)
         .text(k.value, cx + 10, y + 16, { width: cardW - 22, lineBreak: false });
    });
    y += 52;

    // ── TABLE ───────────────────────────────────────────────────────────────
    const headH = 18;
    const rowH  = 14;

    const cols = tab === "requests"
      ? [
          { label: "Date / Time",  w: 90,  align: "left"  as const },
          { label: "Tenant",       w: 80,  align: "left"  as const },
          { label: "Login",        w: 52,  align: "left"  as const },
          { label: "Client",       w: 90,  align: "left"  as const },
          { label: "Type",         w: 70,  align: "left"  as const },
          { label: "Method",       w: 70,  align: "left"  as const },
          { label: "Amount",       w: 68,  align: "right" as const },
          { label: "Status",       w: 55,  align: "left"  as const },
          { label: "Note",         w: 0,   align: "left"  as const },  // fills remainder
        ]
      : [
          { label: "Date / Time",  w: 90,  align: "left"  as const },
          { label: "Tenant",       w: 90,  align: "left"  as const },
          { label: "Login",        w: 52,  align: "left"  as const },
          { label: "Client",       w: 100, align: "left"  as const },
          { label: "Type",         w: 80,  align: "left"  as const },
          { label: "Description",  w: 0,   align: "left"  as const },  // fills remainder
          { label: "Amount",       w: 72,  align: "right" as const },
          { label: "Mode",         w: 52,  align: "left"  as const },
          { label: "Applied By",   w: 90,  align: "left"  as const },
        ];

    // fill the "0" column to take the remaining width
    const fixedW = cols.filter((c) => c.w > 0).reduce((s, c) => s + c.w, 0);
    cols.forEach((c) => { if (c.w === 0) c.w = W - fixedW; });

    function drawTableHeader(yy: number) {
      doc.save().rect(L, yy, W, headH).fill(GRAY2).restore();
      let x = L; const pad = 4;
      doc.fillColor(TEXT2).font("Helvetica-Bold").fontSize(6.2);
      cols.forEach((c) => {
        doc.text(c.label.toUpperCase(), x + pad, yy + 6, { width: c.w - 2 * pad, align: c.align, lineBreak: false });
        x += c.w;
      });
      return yy + headH;
    }

    y = drawTableHeader(y);

    const inFlowTypes = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);
    const statusColor = (st: string) => st === "APPROVED" ? GREEN : st === "PENDING" ? AMBER : st === "REJECTED" ? RED : TEXT2;
    const typeColor = (t: string) => inFlowTypes.has(t) || t === "CREDIT_REQUEST" ? GREEN :
      ["WITHDRAWAL","CREDIT_OUT","CREDIT_CLEAR"].includes(t) ? RED :
      ["BONUS","REFERRAL"].includes(t) ? "#7c3aed" : TEXT2;

    doc.font("Helvetica").fontSize(7);
    rows.forEach((r, ri) => {
      if (y + rowH > BOT) {
        doc.addPage();
        y = 36;
        y = drawTableHeader(y);
        doc.font("Helvetica").fontSize(7);
      }
      if (ri % 2 === 1) doc.save().rect(L, y, W, rowH).fill(GRAY1).restore();

      let x = L; const pad = 4;
      if (tab === "requests") {
        const cells = [
          { v: dt(r.createdAt),                     c: TEXT2 },
          { v: r.account.tenant.name,               c: TEXT  },
          { v: String(r.account.login),             c: TEXT  },
          { v: r.account.name || r.account.email || "—", c: TEXT },
          { v: r.kind.replace(/_/g, " "),           c: typeColor(r.kind) },
          { v: r.method || "—",                     c: TEXT2 },
          { v: money(parseFloat(r.amount)),         c: typeColor(r.kind) },
          { v: r.status,                            c: statusColor(r.status) },
          { v: r.note || "—",                       c: TEXT2 },
        ];
        cells.forEach((cell, i) => {
          doc.fillColor(cell.c).text(cell.v, x + pad, y + 4, { width: cols[i].w - 2 * pad, align: cols[i].align, lineBreak: false });
          x += cols[i].w;
        });
      } else {
        const cells = [
          { v: dt(r.appliedAt),               c: TEXT2 },
          { v: r.account.tenant.name,         c: TEXT  },
          { v: String(r.account.login),       c: TEXT  },
          { v: r.account.name || "—",         c: TEXT  },
          { v: r.type.replace(/_/g, " "),     c: typeColor(r.type) },
          { v: r.description || "—",          c: TEXT2 },
          { v: money(parseFloat(r.amount)),   c: typeColor(r.type) },
          { v: r.mode,                        c: r.mode === "REALTIME" ? BLUE : TEXT2 },
          { v: r.createdBy || "system",       c: TEXT2 },
        ];
        cells.forEach((cell, i) => {
          doc.fillColor(cell.c).text(cell.v, x + pad, y + 4, { width: cols[i].w - 2 * pad, align: cols[i].align, lineBreak: false });
          x += cols[i].w;
        });
      }
      y += rowH;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.3).stroke("#f0f1f3");
    });

    // ── FOOTER ──────────────────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1;
    doc.fillColor(TEXT2).font("Helvetica").fontSize(7)
       .text(`${rows.length} records exported  ·  GC TRADE — Client Financials  ·  ${generated}`,
             L, BOT, { width: W, align: "center", lineBreak: false });

    doc.end();
  });
}

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return json({ ok: false, error: "Forbidden" }, 403);

  const u = new URL(req.url);
  const tab      = u.searchParams.get("tab") || "requests";
  const tenantId = u.searchParams.get("tenantId") || "";
  const search   = u.searchParams.get("search")?.trim() || "";
  const status   = u.searchParams.get("status") || "";
  const kind     = u.searchParams.get("kind") || "";
  const type     = u.searchParams.get("type") || "";
  const page     = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
  const doExport = u.searchParams.get("export");   // "csv" | "pdf" | null

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const tenantName = tenantId ? (tenants.find((t) => t.id === tenantId)?.name || tenantId) : "All Tenants";
  const generated  = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // ── LEDGER ──────────────────────────────────────────────────────────────
  if (tab === "ledger") {
    const where: any = {};
    if (tenantId) where.account = { tenantId };
    if (type)     where.type = type;
    if (search) {
      where.account = {
        ...where.account,
        OR: [{ login: { contains: search } }, { name: { contains: search } }, { email: { contains: search } }],
      };
    }

    const isExport = doExport === "csv" || doExport === "pdf" || doExport === "1";

    const [rows, total] = await Promise.all([
      prisma.financialHistory.findMany({
        where,
        orderBy: { appliedAt: "desc" },
        ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
        include: { account: { select: { login: true, name: true, tenantId: true, tenant: { select: { name: true } } } } },
      }),
      prisma.financialHistory.count({ where }),
    ]);

    if (doExport === "csv" || doExport === "1") {
      const csv = toCsv(
        ["Date","Tenant","Login","Client","Type","Description","Amount","Mode","Applied By"],
        rows.map((r) => [dt(r.appliedAt), r.account.tenant.name, String(r.account.login), r.account.name||"", r.type, r.description||"", r.amount.toString(), r.mode, r.createdBy||"system"])
      );
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"ledger-export.csv\"" } });
    }

    if (doExport === "pdf") {
      const inFlowTypes = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);
      const inflows  = rows.filter(r=>inFlowTypes.has(r.type)).reduce((s,r)=>s+parseFloat(r.amount.toString()),0);
      const outflows = rows.filter(r=>["WITHDRAWAL","CREDIT_OUT"].includes(r.type)).reduce((s,r)=>s+parseFloat(r.amount.toString()),0);
      const net = inflows - outflows;
      const kpis = [
        { label: "Total Inflows",  value: money(inflows),  color: GREEN },
        { label: "Total Outflows", value: money(outflows), color: RED   },
        { label: "Net Balance",    value: money(net),      color: net>=0 ? GREEN : RED },
        { label: "Transactions",   value: String(rows.length), color: BLUE },
      ];
      const subtitle = `Tenant: ${tenantName}${type ? " · Type: "+type : ""}${search ? " · Search: "+search : ""}`;
      const pdf = await buildPdf("ledger", rows, kpis, subtitle, generated);
      return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=\"financial-ledger.pdf\"" },
      });
    }

    const agg = await prisma.financialHistory.groupBy({ by: ["type"], where, _sum: { amount: true }, _count: { id: true } });
    return json({ ok: true, tab: "ledger", rows, total, page, pages: Math.ceil(total / PAGE), agg, tenants });
  }

  // ── PAYMENT REQUESTS ────────────────────────────────────────────────────
  const where: any = {};
  if (tenantId) where.tenantId = tenantId;
  if (status)   where.status   = status;
  if (kind)     where.kind     = kind;
  if (search) {
    where.account = { OR: [{ login: { contains: search } }, { name: { contains: search } }, { email: { contains: search } }] };
  }

  const isExport = doExport === "csv" || doExport === "pdf" || doExport === "1";

  const [rows, total, pending] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(isExport ? {} : { skip: page * PAGE, take: PAGE }),
      include: { account: { select: { login: true, name: true, email: true, tenant: { select: { name: true } } } } },
    }),
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.count({ where: { ...where, status: "PENDING" } }),
  ]);

  if (doExport === "csv" || doExport === "1") {
    const csv = toCsv(
      ["Date","Tenant","Login","Client","Email","Type","Method","Amount","Status","Note"],
      rows.map((r) => [dt(r.createdAt), r.account.tenant.name, String(r.account.login), r.account.name||"", r.account.email||"", r.kind, r.method||"", r.amount.toString(), r.status, r.note||""])
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"payment-requests-export.csv\"" } });
  }

  if (doExport === "pdf") {
    const approvedDep = rows.filter(r=>r.kind==="DEPOSIT"&&r.status==="APPROVED").reduce((s,r)=>s+parseFloat(r.amount.toString()),0);
    const approvedWd  = rows.filter(r=>r.kind==="WITHDRAWAL"&&r.status==="APPROVED").reduce((s,r)=>s+parseFloat(r.amount.toString()),0);
    const kpis = [
      { label: "Approved Deposits",     value: money(approvedDep),  color: GREEN },
      { label: "Approved Withdrawals",  value: money(approvedWd),   color: RED   },
      { label: "Pending Requests",      value: String(pending),     color: AMBER },
      { label: "Total Records",         value: String(rows.length), color: BLUE  },
    ];
    const subtitle = `Tenant: ${tenantName}${kind ? " · "+kind : ""}${status ? " · "+status : ""}${search ? " · "+search : ""}`;
    const pdf = await buildPdf("requests", rows, kpis, subtitle, generated);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=\"payment-requests.pdf\"" },
    });
  }

  const kindAgg = await prisma.paymentRequest.groupBy({
    by: ["kind", "status"],
    where: { ...where, status: { in: ["APPROVED","PENDING"] } },
    _sum: { amount: true }, _count: { id: true },
  });

  return json({ ok: true, tab: "requests", rows, total, page, pages: Math.ceil(total / PAGE), pending, kindAgg, tenants });
}
