import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export function listGroups(tenantId: string) {
  return prisma.tradeGroup.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}
export function createGroup(tenantId: string, input: any) {
  return prisma.tradeGroup.create({ data: { tenantId, name: input.name, spread: new Prisma.Decimal(input.spread || 0), config: input.config || {}, managerId: input.managerId || null } });
}
export async function updateGroup(tenantId: string, id: string, input: any) {
  const g = await prisma.tradeGroup.findFirst({ where: { tenantId, id } });
  if (!g) throw new Error("Not found");
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.spread !== undefined) data.spread = new Prisma.Decimal(input.spread);
  if (input.spreadType !== undefined) data.spreadType = input.spreadType === "FLOATING" ? "FLOATING" : "FIXED";
  if (input.spreadMax !== undefined) data.spreadMax = new Prisma.Decimal(input.spreadMax);
  if (input.managerId !== undefined) data.managerId = input.managerId || null;
  return prisma.tradeGroup.update({ where: { id }, data });
}
export async function deleteGroup(tenantId: string, id: string) {
  const g = await prisma.tradeGroup.findFirst({ where: { tenantId, id } });
  if (!g) throw new Error("Not found");
  return prisma.tradeGroup.delete({ where: { id } });
}
