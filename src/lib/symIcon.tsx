import React from "react";

// Maps an instrument symbol to a currency/asset glyph + colour, for the small
// round icons in market-watch lists.
const MAP: Record<string, [string, string]> = {
  BTC: ["฿", "#f7931a"], ETH: ["Ξ", "#627eea"], BNB: ["B", "#f3ba2f"], SOL: ["◎", "#9945ff"],
  XRP: ["✕", "#23292f"], DOGE: ["Ð", "#c2a633"], ADA: ["₳", "#0033ad"], LTC: ["Ł", "#345d9d"],
  TRX: ["T", "#ef0027"], DOT: ["●", "#e6007a"], MATIC: ["M", "#8247e5"], AVAX: ["A", "#e84142"],
  XAU: ["Au", "#eab308"], XAG: ["Ag", "#9ca3af"], XPT: ["Pt", "#94a3b8"], WTI: ["⛽", "#16a34a"], USOIL: ["⛽", "#16a34a"], UKOIL: ["⛽", "#0ea5e9"],
  EUR: ["€", "#3b82f6"], GBP: ["£", "#6366f1"], USD: ["$", "#16a34a"], JPY: ["¥", "#ef4444"],
  AUD: ["$", "#0ea5e9"], CAD: ["$", "#e11d48"], CHF: ["₣", "#dc2626"], NZD: ["$", "#14b8a6"],
  CNH: ["¥", "#ef4444"], SGD: ["$", "#22c55e"], HKD: ["$", "#f97316"], ZAR: ["R", "#84cc16"],
  NAS: ["N", "#3b82f6"], SPX: ["S", "#16a34a"], US30: ["D", "#6366f1"], US500: ["S", "#16a34a"], US100: ["N", "#3b82f6"], GER: ["D", "#eab308"], UK100: ["U", "#6366f1"], JP225: ["N", "#ef4444"],
};

export function symGlyph(symbol: string): [string, string] {
  const s = (symbol || "").toUpperCase();
  for (const k of Object.keys(MAP)) if (s.startsWith(k)) return MAP[k];
  return [s.charAt(0) || "?", "#475569"];
}

export function SymIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const [glyph, bg] = symGlyph(symbol);
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", fontSize: size * 0.52, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", lineHeight: 1 }}>{glyph}</span>
  );
}
