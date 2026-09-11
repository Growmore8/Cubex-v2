// Seed globalSymbol catalog with Twelve-Data-supported symbols.
// Internal symbol format = no slash (GBP/USD -> GBPUSD). Calculated crosses,
// grams, and exotic futures are intentionally skipped (need a calc engine).
import { PrismaClient } from "./node_modules/@prisma/client/index.js";
const prisma = new PrismaClient();

const fx = [
  // Majors
  "EURUSD","GBPUSD","AUDUSD","NZDUSD","USDJPY","USDCHF","USDCAD",
  // Euro crosses
  "EURGBP","EURJPY","EURCAD","EURCHF","EURAUD","EURNZD",
  "EURNOK","EURSEK","EURDKK","EURTRY","EURPLN","EURSGD",
  // GBP crosses
  "GBPJPY","GBPCHF","GBPAUD","GBPCAD","GBPNZD","GBPSGD",
  // AUD crosses
  "AUDJPY","AUDNZD","AUDCAD","AUDCHF",
  // NZD crosses
  "NZDJPY","NZDCAD","NZDCHF",
  // USD exotics
  "USDHKD","USDSGD","USDTRY","USDIDR","USDMXN","USDZAR",
  "USDNOK","USDSEK","USDDKK","USDPLN",
  // Other crosses
  "CADCHF","CADJPY","CHFJPY",
];

const crypto = [
  "BTCUSD","ETHUSD","SOLUSD","BNBUSD","DOGEUSD",
  "XRPUSD","ADAUSD","AVAXUSD","LINKUSD","LTCUSD","DOTUSD",
  "MATICUSD","SHIBUSD","TRXUSD","UNIUSD","ATOMUSD",
];

const metals = ["XAUUSD","XAGUSD","XPTUSD","XPDUSD"];

const energy = ["USOIL","UKOIL","NATGAS","COPPER"];

const indices = ["US500","US30","US100","GER40","UK100","JP225","HK50","FRA40","AUS200","EUSTX50","VIX","ESP35"];

const stocks = [
  // Existing
  "AAPL","TRP","QQQ",
  // US Big Tech
  "MSFT","AMZN","GOOGL","META","NVDA","TSLA","NFLX",
  // More US stocks
  "AMD","INTC","UBER","V","JPM","DIS","PYPL","BABA",
];

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

const stockDisplay = {
  AAPL:"Apple", MSFT:"Microsoft", AMZN:"Amazon", GOOGL:"Alphabet", META:"Meta",
  NVDA:"NVIDIA", TSLA:"Tesla", NFLX:"Netflix", BABA:"Alibaba", AMD:"AMD",
  INTC:"Intel", UBER:"Uber", V:"Visa", JPM:"JPMorgan", DIS:"Disney",
  PYPL:"PayPal", TRP:"TC Energy", QQQ:"Nasdaq ETF",
};

const indexDisplay = {
  US500:"S&P 500", US30:"Dow Jones", US100:"Nasdaq 100", GER40:"DAX 40",
  UK100:"FTSE 100", JP225:"Nikkei 225", HK50:"Hang Seng", FRA40:"CAC 40",
  AUS200:"ASX 200", EUSTX50:"Euro Stoxx 50", VIX:"VIX", ESP35:"IBEX 35",
};

// Per-symbol digit overrides
const digitsOverride = {
  // Crypto small-price tokens
  MATICUSD: 4, SHIBUSD: 6, TRXUSD: 4, UNIUSD: 3, ATOMUSD: 3,
  XRPUSD: 4, ADAUSD: 4, DOTUSD: 3, LINKUSD: 3,
  // Commodities
  COPPER: 3,
  // JPY-denominated forex
  USDJPY: 3, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, NZDJPY: 3,
  CADJPY: 3, CHFJPY: 3,
};

function digitsFor(sym, cat) {
  if (digitsOverride[sym] != null) return digitsOverride[sym];
  if (cat === "forex") return /JPY$/.test(sym) ? 3 : 5;
  if (cat === "metals" || cat === "energy" || cat === "indices" || cat === "stocks" || cat === "crypto") return 2;
  return 2;
}

function display(sym, cat) {
  if (derivedDisplay[sym]) return derivedDisplay[sym];
  if (stockDisplay[sym]) return stockDisplay[sym];
  if (indexDisplay[sym]) return indexDisplay[sym];
  if (cat === "forex" || cat === "metals") return sym.slice(0, 3) + "/" + sym.slice(3);
  if (cat === "crypto") return sym.replace(/USD(T?)$/, "") + "/USD";
  if (cat === "energy") return sym;
  return sym;
}

const all = [
  ...fx.map((s) => ({ symbol: s, category: "forex" })),
  ...crypto.map((s) => ({ symbol: s, category: "crypto" })),
  ...metals.map((s) => ({ symbol: s, category: "metals" })),
  ...energy.map((s) => ({ symbol: s, category: "energy" })),
  ...indices.map((s) => ({ symbol: s, category: "indices" })),
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
console.log("NOTE: restart the server so the price feed subscribes to the new symbols.");
await prisma.$disconnect();
