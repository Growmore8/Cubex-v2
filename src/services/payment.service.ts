import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export function listClientPayments(accountId: string) {
  return prisma.paymentRequest.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
}

export function listTenantPayments(tenantId: string) {
  return prisma.paymentRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { login: true, name: true, type: true, email: true } } },
  });
}

export async function createPayment(tenantId: string, accountId: string, kind: any, amount: number, method?: string, slipUrl?: string, note?: string) {
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { login: true, name: true } });
  return prisma.paymentRequest.create({
    data: { tenantId, accountId, accountLogin: acc?.login, accountName: acc?.name, kind, amount: new Prisma.Decimal(amount), method, slipUrl, note },
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
      // Atomic check-and-update: only update if still PENDING — prevents double-approval race
      const updated = await tx.paymentRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: by },
      });
      if (updated.count === 0) throw new Error("Already reviewed");
      await tx.account.update({ where: { id: row.accountId! }, data });
      await tx.financialHistory.create({
        data: { accountId: row.accountId, tenantId: row.tenantId, accountLogin: row.account?.login ?? row.accountLogin, accountName: row.account?.name ?? row.accountName, type: row.kind as any, amount: amt, description: row.method || row.kind, mode: "REALTIME", createdBy: by },
      });
    });
  } else {
    // Atomic reject: only moves from PENDING → REJECTED
    const updated = await prisma.paymentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", reviewedBy: by },
    });
    if (updated.count === 0) throw new Error("Already reviewed");
  }
  return row;
}
