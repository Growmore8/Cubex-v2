import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// BigInt (FinancialHistory.id) can't go through NextResponse.json — use a replacer.
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PAGE = 50;

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
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
  const doExport = u.searchParams.get("export") === "1";

  // Tenant list for filter dropdown
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

  if (tab === "ledger") {
    const where: any = {};
    if (tenantId) where.account = { tenantId };
    if (type)     where.type = type;
    if (search) {
      where.account = {
        ...where.account,
        OR: [
          { login: { contains: search } },
          { name:  { contains: search } },
          { email: { contains: search } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.financialHistory.findMany({
        where,
        orderBy: { appliedAt: "desc" },
        ...(doExport ? {} : { skip: page * PAGE, take: PAGE }),
        include: {
          account: {
            select: { login: true, name: true, tenantId: true, tenant: { select: { name: true } } },
          },
        },
      }),
      prisma.financialHistory.count({ where }),
    ]);

    if (doExport) {
      const csv = toCsv(
        ["Date", "Tenant", "Login", "Client", "Type", "Description", "Amount", "Mode", "Applied By"],
        rows.map((r) => [
          new Date(r.appliedAt).toISOString(),
          r.account.tenant.name,
          String(r.account.login),
          r.account.name || "",
          r.type,
          r.description || "",
          r.amount.toString(),
          r.mode,
          r.createdBy || "system",
        ])
      );
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"ledger-export.csv\"" } });
    }

    const agg = await prisma.financialHistory.groupBy({
      by: ["type"],
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    return json({ ok: true, tab: "ledger", rows, total, page, pages: Math.ceil(total / PAGE), agg, tenants });
  }

  // tab === "requests"
  const where: any = {};
  if (tenantId) where.tenantId = tenantId;
  if (status)   where.status = status;
  if (kind)     where.kind   = kind;
  if (search) {
    where.account = {
      OR: [
        { login: { contains: search } },
        { name:  { contains: search } },
        { email: { contains: search } },
      ],
    };
  }

  const [rows, total, pending] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(doExport ? {} : { skip: page * PAGE, take: PAGE }),
      include: {
        account: {
          select: {
            login: true, name: true, email: true,
            tenant: { select: { name: true } },
          },
        },
      },
    }),
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.count({ where: { ...where, status: "PENDING" } }),
  ]);

  if (doExport) {
    const csv = toCsv(
      ["Date", "Tenant", "Login", "Client", "Email", "Type", "Method", "Amount", "Status", "Note"],
      rows.map((r) => [
        new Date(r.createdAt).toISOString(),
        r.account.tenant.name,
        String(r.account.login),
        r.account.name || "",
        r.account.email || "",
        r.kind,
        r.method || "",
        r.amount.toString(),
        r.status,
        r.note || "",
      ])
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"payment-requests-export.csv\"" } });
  }

  const kindAgg = await prisma.paymentRequest.groupBy({
    by: ["kind", "status"],
    where: { ...where, status: { in: ["APPROVED", "PENDING"] } },
    _sum: { amount: true },
    _count: { id: true },
  });

  return json({ ok: true, tab: "requests", rows, total, page, pages: Math.ceil(total / PAGE), pending, kindAgg, tenants });
}
