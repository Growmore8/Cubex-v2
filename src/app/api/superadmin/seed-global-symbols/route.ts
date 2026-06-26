import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// New symbols to add to the global catalog
const NEW_SYMBOLS = [
  // ── More forex crosses ──
  { symbol: "GBPAUD", display: "GBP/AUD", category: "forex", digits: 5 },
  { symbol: "GBPCAD", display: "GBP/CAD", category: "forex", digits: 5 },
  { symbol: "GBPNZD", display: "GBP/NZD", category: "forex", digits: 5 },
  { symbol: "EURNZD", display: "EUR/NZD", category: "forex", digits: 5 },
  { symbol: "EURAUD", display: "EUR/AUD", category: "forex", digits: 5 },
  { symbol: "CADCHF", display: "CAD/CHF", category: "forex", digits: 5 },
  { symbol: "CADJPY", display: "CAD/JPY", category: "forex", digits: 3 },
  { symbol: "CHFJPY", display: "CHF/JPY", category: "forex", digits: 3 },
  { symbol: "NZDCAD", display: "NZD/CAD", category: "forex", digits: 5 },
  { symbol: "NZDCHF", display: "NZD/CHF", category: "forex", digits: 5 },
  { symbol: "USDMXN", display: "USD/MXN", category: "forex", digits: 4 },
  { symbol: "USDZAR", display: "USD/ZAR", category: "forex", digits: 4 },
  // ── Indices ──
  { symbol: "US500",  display: "S&P 500",   category: "indices", digits: 2 },
  { symbol: "US30",   display: "Dow Jones",  category: "indices", digits: 2 },
  { symbol: "US100",  display: "NASDAQ 100", category: "indices", digits: 2 },
  { symbol: "GER40",  display: "DAX 40",     category: "indices", digits: 2 },
  { symbol: "UK100",  display: "FTSE 100",   category: "indices", digits: 2 },
  { symbol: "JP225",  display: "Nikkei 225", category: "indices", digits: 2 },
  // ── Energy ──
  { symbol: "USOIL",  display: "WTI Oil",     category: "energy", digits: 2 },
  { symbol: "UKOIL",  display: "Brent Oil",   category: "energy", digits: 2 },
  { symbol: "NATGAS", display: "Natural Gas", category: "energy", digits: 3 },
  // ── More crypto (Binance feed) ──
  { symbol: "XRPUSD",  display: "XRP/USD",  category: "crypto", digits: 4 },
  { symbol: "ADAUSD",  display: "ADA/USD",  category: "crypto", digits: 4 },
  { symbol: "AVAXUSD", display: "AVAX/USD", category: "crypto", digits: 2 },
  { symbol: "LINKUSD", display: "LINK/USD", category: "crypto", digits: 3 },
  { symbol: "LTCUSD",  display: "LTC/USD",  category: "crypto", digits: 2 },
  { symbol: "DOTUSD",  display: "DOT/USD",  category: "crypto", digits: 3 },
];

export async function POST() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    let added = 0, skipped = 0;
    for (const sym of NEW_SYMBOLS) {
      const existing = await prisma.globalSymbol.findFirst({ where: { symbol: sym.symbol } });
      if (existing) { skipped++; continue; }
      await prisma.globalSymbol.create({
        data: { symbol: sym.symbol, display: sym.display, category: sym.category, digits: sym.digits, enabled: true },
      });
      added++;
    }
    return NextResponse.json({ ok: true, added, skipped, total: NEW_SYMBOLS.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
