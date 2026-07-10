"use client";
import { useEffect, useState } from "react";
import TVChart, { type ChartPosition, type TVChartActions } from "./TVChart";
import LWChart from "./LWChart";

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
  showBuiltinOHLC?: boolean;
  onTfChange?: (tf: string) => void;
}

// Domain that holds the licensed TradingView Advanced Charting Library.
// All other tenant domains use Lightweight Charts with the platform's own MT5 feed.
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
    return <TVChart {...props} showBuiltinOHLC={props.showBuiltinOHLC} />;
  }

  // Other white-label tenant domains: Lightweight Charts with the platform's own
  // MT5 data feed and position overlays — no TradingView dependency.
  return (
    <LWChart
      symbol={props.symbol}
      tf={props.tf}
      theme={props.theme}
      digits={props.digits}
      positions={props.positions as any}
      spreadPips={props.spreadPips}
      onCandleUpdate={props.onCandleUpdate}
      onTfChange={props.onTfChange}
    />
  );
}
