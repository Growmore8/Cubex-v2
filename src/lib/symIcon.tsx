"use client";
import React, { useState } from "react";

// Currency -> ISO country (flagcdn), short code, and brand colour (fallback chip).
const CCY: Record<string, string> = {
  EUR: "eu", USD: "us", GBP: "gb", JPY: "jp", AUD: "au", CAD: "ca", CHF: "ch", NZD: "nz",
  CNH: "cn", CNY: "cn", SGD: "sg", HKD: "hk", ZAR: "za", TRY: "tr", MXN: "mx", NOK: "no",
  SEK: "se", DKK: "dk", PLN: "pl", INR: "in", RUB: "ru", BRL: "br", THB: "th",
};
const CODE: Record<string, string> = { EUR: "EU", USD: "US", GBP: "UK", JPY: "JP", AUD: "AU", CAD: "CA", CHF: "CH", NZD: "NZ", CNH: "CN", CNY: "CN", SGD: "SG", HKD: "HK", ZAR: "ZA", TRY: "TR", MXN: "MX", NOK: "NO", SEK: "SE", DKK: "DK", PLN: "PL", INR: "IN", RUB: "RU", BRL: "BR", THB: "TH" };
const COL: Record<string, string> = { EUR: "#3b82f6", USD: "#16a34a", GBP: "#6366f1", JPY: "#ef4444", AUD: "#0ea5e9", CAD: "#e11d48", CHF: "#dc2626", NZD: "#14b8a6", CNH: "#ef4444", SGD: "#22c55e", HKD: "#f97316" };
const CRYPTO: Record<string, [string, string]> = {
  BTC: ["₿", "#f7931a"], XBT: ["₿", "#f7931a"], ETH: ["Ξ", "#627eea"], BNB: ["B", "#f3ba2f"],
  SOL: ["◎", "#9945ff"], XRP: ["✕", "#1c1c1c"], DOGE: ["Ð", "#c2a633"], ADA: ["₳", "#0033ad"],
  LTC: ["Ł", "#345d9d"], TRX: ["T", "#ef0027"], DOT: ["●", "#e6007a"], MATIC: ["M", "#8247e5"],
  AVAX: ["A", "#e84142"], LINK: ["L", "#2a5ada"], SHIB: ["S", "#f00500"], UNI: ["U", "#ff007a"],
  ATOM: ["A", "#2e3148"], FIL: ["F", "#0090ff"], ETC: ["Ξ", "#16a34a"], BCH: ["B", "#0ac18e"],
};
const METAL: Record<string, [string, string]> = {
  XAU: ["Au", "#eab308"], XAG: ["Ag", "#9ca3af"], XPT: ["Pt", "#94a3b8"], XPD: ["Pd", "#a3a3a3"], XTI: ["Oil", "#16a34a"], WTI: ["Oil", "#16a34a"],
};
const QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "BTC", "ETH"];

// Coloured round chip with a short label (always renders — never blank).
function Chip({ label, bg, size, ml }: { label: string; bg: string; size: number; ml: number }) {
  const fs = label.length >= 3 ? size * 0.34 : label.length === 2 ? size * 0.42 : size * 0.5;
  return <span style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", fontSize: fs, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", lineHeight: 1, border: "1.5px solid #0a0d12", marginLeft: ml }}>{label}</span>;
}
// Flag image that falls back to a coloured currency chip if it fails to load.
function Flag({ ccy, size, ml }: { ccy: string; size: number; ml: number }) {
  const [err, setErr] = useState(false);
  const iso = CCY[ccy];
  if (err || !iso) return <Chip label={CODE[ccy] || ccy.slice(0, 2)} bg={COL[ccy] || "#475569"} size={size} ml={ml} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/w40/${iso}.png`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1.5px solid #0a0d12", marginLeft: ml, flex: "none" }} />
  );
}
function assetIcon(code: string, size: number, ml: number): React.ReactNode {
  if (CRYPTO[code]) return <Chip label={CRYPTO[code][0]} bg={CRYPTO[code][1]} size={size} ml={ml} />;
  if (METAL[code]) return <Chip label={METAL[code][0]} bg={METAL[code][1]} size={size} ml={ml} />;
  if (CCY[code]) return <Flag ccy={code} size={size} ml={ml} />;
  return null;
}

export function SymIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const s = (symbol || "").toUpperCase();
  let base = s, quote = "";
  for (const q of QUOTES) { if (s.length > q.length && s.endsWith(q)) { quote = q; base = s.slice(0, s.length - q.length); break; } }
  const quoteCode = quote === "USDT" || quote === "USDC" ? "USD" : quote;
  // Base always renders (asset icon, or a lettered chip for stocks/indices/unknown).
  const baseEl = assetIcon(base, size, 0) || <Chip label={base.slice(0, 3)} bg="#475569" size={size} ml={0} />;
  const quoteEl = quoteCode ? (assetIcon(quoteCode, size, -size * 0.42) || <Chip label={CODE[quoteCode] || quoteCode.slice(0, 2)} bg={COL[quoteCode] || "#475569"} size={size} ml={-size * 0.42} />) : null;
  return <span style={{ display: "inline-flex", alignItems: "center", flex: "none" }}>{baseEl}{quoteEl}</span>;
}
