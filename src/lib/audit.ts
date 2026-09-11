import { prisma } from "@/lib/prisma";

function inferCategory(action: string, explicit: string): string {
  if (explicit === "SUPERADMIN") return "SUPERADMIN";
  if (action.startsWith("auth.")) return "AUTH";
  if (
    action.startsWith("trade.") || action.startsWith("order.") ||
    action.startsWith("copy.") || action.startsWith("desk.") ||
    action.startsWith("history.")
  ) return "TRADE";
  if (
    action.startsWith("payment.") || action.startsWith("balance.") ||
    action === "client.manualPnl" || action === "client.transfer" ||
    action === "bonus.expire" || action === "swap.rollover"
  ) return "FINANCIAL";
  if (
    action.startsWith("symbol.") || action === "client.spreadOverride" ||
    action === "client.symbolOverride"
  ) return "SYMBOL";
  if (
    action.startsWith("kyc.") || action.startsWith("accountRequest.") ||
    action.startsWith("client.")
  ) return "CLIENT";
  if (action.startsWith("sa.") || action === "platform.mode") return "SUPERADMIN";
  return explicit || "ADMIN";
}

export function audit(tenantId: string | null, action: string, detail: string, performedBy: string, category: any = "ADMIN") {
  const cat = inferCategory(action, String(category));
  return prisma.auditLog.create({ data: { tenantId, action, detail, performedBy, category: cat as any } }).catch(() => null);
}

export function listAudit(tenantId: string) {
  return prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 })
    .then((rows) => rows.map((r) => ({ id: r.id.toString(), action: r.action, detail: r.detail, category: r.category, performedBy: r.performedBy, createdAt: r.createdAt })));
}
