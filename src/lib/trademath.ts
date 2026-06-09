import instruments from "@/config/instruments";
import { contractFor } from "@/config/contracts";

export function contractSize(symbol: string, category?: string): number {
  return instruments[symbol]?.contractSize ?? contractFor(category || "forex", symbol);
}

// Required margin in USD. JPY-quoted pairs are corrected: the platform was
// computing them ~100x too high because the quote price is in JPY (~100-160).
export function marginFor(symbol: string, lots: number, price: number, leverage: number, category?: string): number {
  const cs = contractSize(symbol, category);
  let m = (lots * cs * price) / (leverage || 100);
  if (/JPY$/i.test(symbol)) m = m / 100;
  return m;
}

// Hedged (net) used margin: positions are netted per symbol (BUY lots − SELL lots),
// and margin is charged only on the absolute NET volume of each symbol. A fully
// hedged symbol (equal buy/sell) requires 0 margin; a partial hedge charges the
// remaining net exposure.
export function usedMargin(
  positions: { symbol: string; type: "BUY" | "SELL"; lots: number | string }[],
  leverage: number,
  priceOf: (symbol: string) => number | undefined | null,
  categoryOf?: (symbol: string) => string | undefined,
): number {
  const net: Record<string, number> = {};
  for (const p of positions) net[p.symbol] = (net[p.symbol] || 0) + (p.type === "BUY" ? 1 : -1) * Number(p.lots);
  let total = 0;
  for (const sym in net) {
    const nl = Math.abs(net[sym]);
    if (nl < 1e-9) continue;
    const price = priceOf(sym);
    if (!price) continue;
    total += marginFor(sym, nl, price, leverage, categoryOf?.(sym));
  }
  return total;
}

export function isForex(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (/^(XAU|XAG|XPT|XPD)/.test(s)) return false; // metals
  if (s.endsWith("USDT")) return false;            // crypto
  return /^[A-Z]{6}$/.test(s);                      // 6-letter fx pair
}
export function pipSize(symbol: string): number {
  return /JPY$/i.test(symbol) ? 0.01 : 0.0001;
}

// Floating / closed P&L in USD — STANDARD contract-size model (1.0 lot = the
// instrument's contract size; forex = 100,000 units, i.e. $10 per pip per lot).
//   GBPUSD 0.1 lot, 834.1 pips => 0.08341 * 0.1 * 100000 = $834.10.
//   When USD is the BASE currency (USDJPY, USDCHF, USDCAD…) the P&L lands in the
//   quote currency, so it is converted to USD by dividing by the current rate.
// Metals / crypto / indices use their own contract size (unchanged).
export function pnlFor(symbol: string, type: "BUY" | "SELL", openPrice: number, price: number, lots: number, category?: string): number {
  const dir = type === "BUY" ? 1 : -1;
  const diff = (price - openPrice) * dir;
  const cs = contractSize(symbol, category);
  let profit = diff * lots * cs;
  if (isForex(symbol) && /^USD/i.test(symbol)) profit = profit / (price || 1); // USD as base -> convert to USD
  return profit;
}

// TP/SL placement rule:
//  BUY  -> TP must be ABOVE open, SL must be BELOW open
//  SELL -> TP must be BELOW open, SL must be ABOVE open
// Zero means "off" and is always allowed. Returns an error string or null.
export function validateSlTp(type: "BUY" | "SELL", openPrice: number, sl?: number, tp?: number): string | null {
  const slV = Number(sl) || 0;
  const tpV = Number(tp) || 0;
  if (type === "BUY") {
    if (slV > 0 && slV >= openPrice) return "For a BUY, Stop Loss must be below the open price";
    if (tpV > 0 && tpV <= openPrice) return "For a BUY, Take Profit must be above the open price";
  } else {
    if (slV > 0 && slV <= openPrice) return "For a SELL, Stop Loss must be above the open price";
    if (tpV > 0 && tpV >= openPrice) return "For a SELL, Take Profit must be below the open price";
  }
  return null;
}
