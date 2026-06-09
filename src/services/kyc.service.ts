import { prisma } from "@/lib/prisma";

export function clientAccount(tenantId: string, userId: string) {
  return prisma.account.findFirst({ where: { tenantId, userId } });
}

export function listClientKyc(accountId: string) {
  return prisma.kycDocument.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
}

export function listTenantKyc(tenantId: string, managerId?: string | null) {
  return prisma.kycDocument.findMany({
    // Managers see only their own clients' KYC; admins see the whole tenant.
    where: { account: { tenantId, ...(managerId ? { managerId } : {}) } },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { login: true, name: true } } },
  });
}

export async function createKyc(accountId: string, docType: string, fileUrl: string, backUrl?: string, status?: any) {
  const doc = await prisma.kycDocument.create({ data: { accountId, docType, fileUrl, backUrl: backUrl || null, status: (status as any) || "PENDING" } });
  // staff uploads auto-approve -> reflect on the account immediately
  if (status) await prisma.account.update({ where: { id: accountId }, data: { kycStatus: status as any } }).catch(() => {});
  return doc;
}

// Keep account.kycStatus in sync with the client's most recent document so the
// terminal/banner gating reflects the latest decision.
export async function syncAccountKyc(accountId: string) {
  const latest = await prisma.kycDocument.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" } });
  await prisma.account.update({ where: { id: accountId }, data: { kycStatus: (latest?.status as any) || null } }).catch(() => {});
}

export async function reviewKyc(tenantId: string, id: string, status: any, note?: string) {
  const doc = await prisma.kycDocument.findFirst({ where: { id, account: { tenantId } }, include: { account: true } });
  if (!doc) throw new Error("Not found");
  await prisma.kycDocument.update({ where: { id }, data: { status, note } });
  return doc;
}
