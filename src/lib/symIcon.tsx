import React from "react";

// Currency -> ISO country code (for circular flag images via flagcdn).
const CCY: Record<string, string> = {
  EUR: "eu", USD: "us", GBP: "gb", JPY: "jp", AUD: "au", CAD: "ca", CHF: "ch", NZD: "nz",
  CNH: "cn", CNY: "cn", SGD: "sg", HKD: "hk", ZAR: "za", TRY: "tr", MXN: "mx", NOK: "no",
  SEK: "se", DKK: "dk", PLN: "pl", INR: "in", RUB: "ru", BRL: "br", THB: "th",
};
// Crypto / metals -> [glyph, colour] for a coloured logo chip.
const CRYPTO: Record<string, [string, string]> = {
  BTC: ["₿", "#f7931a"], XBT: ["₿", "#f7931a"], ETH: ["Ξ", "#627eea"], BNB: ["B", "#f3ba2f"],
  SOL: ["◎", "#9945ff"], XRP: ["✕", "#1c1c1c"], DOGE: ["Ð", "#c2a633"], ADA: ["₳", "#0033ad"],
  LTC: ["Ł", "#345d9d"], TRX: ["T", "#ef0027"], DOT: ["●", "#e6007a"], MATIC: ["M", "#8247e5"],
  AVAX: ["A", "#e84142"], LINK: ["L", "#2a5ada"], SHIB: ["S", "#f00500"],
};
const METAL: Record<string, [string, string]> = {
  XAU: ["Au", "#eab308"], XAG: ["Ag", "#9ca3af"], XPT: ["Pt", "#94a3b8"], XPD: ["Pd", "#a3a3a3"],
};
// Quote tokens to strip from the end (longest first so USDT beats USD).
const QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "BTC", "ETH"];

function flagEl(iso: string, size: number, ml = 0): React.ReactNode {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/w40/${iso}.png`} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1.5px solid #0a0d12", marginLeft: ml, flex: "none" }} />
  );
}
function chipEl(glyph: string, bg: string, size: number, ml = 0): React.ReactNode {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", fontSize: size * 0.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", lineHeight: 1, border: "1.5px solid #0a0d12", marginLeft: ml }}>{glyph}</span>;
}
// One icon for a single asset/currency code, or null if unknown.
function iconFor(code: string, size: number, ml = 0): React.ReactNode {
  if (CCY[code]) return flagEl(CCY[code], size, ml);
  if (CRYPTO[code]) return chipEl(CRYPTO[code][0], CRYPTO[code][1], size, ml);
  if (METAL[code]) return chipEl(METAL[code][0], METAL[code][1], size, ml);
  return null;
}

export function SymIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const s = (symbol || "").toUpperCase();
  // Split BASE + QUOTE (e.g. XAUUSD -> XAU + USD, BTCUSDT -> BTC + USDT).
  let base = s, quote = "";
  for (const q of QUOTES) { if (s.length > q.length && s.endsWith(q)) { quote = q; base = s.slice(0, s.length - q.length); break; } }
  const quoteCode = quote === "USDT" || quote === "USDC" ? "USD" : quote;
  const baseEl = iconFor(base, size);
  const quoteEl = quoteCode ? iconFor(quoteCode, size, -size * 0.42) : null;
  if (baseEl && quoteEl) return <span style={{ display: "inline-flex", alignItems: "center", flex: "none" }}>{baseEl}{quoteEl}</span>;
  if (baseEl) return <>{baseEl}</>;
  // stocks / indices / unknown → single lettered chip
  return <>{chipEl(s.charAt(0) || "?", "#475569", size)}</>;
}
