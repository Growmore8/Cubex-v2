"use client";
// KLineProChart — now powered by TradingView Charting Library.
// Drop-in replacement: same props interface, no changes needed in pages.
import TVChart, { type ChartPosition } from "./TVChart";

export type { ChartPosition };

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

export default function KLineProChart({
  symbol, tf, theme, digits = 2, symbols, positions, bare, onSymbolChange, spreadPips,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  symbols?: Sym[];
  positions?: ChartPosition[];
  bare?: boolean;
  onSymbolChange?: (sym: string) => void;
  spreadPips?: number;
}) {
  return (
    <TVChart
      symbol={symbol}
      tf={tf}
      theme={theme}
      digits={digits}
      symbols={symbols}
      positions={positions}
      bare={bare}
      onSymbolChange={onSymbolChange}
      spreadPips={spreadPips}
    />
  );
}
