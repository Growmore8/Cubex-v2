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

export function isForex(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (/^(XAU|XAG|XPT|XPD)/.test(s)) return false; // metals
  if (s.endsWith("USDT")) return false;            // crypto
  return /^[A-Z]{6}$/.test(s);                      // 6-letter fx pair
}
export function pipSize(symbol: string): number {
  return /JPY$/i.test(symbol) ? 0.01 : 0.0001;
}

// Floating / closed P&L in USD.
// Forex: $1 per pip per 1.0 lot when USD is the quote currency (e.g. GBPUSD).
//   GBPUSD 144 pips, 0.01 lot => 144 * 0.01 = $1.44.
//   When USD is the base currency (USDJPY, USDCHF, USDCAD…), the quote-currency
//   P&L is converted to USD by dividing by the current rate.
// Metals / crypto / indices keep the contract-size model.
export function pnlFor(symbol: string, type: "BUY" | "SELL", openPrice: number, price: number, lots: number, category?: string): number {
  const dir = type === "BUY" ? 1 : -1;
  const diff = (price - openPrice) * dir;
  if (isForex(symbol)) {
    const pips = diff / pipSize(symbol);
    let profit = pips * lots; // $1 / pip / lot (USD as quote)
    if (/^USD/i.test(symbol)) profit = profit / (price || 1); // USD as base -> convert to USD
    return profit;
  }
  const cs = contractSize(symbol, category);
  return diff * lots * cs;
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
