"use client";
import { useMemo } from "react";

// ─── Unified clean chart used by Admin, Manager, Client (desktop + mobile) ───
// Clean TradingView candlestick embed (no drawing toolbar, no volume, no watermark)
// with an optional running-trades overlay panel docked on the chart.

function tvSymbol(sym: string) {
  const s = sym.toUpperCase().replace("/", "");
  const crypto = ["BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "DOT", "MATIC", "LTC", "TRX", "AVAX", "LINK", "SHIB"];
  if (s === "XAUUSD") return "OANDA:XAUUSD";
  if (s === "XAGUSD") return "OANDA:XAGUSD";
  if (/^(XPT|XPD)/.test(s)) return "OANDA:" + s;
  const base = s.replace("USDT", "").replace("USD", "");
  if (crypto.indexOf(base) !== -1) return "BINANCE:" + base + "USDT";
  if (/^[A-Z]{6}$/.test(s)) return "FX:" + s;
  return s;
}
function tvInterval(tf: string) {
  const m: any = { "1M": "1", "5M": "5", "15M": "15", "30M": "30", "1H": "60", "4H": "240", "1D": "D" };
  return m[tf] || "1";
}

export type ChartPosition = {
  id: string;
  type: "BUY" | "SELL";
  lots: number | string;
  openPrice: number;
  sl?: number;
  tp?: number;
  pnl?: number;
};

export default function TradeChart({
  symbol, tf, theme, positions, digits = 2, onClose, studies,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  positions?: ChartPosition[];
  digits?: number;
  onClose?: (id: string) => void;
  studies?: string[];
}) {
  const BUY = "#2f81f7", SELL = "#e05260";

  const url = useMemo(() => {
    if (!symbol) return "";
    const st = studies && studies.length ? encodeURIComponent(JSON.stringify(studies)) : "%5B%5D";
    return "https://s.tradingview.com/widgetembed/?symbol=" + encodeURIComponent(tvSymbol(symbol)) +
      "&interval=" + tvInterval(tf) + "&theme=" + theme + "&style=1&locale=en&timezone=Etc/UTC" +
      "&hidetoptoolbar=1&hide_top_toolbar=1&hide_drawing_toolbar=1" +
      "&hidesidetoolbar=1&hide_side_toolbar=1&hideideas=1&withdateranges=0" +
      "&saveimage=0&allow_symbol_change=0&studies=" + st + "&no_referral_id=1&hide_volume=1&hide_legend=0";
  }, [symbol, tf, theme, (studies || []).join(",")]);

  if (!symbol) return <div style={{ height: "100%", width: "100%" }} />;

  const open = positions || [];
  const fmt = (n: number) => n.toFixed(digits);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <iframe key={url} src={url} title={symbol} style={{ width: "100%", height: "100%", border: 0, display: "block" }} />

      {/* Running trades overlay — floating positions panel on the chart */}
      {open.length > 0 && (
        <div
          style={{
            position: "absolute", left: 8, top: 8, zIndex: 12,
            maxWidth: 230, maxHeight: "55%", overflowY: "auto",
            background: "rgba(9,12,18,0.82)", border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8, backdropFilter: "blur(6px)", padding: 6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", padding: "1px 4px 4px" }}>
            Open Positions · {open.length}
          </div>
          {open.map((p) => {
            const c = p.type === "BUY" ? BUY : SELL;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderLeft: `2px solid ${c}`, marginBottom: 2, borderRadius: 3, background: "rgba(255,255,255,0.03)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c, lineHeight: 1.2 }}>{p.type} {p.lots}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>@ {fmt(p.openPrice)}</div>
                </div>
                {p.pnl !== undefined && (
                  <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: p.pnl >= 0 ? "#26a69a" : SELL }}>
                    {p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)}
                  </div>
                )}
                {onClose && (
                  <button onClick={() => onClose(p.id)} title="Close position" style={{ color: SELL, fontSize: 12, lineHeight: 1, padding: "0 2px", background: "transparent", border: "none", cursor: "pointer" }}>×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
