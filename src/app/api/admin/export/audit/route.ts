import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

function csvRow(vals: unknown[]): string {
  return vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

export async function GET(req: Request) {
  const s = await requireAdmin();
  if (!s) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const category = url.searchParams.get("category") || undefined;

  const where: any = { tenantId: s.tenantId! };
  if (category && category !== "ALL") where.category = category;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59");
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const header = csvRow(["Date","Category","Action","Detail","Performed By","IP Address","Device"]);
  const rows = logs.map((l) =>
    csvRow([
      new Date(l.createdAt).toISOString(),
      l.category,
      l.action,
      l.detail ?? "",
      l.performedBy,
      l.ipAddress ?? "",
      l.device ?? "",
    ])
  );

  const csv = [header, ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
    },
  });
}
