"use client";
import TVChart, { type ChartPosition, type TVChartActions } from "./TVChart";

export type { ChartPosition, TVChartActions };

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

interface Props {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  symbols?: Sym[];
  positions?: ChartPosition[];
  bare?: boolean;
  showDrawingTools?: boolean;
  chartType?: number;
  onSymbolChange?: (sym: string) => void;
  onCandleUpdate?: (bar: { open: number; high: number; low: number; close: number }) => void;
  onActionsReady?: (actions: TVChartActions) => void;
  spreadPips?: number;
}

// Desktop chart — TradingView Advanced Charts Library for all domains.
// Mobile (ClientMobile.tsx) handles its own routing: TVChart on trade.growthcapitalltd.com,
// LWChart on all other white-label tenant domains.
export default function KLineProChart(props: Props) {
  return <TVChart {...props} />;
}
