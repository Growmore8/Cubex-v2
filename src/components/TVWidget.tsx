"use client";
import { useEffect, useRef } from "react";

// TradingView Advanced Chart Widget — public embed for white-label tenant domains.
// The licensed Advanced Charting Library is restricted to trade.growthcapitalltd.com
// per the domain license agreement. All other tenant domains use this free public widget
// which loads from TradingView's own CDN and uses TradingView's own market data.
//
// Limitations vs the licensed library:
//   • Uses TV's public market data — NOT the broker's MT5 data feed
//   • No custom position / SL / TP overlays
//   • Symbol must resolve in TradingView's public symbol database

// Map internal TF strings to TradingView widget intervals
const TF_MAP: Record<string, string> = {
  "1M": "1", "5M": "5", "15M": "15", "30M": "30",
  "1H": "60", "4H": "240", "1D": "D", "1W": "W",
};

// Best-effort mapping from MT5-style symbol names to TradingView public symbols.
// TV's resolver handles most major pairs; metals and indices need explicit prefixes.
function toTVSymbol(sym: string): string {
  const s = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Metals
  if (s === "XAUUSD" || s === "GOLDUSD") return "TVC:GOLD";
  if (s === "XAGUSD" || s === "SILVERUSD") return "TVC:SILVER";
  if (s === "XPTUSD") return "TVC:PLATINUM";
  if (s === "XPDUSD") return "TVC:PALLADIUM";
  // Major US indices
  if (s === "US30" || s === "DJI" || s === "DOW30") return "TVC:DJI";
  if (s === "US500" || s === "SPX500" || s === "SP500") return "TVC:SPX";
  if (s === "US100" || s === "NAS100" || s === "NDX") return "TVC:NDX";
  if (s === "US2000" || s === "RUT") return "TVC:RUT";
  // European indices
  if (s === "UK100" || s === "FTSE100") return "TVC:UKX";
  if (s === "GER40" || s === "GER30" || s === "DAX") return "TVC:DAX";
  if (s === "FRA40" || s === "CAC40") return "TVC:CAC40";
  // Energy
  if (s === "USOIL" || s === "WTI" || s === "CRUDEOIL") return "TVC:USOIL";
  if (s === "UKOIL" || s === "BRENT") return "TVC:UKOIL";
  // Natural gas
  if (s === "NATGAS" || s === "NATURALGAS") return "TVC:NATURALGAS";
  // Standard 6-char forex pairs — FX_IDC provides real-time quotes without exchange fees
  if (s.length === 6) return "FX_IDC:" + s;
  // Crypto: common pairs against USD
  const cryptoBases = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "LTC", "DOT", "LINK", "AVAX", "MATIC", "UNI", "ATOM", "FIL", "TRX", "SHIB"];
  for (const base of cryptoBases) {
    if (s === base + "USD" || s === base + "USDT") return "BINANCE:" + base + "USDT";
  }
  // Fallback: pass as-is and let TV's resolver handle it
  return s;
}

interface Props {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
}

let _widgetSeq = 0;

export default function TVWidget({ symbol, tf, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef    = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const tvSym    = toTVSymbol(symbol);
    const interval = TF_MAP[tf] || "D";
    const id       = "tvw_" + (++_widgetSeq);

    // Clear previous content
    containerRef.current.innerHTML = "";
    widgetRef.current = null;

    const inner = document.createElement("div");
    inner.id = id;
    inner.style.cssText = "position:absolute;inset:0;";
    containerRef.current.appendChild(inner);

    const init = () => {
      if (!containerRef.current || !(window as any).TradingView) return;
      widgetRef.current = new (window as any).TradingView.widget({
        autosize:         true,
        symbol:           tvSym,
        interval,
        timezone:         "Etc/UTC",
        theme:            theme === "dark" ? "dark" : "light",
        style:            "1",   // 1 = Candlestick
        locale:           "en",
        toolbar_bg:       theme === "dark" ? "#0f1117" : "#f0f3fa",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id:     id,
        hide_top_toolbar: false,
        save_image:       false,
      });
    };

    if ((window as any).TradingView?.widget) {
      // Script already loaded by a previous mount
      init();
    } else {
      const script = document.createElement("script");
      script.src   = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = init;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove?.(); } catch {}
        widgetRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [symbol, tf, theme]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
