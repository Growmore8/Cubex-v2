import { prisma } from "@/lib/prisma";

export function clientAccount(tenantId: string, userId: string) {
  return prisma.account.findFirst({ where: { tenantId, userId } });
}

export function listClientKyc(accountId: string) {
  return prisma.kycDocument.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
}

export function listTenantKyc(tenantId: string) {
  return prisma.kycDocument.findMany({
    where: { account: { tenantId } },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { login: true, name: true } } },
  });
}

export function createKyc(accountId: string, docType: string, fileUrl: string) {
  return prisma.kycDocument.create({ data: { accountId, docType, fileUrl } });
}

export async function reviewKyc(tenantId: string, id: string, status: any, note?: string) {
  const doc = await prisma.kycDocument.findFirst({ where: { id, account: { tenantId } }, include: { account: true } });
  if (!doc) throw new Error("Not found");
  await prisma.kycDocument.update({ where: { id }, data: { status, note } });
  return doc;
}
