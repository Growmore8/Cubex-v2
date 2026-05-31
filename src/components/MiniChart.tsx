"use client";

function tvSymbol(sym: string) {
  const s = sym.toUpperCase().replace("/", "");
  const crypto = ["BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "DOT", "MATIC", "LTC", "TRX", "AVAX", "LINK", "SHIB"];
  if (s === "XAUUSD") return "OANDA:XAUUSD";
  if (s === "XAGUSD") return "OANDA:XAGUSD";
  const base = s.replace("USDT", "").replace("USD", "");
  if (crypto.indexOf(base) !== -1) return "BINANCE:" + base + "USDT";
  if (/^[A-Z]{6}$/.test(s)) return "FX:" + s;
  return s;
}
function tvInterval(tf: string) {
  const m: any = { "1M": "1", "5M": "5", "15M": "15", "30M": "30", "1H": "60", "4H": "240", "1D": "D" };
  return m[tf] || "60";
}

export default function MiniChart({ symbol, tf, theme }: { symbol: string; tf: string; theme: "dark" | "light" }) {
  if (!symbol) return <div style={{ height: "100%", width: "100%" }} />;
  const url = "https://s.tradingview.com/widgetembed/?symbol=" + encodeURIComponent(tvSymbol(symbol)) +
    "&interval=" + tvInterval(tf) + "&theme=" + theme + "&style=1&locale=en&timezone=Etc/UTC" +
    "&hidetoptoolbar=1&hide_top_toolbar=1&hidesidetoolbar=1&hide_side_toolbar=1&hideideas=1&withdateranges=0&saveimage=0&allow_symbol_change=0";
  return <iframe key={url} src={url} title={symbol} style={{ width: "100%", height: "100%", border: 0, display: "block" }} />;
}