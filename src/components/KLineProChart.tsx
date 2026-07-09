"use client";
import { useEffect, useState } from "react";
import TVChart, { type ChartPosition, type TVChartActions } from "./TVChart";
import TVWidget from "./TVWidget";

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
  hideLegend?: boolean;
  onSymbolChange?: (sym: string) => void;
  onCandleUpdate?: (bar: { open: number; high: number; low: number; close: number }) => void;
  onActionsReady?: (actions: TVChartActions) => void;
  spreadPips?: number;
}

// Domain that holds the licensed TradingView Advanced Charting Library.
// All other tenant domains use the free TradingView Advanced Chart Widget
// (public embed from TradingView's CDN — uses TV's own market data).
const TV_LIBRARY_DOMAIN = "trade.growthcapitalltd.com";

export default function KLineProChart(props: Props) {
  const [hostname, setHostname] = useState<string | null>(null);

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  if (hostname === null) {
    return <div style={{ position: "absolute", inset: 0 }} />;
  }

  if (hostname === TV_LIBRARY_DOMAIN) {
    // Licensed domain: full Advanced Charting Library with custom MT5 data feed,
    // position overlays, spread line, and all platform integrations.
    return <TVChart {...props} />;
  }

  // Other white-label tenant domains: free public TradingView Advanced Chart Widget.
  // Uses TradingView's own market data — no custom broker data feed.
  return <TVWidget symbol={props.symbol} tf={props.tf} theme={props.theme} />;
}
