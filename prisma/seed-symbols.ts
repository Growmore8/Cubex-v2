import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const forex = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURJPY","GBPJPY","EURGBP","EURCHF","AUDJPY","EURAUD","GBPCHF","CADJPY"];
const metals = ["XAUUSD","XAGUSD"];
const crypto = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LTCUSDT"];

const rows: any[] = [];
for (const s of forex) rows.push({ symbol: s, display: s.slice(0,3)+"/"+s.slice(3), category: "forex", digits: s.includes("JPY")?3:5, feed: "OANDA:"+s.slice(0,3)+"_"+s.slice(3) });
for (const s of metals) rows.push({ symbol: s, display: s.slice(0,3)+"/"+s.slice(3), category: "metals", digits: 2, feed: "OANDA:"+s.slice(0,3)+"_"+s.slice(3) });
for (const s of crypto) { const base = s.replace("USDT",""); rows.push({ symbol: s, display: base+"/USDT", category: "crypto", digits: 2, feed: "BINANCE:"+s }); }

async function main() {
  for (const r of rows) {
    await prisma.globalSymbol.upsert({ where: { symbol: r.symbol }, update: { display: r.display, category: r.category, digits: r.digits, feed: r.feed }, create: { ...r, enabled: true } });
  }
  console.log("Seeded " + rows.length + " global symbols.");
}
main().finally(() => prisma.$disconnect());
