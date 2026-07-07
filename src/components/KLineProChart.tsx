"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { registerOverlay, init as klineInit } from "klinecharts";
import TVChart, { type ChartPosition } from "./TVChart";
import "@klinecharts/pro/dist/klinecharts-pro.css";
import { KLineChartPro } from "@klinecharts/pro";

export type { ChartPosition };

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
  onSymbolChange?: (sym: string) => void;
  spreadPips?: number;
}

// TradingView is licensed ONLY for this domain (Free Advanced Charts Agreement).
// All other tenants get KlineCharts Pro (MIT).
const TV_DOMAIN = "trade.growthcapitalltd.com";

// ─── Register custom price-line overlay (once at module load) ─────────────────
let _overlayRegistered = false;
function ensureOverlay() {
  if (_overlayRegistered) return;
  _overlayRegistered = true;
  try {
    registerOverlay({
      name: "cubeXLine",
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false, // custom Y-axis label via createYAxisFigures
      // Draw the horizontal price line across the chart
      createPointFigures({ overlay, coordinates, bounding }: any) {
        const d = (overlay.extendData ?? {}) as {
          color?: string; lineWidth?: number; lineStyle?: string;
        };
        const color     = d.color     ?? "#2962ff";
        const lineWidth = d.lineWidth ?? 1;
        const lineStyle = d.lineStyle ?? "solid";
        const y = (coordinates[0]?.y ?? 0) as number;
        return [
          {
            type: "line",
            ignoreEvent: true,
            attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] },
            styles: { style: lineStyle, size: lineWidth, color },
          },
        ];
      },
      // Draw colored label box on right Y-axis (MT5 style — matches reference)
      createYAxisFigures({ overlay, coordinates }: any) {
        const d = (overlay.extendData ?? {}) as { label?: string; color?: string };
        const color = d.color ?? "#2962ff";
        const label = d.label ?? "";
        const y = (coordinates[0]?.y ?? 0) as number;
        if (!label) return [];
        const fSize = 10;
        const boxH  = fSize + 6;
        const approxW = label.length * fSize * 0.62 + 10;
        return [
          {
            type: "rect",
            ignoreEvent: true,
            attrs: { x: 0, y: y - boxH / 2, width: approxW, height: boxH },
            styles: { style: "fill", color, borderColor: color, borderSize: 0, borderRadius: 2 },
          },
          {
            type: "text",
            ignoreEvent: true,
            attrs: { x: 4, y, text: label, align: "left", baseline: "middle" },
            styles: { color: "#fff", size: fSize, family: "monospace", weight: "bold" },
          },
        ];
      },
    });
  } catch {}
}

// ─── Period / TF mappings ────────────────────────────────────────────────────
const TF_TO_PERIOD: Record<string, { multiplier: number; timespan: string; text: string }> = {
  "1M":  { multiplier: 1,  timespan: "minute", text: "1m"  },
  "5M":  { multiplier: 5,  timespan: "minute", text: "5m"  },
  "15M": { multiplier: 15, timespan: "minute", text: "15m" },
  "30M": { multiplier: 30, timespan: "minute", text: "30m" },
  "1H":  { multiplier: 1,  timespan: "hour",   text: "1H"  },
  "4H":  { multiplier: 4,  timespan: "hour",   text: "4H"  },
  "1D":  { multiplier: 1,  timespan: "day",    text: "1D"  },
  "1W":  { multiplier: 1,  timespan: "week",   text: "1W"  },
};

function periodToTf(period: { multiplier: number; timespan: string }): string {
  const { multiplier, timespan } = period;
  if (timespan === "minute") return `${multiplier}M`;
  if (timespan === "hour")   return multiplier === 4 ? "4H" : "1H";
  if (timespan === "day")    return "1D";
  if (timespan === "week")   return "1W";
  return "1M";
}

function periodSec(period: { multiplier: number; timespan: string }): number {
  const { multiplier, timespan } = period;
  if (timespan === "minute") return multiplier * 60;
  if (timespan === "hour")   return multiplier * 3600;
  if (timespan === "day")    return 86400;
  if (timespan === "week")   return 604800;
  return 60;
}

// Candles to request per timeframe to cover ~1 year of history
function historyLimit(tfStr: string): number {
  if (tfStr === "1D" || tfStr === "1W") return 500;
  if (tfStr === "4H") return 2200;
  if (tfStr === "1H") return 1500;
  return 800;
}

// ─── KlineCharts Pro chart (all non-TV domains) ──────────────────────────────
function KlineChartInternal({ symbol, tf, theme, digits = 2, symbols, bare, showDrawingTools, positions, spreadPips }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<KLineChartPro | null>(null);
  const kChartRef       = useRef<any>(null);           // raw klinecharts instance (has createOverlay)
  const overlayIdsRef   = useRef<string[]>([]);        // cubeXLine overlay ids
  const drawOverlaysRef = useRef<() => void>(() => {}); // called after klinecharts onMount
  const socketRef      = useRef<Socket | null>(null);
  const lastBarRef     = useRef<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number } | null>(null);
  const callbackRef    = useRef<((data: any) => void) | null>(null);
  const symbolsRef     = useRef(symbols); symbolsRef.current = symbols;
  const positionsRef   = useRef(positions); positionsRef.current = positions;
  const spreadRef      = useRef(spreadPips ?? 0); spreadRef.current = spreadPips ?? 0;
  const digitsRef      = useRef(digits); digitsRef.current = digits;

  // ── Chart init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    ensureOverlay();

    const allSymbols = () => symbolsRef.current || [];

    const datafeed = {
      searchSymbols: async (search?: string) => {
        const q = (search || "").toLowerCase();
        return allSymbols()
          .filter((s) => !q || s.symbol.toLowerCase().includes(q) || (s.display || "").toLowerCase().includes(q))
          .slice(0, 30)
          .map((s) => ({
            ticker: s.symbol, name: s.display || s.symbol, shortName: s.symbol,
            type: s.category || "forex",
            pricePrecision: s.digits ?? digits, volumePrecision: 2,
          }));
      },

      getHistoryKLineData: async (sym: any, period: any, from: number, to: number) => {
        const tfStr = periodToTf(period);
        const limit = historyLimit(tfStr);
        try {
          const d = await fetch(
            `/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${tfStr}&limit=${limit}&before=${Math.floor(to / 1000)}`,
            { cache: "no-store" }
          ).then((r) => r.json());
          if (!d.ok || !Array.isArray(d.candles) || !d.candles.length) return [];
          const bars = d.candles.map((c: any) => ({
            timestamp: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
          }));
          if (bars.length) lastBarRef.current = bars[bars.length - 1];
          return bars;
        } catch { return []; }
      },

      subscribe: (sym: any, period: any, callback: (data: any) => void) => {
        callbackRef.current = callback;
        if (socketRef.current) socketRef.current.disconnect();
        const sock = io({ path: "/socket.io" });
        socketRef.current = sock;
        const sec = periodSec(period);

        sock.on("tick", ({ symbol: tickSym, price }: any) => {
          if (tickSym !== sym.ticker || price == null) return;
          const cb = callbackRef.current; if (!cb) return;
          const barTsMs = Math.floor(Date.now() / 1000 / sec) * sec * 1000;

          if (lastBarRef.current && lastBarRef.current.timestamp === barTsMs) {
            const updated = {
              ...lastBarRef.current,
              high:  Math.max(lastBarRef.current.high, price),
              low:   Math.min(lastBarRef.current.low,  price),
              close: price,
            };
            lastBarRef.current = updated;
            cb(updated);
          } else {
            const open = lastBarRef.current?.close ?? price;
            const newBar = {
              timestamp: barTsMs, open,
              high: Math.max(open, price), low: Math.min(open, price),
              close: price, volume: 0,
            };
            lastBarRef.current = newBar;
            cb(newBar);
          }
        });
      },

      unsubscribe: () => {
        callbackRef.current = null;
        if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      },
    };

    const period  = TF_TO_PERIOD[tf] || TF_TO_PERIOD["1M"];
    const symInfo = { ticker: symbol, name: symbol, pricePrecision: digits, volumePrecision: 2 };

    const chart = new KLineChartPro({
      container: containerRef.current,
      symbol: symInfo,
      period,
      periods: Object.values(TF_TO_PERIOD),
      theme: theme === "dark" ? "dark" : "light",
      locale: "en",
      mainIndicators: [],
      subIndicators: [],
      datafeed,
      drawingBarVisible: showDrawingTools ?? !bare,
      styles: {
        candle: {
          tooltip: {
            // Only show OHLC values when the user hovers/crosses the chart, not always
            showRule: "follow_cross",
            showType: "standard",
          },
        },
        yAxis: { position: "right" },
      } as any,
    });
    chartRef.current = chart;

    // KlineChartPro renders via SolidJS which calls klinecharts init() inside onMount
    // (asynchronous). After ~300ms that sets the k-line-chart-id attribute on the inner
    // element. klineInit(el) then returns the existing instance from its instances Map.
    // We call drawOverlaysRef so positions are drawn without waiting for a price tick.
    const resolveTimer = setTimeout(() => {
      if (!kChartRef.current && containerRef.current) {
        const el = containerRef.current.querySelector("[k-line-chart-id]") as HTMLElement | null;
        if (el) kChartRef.current = klineInit(el);
      }
      drawOverlaysRef.current();
    }, 400);

    return () => {
      clearTimeout(resolveTimer);
      callbackRef.current = null;
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      chartRef.current = null;
      kChartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync props ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !symbol) return;
    try { chart.setSymbol({ ticker: symbol, name: symbol, pricePrecision: digits, volumePrecision: 2 }); } catch {}
  }, [symbol, digits]);

  useEffect(() => {
    const chart = chartRef.current; if (!chart || !tf) return;
    const period = TF_TO_PERIOD[tf];
    if (period) try { chart.setPeriod(period); } catch {}
  }, [tf]);

  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    try { chart.setTheme(theme === "dark" ? "dark" : "light"); } catch {}
  }, [theme]);

  // ── Position / SL / TP / spread overlays (MT5 style) ────────────────────────
  useEffect(() => {
    const doDrawOverlays = () => {
      // klinecharts sets k-line-chart-id on the inner element inside its own onMount.
      // klineInit(el) returns the cached instance from the instances Map — giving us
      // the real chart API with createOverlay / removeOverlay (not on KLineChartPro).
      if (!kChartRef.current && containerRef.current) {
        const el = containerRef.current.querySelector("[k-line-chart-id]") as HTMLElement | null;
        if (el) kChartRef.current = klineInit(el);
      }
      const kChart = kChartRef.current; if (!kChart) return;

      // Remove old overlays
      for (const id of overlayIdsRef.current) {
        try { kChart.removeOverlay({ id }); } catch {}
      }
      overlayIdsRef.current = [];

      const dg  = digitsRef.current;
      const fmt = (v: number) => v.toFixed(dg);

      const addLine = (
        price: number, color: string,
        lineWidth: number, lineStyle: string,
        label: string,
      ) => {
        try {
          const id = kChart.createOverlay({
            name: "cubeXLine",
            lock: true,
            visible: true,
            points: [{ value: price }],
            extendData: { label, color, lineWidth, lineStyle },
            styles: { line: { color, size: lineWidth, style: lineStyle } },
          });
          if (id) overlayIdsRef.current.push(Array.isArray(id) ? id[0] : id);
        } catch {}
      };

      for (const p of positionsRef.current || []) {
        const isBuy   = p.type === "BUY";
        const isPend  = !!p.kind;
        const color   = isBuy ? "#2962ff" : "#f23645";
        const tkt     = p.ticket ? ` #${p.ticket}` : "";
        const pnlStr  = p.pnl !== undefined
          ? ` ${p.pnl >= 0 ? "+" : ""}${Number(p.pnl).toFixed(2)}`
          : "";

        if (isPend) {
          addLine(p.openPrice, color, 1, "dashed", `${p.kind} ${p.type}${tkt}  ${fmt(p.openPrice)}`);
        } else {
          addLine(p.openPrice, color, 2, "solid", `${p.type}${tkt}${pnlStr}  ${fmt(p.openPrice)}`);
        }
        if (p.sl && p.sl > 0) addLine(p.sl,  "#f43f5e", 1, "dashed", `SL${tkt}  ${fmt(p.sl)}`);
        if (p.tp && p.tp > 0) addLine(p.tp,  "#10b981", 1, "dashed", `TP${tkt}  ${fmt(p.tp)}`);
      }

      // Spread ask line — round to avoid float garbage (e.g. 7.000000000000360 → 7)
      if (spreadRef.current > 0 && lastBarRef.current) {
        const pip      = Math.pow(10, -dg);
        const spPips   = Math.round(spreadRef.current * 100) / 100;
        const askPrice = lastBarRef.current.close + spPips * pip;
        addLine(askPrice, "#6b7280", 1, "dotted", `Ask +${spPips}p  ${fmt(askPrice)}`);
      }
    };

    drawOverlaysRef.current = doDrawOverlays;
    doDrawOverlays();
  }, [positions, symbol, digits, spreadPips]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className={!showDrawingTools && bare ? "kline-bare" : ""}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    />
  );
}

// ─── Public export — routes to correct chart based on domain ─────────────────
export default function KLineProChart(props: Props) {
  const [hostname, setHostname] = useState<string | null>(null);

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  if (hostname === null) {
    return <div style={{ position: "absolute", inset: 0 }} />;
  }

  if (hostname === TV_DOMAIN) {
    return <TVChart {...props} />;
  }

  return <KlineChartInternal {...props} />;
}
