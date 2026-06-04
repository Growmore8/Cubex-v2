// Seed globalSymbol catalog with Twelve-Data-supported symbols.
// Internal symbol format = no slash (GBP/USD -> GBPUSD). Calculated crosses,
// grams, and exotic futures are intentionally skipped (need a calc engine).
import { PrismaClient } from "./node_modules/@prisma/client/index.js";
const prisma = new PrismaClient();

const fx = ["GBPUSD","AUDUSD","EURUSD","NZDUSD","USDJPY","EURJPY","AUDJPY","NZDJPY","GBPJPY","AUDNZD","EURCAD","AUDCAD","EURGBP","USDCHF","GBPCHF","EURCHF",
  // base rates needed for metal-cross / gram conversion (also tradable)
  "USDCAD","USDHKD","USDSGD","USDTRY","USDIDR"];
const crypto = ["BTCUSD","ETHUSD","SOLUSD","BNBUSD","DOGEUSD"];
const metals = ["XAUUSD","XAGUSD","XPTUSD","XPDUSD"];
const stocks = ["AAPL","TRP","QQQ"];
// Derived (calculated server-side) — metal crosses + grams. category "metals".
const derived = [
  "XAUEUR","XAUGBP","XAUAUD","XAUNZD","XAUJPY","XAUCAD","XAUCHF","XAUHKD","XAUSGD","XAUXAG",
  "XAGAUD","XAGCAD","XAGCHF","XAGEUR","XAGGBP","XAGTRY",
  "GAUUSD","GAUEUR","GAUGBP","GAUIDR","GAUTRY","XAGGUSD","XAGGEUR","XAGGTRY",
];
const derivedDisplay = {
  XAGGUSD: "XAGg/USD", XAGGEUR: "XAGg/EUR", XAGGTRY: "XAGg/TRY",
  GAUUSD: "GAU/USD", GAUEUR: "GAU/EUR", GAUGBP: "GAU/GBP", GAUIDR: "GAU/IDR", GAUTRY: "GAU/TRY",
};

function digitsFor(sym, cat) {
  if (cat === "forex") return /JPY$/.test(sym) ? 3 : 5;
  if (cat === "metals") return 2;
  if (cat === "crypto") return 2;
  return 2;
}
function display(sym, cat) {
  if (derivedDisplay[sym]) return derivedDisplay[sym];
  if (cat === "forex" || cat === "metals") return sym.slice(0, 3) + "/" + sym.slice(3);
  if (cat === "crypto") return sym.replace("USD", "") + "/USD";
  return sym;
}

const all = [
  ...fx.map((s) => ({ symbol: s, category: "forex" })),
  ...crypto.map((s) => ({ symbol: s, category: "crypto" })),
  ...metals.map((s) => ({ symbol: s, category: "metals" })),
  ...stocks.map((s) => ({ symbol: s, category: "stocks" })),
  ...derived.map((s) => ({ symbol: s, category: "metals" })),
];

let created = 0, updated = 0;
for (const { symbol, category } of all) {
  const data = { symbol, display: display(symbol, category), category, digits: digitsFor(symbol, category), enabled: true };
  const existing = await prisma.globalSymbol.findUnique({ where: { symbol } });
  if (existing) { await prisma.globalSymbol.update({ where: { symbol }, data: { display: data.display, category, digits: data.digits, enabled: true } }); updated++; }
  else { await prisma.globalSymbol.create({ data }); created++; }
}
console.log(`Symbols seeded: ${created} created, ${updated} updated, ${all.length} total.`);
console.log("NOTE: restart the dev server (npm run dev) so the price feed subscribes to the new symbols.");
await prisma.$disconnect();
