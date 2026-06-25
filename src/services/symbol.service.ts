import { prisma } from "@/lib/prisma";

export function listSymbols(tenantId: string) {
  return prisma.symbol.findMany({ where: { tenantId }, orderBy: { symbol: "asc" } });
}
export function createSymbol(tenantId: string, input: any) {
  return prisma.symbol.create({
    data: { tenantId, symbol: String(input.symbol).toUpperCase(), display: input.display || input.symbol, category: input.category || "forex", digits: input.digits ?? 5, spread: input.spread ?? 0, spreadType: input.spreadType || "FIXED", spreadMax: input.spreadMax ?? 0, enabled: input.enabled ?? true, feed: input.feed || null },
  });
}
export async function updateSymbol(tenantId: string, id: string, input: any) {
  const x = await prisma.symbol.findFirst({ where: { tenantId, id } });
  if (!x) throw new Error("Not found");
  const data: any = {};
  if (input.display !== undefined) data.display = input.display;
  if (input.category !== undefined) data.category = input.category;
  if (input.digits !== undefined) data.digits = Number(input.digits);
  if (input.spread !== undefined) data.spread = Number(input.spread);
  if (input.spreadType !== undefined) data.spreadType = String(input.spreadType);
  if (input.spreadMax !== undefined) data.spreadMax = Number(input.spreadMax);
  if (input.enabled !== undefined) data.enabled = !!input.enabled;
  if (input.feed !== undefined) data.feed = input.feed;
  return prisma.symbol.update({ where: { id }, data });
}
export async function deleteSymbol(tenantId: string, id: string) {
  const x = await prisma.symbol.findFirst({ where: { tenantId, id } });
  if (!x) throw new Error("Not found");
  return prisma.symbol.delete({ where: { id } });
}
