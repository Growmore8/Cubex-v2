import { prisma } from "@/lib/prisma";
export function listGlobal() { return prisma.globalSymbol.findMany({ orderBy: [{ category: "asc" }, { symbol: "asc" }] }); }
export function listEnabled() { return prisma.globalSymbol.findMany({ where: { enabled: true }, orderBy: { symbol: "asc" }, select: { symbol: true, display: true, category: true, digits: true, feed: true } }); }
