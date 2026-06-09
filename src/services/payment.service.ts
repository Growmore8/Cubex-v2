import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export function listClientPayments(accountId: string) {
  return prisma.paymentRequest.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
}

export function listTenantPayments(tenantId: string) {
  return prisma.paymentRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { login: true, name: true, type: true } } },
  });
}

export function createPayment(tenantId: string, accountId: string, kind: any, amount: number, method?: string, slipUrl?: string, note?: string) {
  return prisma.paymentRequest.create({
    data: { tenantId, accountId, kind, amount: new Prisma.Decimal(amount), method, slipUrl, note },
  });
}

export async function reviewPayment(tenantId: string, id: string, status: "APPROVED" | "REJECTED", by: string) {
  const row = await prisma.paymentRequest.findFirst({ where: { id, tenantId }, include: { account: true } });
  if (!row) throw new Error("Not found");
  if (row.status !== "PENDING") throw new Error("Already reviewed");

  if (status === "APPROVED") {
    const amt = row.amount;
    const data = row.kind === "DEPOSIT" ? { deposit: { increment: amt } } : { withdrawal: { increment: amt } };
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: row.accountId }, data });
      await tx.financialHistory.create({
        data: { accountId: row.accountId, type: row.kind as any, amount: amt, description: row.method || row.kind, mode: "REALTIME", createdBy: by },
      });
      await tx.paymentRequest.update({ where: { id }, data: { status: "APPROVED", reviewedBy: by } });
    });
  } else {
    await prisma.paymentRequest.update({ where: { id }, data: { status: "REJECTED", reviewedBy: by } });
  }
  return row;
}
