"use client";

// TradingView Advanced Chart Widget — iframe embed for white-label tenant domains.
// The licensed Advanced Charting Library is restricted to trade.growthcapitalltd.com.
// All other tenant domains use this free public widget via TV's widgetembed URL —
// no JavaScript SDK, no script loading, just a direct iframe.

const TF_MAP: Record<string, string> = {
  "1M": "1", "5M": "5", "15M": "15", "30M": "30",
  "1H": "60", "4H": "240", "1D": "D", "1W": "W",
};

function toTVSymbol(sym: string): string {
  const s = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s === "XAUUSD" || s === "GOLDUSD") return "TVC:GOLD";
  if (s === "XAGUSD" || s === "SILVERUSD") return "TVC:SILVER";
  if (s === "XPTUSD") return "TVC:PLATINUM";
  if (s === "XPDUSD") return "TVC:PALLADIUM";
  if (s === "US30"  || s === "DJI"    || s === "DOW30")  return "TVC:DJI";
  if (s === "US500" || s === "SPX500" || s === "SP500")  return "TVC:SPX";
  if (s === "US100" || s === "NAS100" || s === "NDX")    return "TVC:NDX";
  if (s === "US2000"|| s === "RUT")                      return "TVC:RUT";
  if (s === "UK100" || s === "FTSE100")                  return "TVC:UKX";
  if (s === "GER40" || s === "GER30"  || s === "DAX")    return "TVC:DAX";
  if (s === "FRA40" || s === "CAC40")                    return "TVC:CAC40";
  if (s === "USOIL" || s === "WTI"    || s === "CRUDEOIL") return "TVC:USOIL";
  if (s === "UKOIL" || s === "BRENT")                    return "TVC:UKOIL";
  if (s === "NATGAS"|| s === "NATURALGAS")               return "TVC:NATURALGAS";
  if (s.length === 6 && /^[A-Z]+$/.test(s)) return "FX_IDC:" + s;
  const crypto = ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","LTC","DOT","LINK","AVAX","MATIC","UNI","ATOM","FIL","TRX","SHIB"];
  for (const b of crypto) {
    if (s === b + "USD" || s === b + "USDT") return "BINANCE:" + b + "USDT";
  }
  return s;
}

interface Props { symbol: string; tf: string; theme: "dark" | "light" }

export default function TVWidget({ symbol, tf, theme }: Props) {
  const tvSym   = toTVSymbol(symbol);
  const interval = TF_MAP[tf] || "D";
  const tvTheme  = theme === "dark" ? "dark" : "light";

  const src =
    "https://www.tradingview.com/widgetembed/?" +
    "symbol="   + encodeURIComponent(tvSym) +
    "&interval=" + encodeURIComponent(interval) +
    "&theme="    + tvTheme +
    "&style=1&locale=en&timezone=Etc%2FUTC" +
    "&hide_top_toolbar=0&hidesidetoolbar=0" +
    "&allow_symbol_change=1&save_image=0&details=0&calendar=0";

  return (
    <iframe
      key={tvSym + "-" + interval + "-" + tvTheme}
      src={src}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
      allowFullScreen
      title="TradingView Chart"
    />
  );
}
