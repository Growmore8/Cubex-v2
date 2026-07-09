"use client";
import { useEffect, useRef } from "react";

// TradingView Advanced Chart Widget — public embed for white-label tenant domains.
// The licensed Advanced Charting Library is restricted to trade.growthcapitalltd.com
// per the domain license agreement. All other tenant domains use this free public widget
// which loads from TradingView's own CDN and uses TradingView's own market data.

// Map internal TF strings to TradingView widget intervals
const TF_MAP: Record<string, string> = {
  "1M": "1", "5M": "5", "15M": "15", "30M": "30",
  "1H": "60", "4H": "240", "1D": "D", "1W": "W",
};

// Best-effort mapping from MT5-style symbol names to TradingView public symbols.
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
  // Standard 6-char forex pairs
  if (s.length === 6 && /^[A-Z]+$/.test(s)) return "FX_IDC:" + s;
  // Crypto: common pairs against USD/USDT
  const cryptoBases = ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","LTC","DOT","LINK","AVAX","MATIC","UNI","ATOM","FIL","TRX","SHIB"];
  for (const base of cryptoBases) {
    if (s === base + "USD" || s === base + "USDT") return "BINANCE:" + base + "USDT";
  }
  return s;
}

let _tvScriptLoaded = false;
let _tvScriptCallbacks: (() => void)[] = [];

function loadTVScript(cb: () => void) {
  if (_tvScriptLoaded) { cb(); return; }
  _tvScriptCallbacks.push(cb);
  if (_tvScriptCallbacks.length > 1) return; // already loading
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/tv.js";
  s.async = true;
  s.onload = () => {
    _tvScriptLoaded = true;
    _tvScriptCallbacks.forEach((fn) => fn());
    _tvScriptCallbacks = [];
  };
  s.onerror = () => {
    _tvScriptCallbacks = [];
  };
  document.head.appendChild(s);
}

interface Props {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
}

export default function TVWidget({ symbol, tf, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef    = useRef<any>(null);
  const cancelRef    = useRef(false);

  useEffect(() => {
    cancelRef.current = false;

    loadTVScript(() => {
      if (cancelRef.current || !containerRef.current) return;

      const TV = (window as any).TradingView;
      if (!TV || typeof TV.widget !== "function") return;

      // Destroy previous widget instance
      try { widgetRef.current?.remove?.(); } catch {}
      widgetRef.current = null;
      containerRef.current.innerHTML = "";

      const inner = document.createElement("div");
      inner.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      containerRef.current.appendChild(inner);

      widgetRef.current = new TV.widget({
        container:          inner,
        autosize:           true,
        symbol:             toTVSymbol(symbol),
        interval:           TF_MAP[tf] || "D",
        timezone:           "Etc/UTC",
        theme:              theme === "dark" ? "dark" : "light",
        style:              "1",
        locale:             "en",
        toolbar_bg:         theme === "dark" ? "#0f1117" : "#f0f3fa",
        enable_publishing:  false,
        allow_symbol_change: true,
        hide_top_toolbar:   false,
        save_image:         false,
      });
    });

    return () => {
      cancelRef.current = true;
      try { widgetRef.current?.remove?.(); } catch {}
      widgetRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [symbol, tf, theme]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
