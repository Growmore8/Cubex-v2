// Remove legacy duplicate symbols (USDT crypto) — the catalog now uses BTC/USD format.
import { PrismaClient } from "./node_modules/@prisma/client/index.js";
const prisma = new PrismaClient();

// Delete any symbol ending in USDT (legacy Binance-style duplicates)
const usdt = await prisma.globalSymbol.findMany({ where: { symbol: { endsWith: "USDT" } } });
for (const s of usdt) {
  // remove dependent accounts' trades? No — just delete the symbol catalog row.
  await prisma.globalSymbol.delete({ where: { id: s.id } }).catch(() => {});
}
console.log("Removed legacy USDT symbols:", usdt.map((s) => s.symbol).join(", ") || "(none)");

const total = await prisma.globalSymbol.count({ where: { enabled: true } });
console.log("Enabled symbols now:", total);
console.log("Restart the dev server so the feed reloads.");
await prisma.$disconnect();
