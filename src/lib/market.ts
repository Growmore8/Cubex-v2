// Market-hours check shared by the trade-placement APIs (mirrors server.js).
// Crypto = 24/7; forex & metals close on the weekend (Fri 21:00 UTC → Sun 21:00 UTC);
// stocks/indices trade weekday US hours.
export function isMarketOpen(symbol: string, category?: string | null): boolean {
  const sym = String(symbol || "").toUpperCase();
  const c = String(category || "").toLowerCase();
  if (c === "crypto" || /USDT$/.test(sym) || /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC|DOT|AVAX|TRX|LINK|SHIB|MATIC|UNI)/.test(sym)) return true;
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const h = now.getUTCHours();
  if (c === "stocks" || c === "indices") {
    if (day === 0 || day === 6) return false;
    return h >= 13 && h < 21;
  }
  // Forex & metals: weekend close — only for confirmed fx/metals; unknown stays open.
  const isFx = c === "forex" || c === "metals" || /^(XAU|XAG|XPT|XPD)/.test(sym) || /^[A-Z]{6}$/.test(sym);
  if (isFx) {
    if (day === 6) return false;
    if (day === 0 && h < 21) return false;
    if (day === 5 && h >= 21) return false;
    return true;
  }
  return true;
}
