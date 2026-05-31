import { prisma } from "@/lib/prisma";

export function audit(tenantId: string | null, action: string, detail: string, performedBy: string, category: any = "ADMIN") {
  return prisma.auditLog.create({ data: { tenantId, action, detail, performedBy, category } }).catch(() => null);
}

export function listAudit(tenantId: string) {
  return prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 })
    .then((rows) => rows.map((r) => ({ id: r.id.toString(), action: r.action, detail: r.detail, category: r.category, performedBy: r.performedBy, createdAt: r.createdAt })));
}
