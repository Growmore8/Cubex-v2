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

function flag(iso: string, size: number, ml = 0): React.ReactNode {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/w40/${iso}.png`} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1.5px solid #0a0d12", marginLeft: ml, flex: "none" }} />
  );
}
function chip(glyph: string, bg: string, size: number): React.ReactNode {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", fontSize: size * 0.52, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", lineHeight: 1 }}>{glyph}</span>;
}

export function SymIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const s = (symbol || "").toUpperCase();
  for (const k of Object.keys(CRYPTO)) if (s.startsWith(k)) return <>{chip(CRYPTO[k][0], CRYPTO[k][1], size)}</>;
  for (const k of Object.keys(METAL)) if (s.startsWith(k)) return <>{chip(METAL[k][0], METAL[k][1], size)}</>;
  const base = s.slice(0, 3), quote = s.slice(3, 6);
  if (CCY[base] && CCY[quote]) {
    // forex pair → two overlapping circular flags (like the reference)
    return <span style={{ display: "inline-flex", alignItems: "center", flex: "none" }}>{flag(CCY[base], size)}{flag(CCY[quote], size, -size * 0.42)}</span>;
  }
  if (CCY[base]) return <>{flag(CCY[base], size)}</>;
  return <>{chip(s.charAt(0) || "?", "#475569", size)}</>;
}
