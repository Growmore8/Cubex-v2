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

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return json({ ok: false, error: "Forbidden" }, 403);

  const u = new URL(req.url);
  const tab      = u.searchParams.get("tab") || "requests";          // "requests" | "ledger"
  const tenantId = u.searchParams.get("tenantId") || "";
  const search   = u.searchParams.get("search")?.trim() || "";
  const status   = u.searchParams.get("status") || "";               // PENDING | APPROVED | REJECTED | CANCELLED
  const kind     = u.searchParams.get("kind") || "";                 // DEPOSIT | WITHDRAWAL | CREDIT_REQUEST | CREDIT_CLEAR
  const type     = u.searchParams.get("type") || "";                 // FinType (ledger only)
  const page     = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));

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
        skip: page * PAGE,
        take: PAGE,
        include: {
          account: {
            select: { login: true, name: true, tenantId: true, tenant: { select: { name: true } } },
          },
        },
      }),
      prisma.financialHistory.count({ where }),
    ]);

    // Aggregate totals for summary (unfiltered by page, filtered by tenant/search/type)
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
      skip: page * PAGE,
      take: PAGE,
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

  // Kind totals (approved only) for summary
  const kindAgg = await prisma.paymentRequest.groupBy({
    by: ["kind", "status"],
    where: { ...where, status: { in: ["APPROVED", "PENDING"] } },
    _sum: { amount: true },
    _count: { id: true },
  });

  return json({ ok: true, tab: "requests", rows, total, page, pages: Math.ceil(total / PAGE), pending, kindAgg, tenants });
}
