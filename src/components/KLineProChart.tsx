"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { registerOverlay, init as klineInit, ActionType } from "klinecharts";
import TVChart, { type ChartPosition } from "./TVChart";
import LWChart from "./LWChart";
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
  onCandleUpdate?: (bar: { open: number; high: number; low: number; close: number }) => void;
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
      totalStep: 1,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      // Horizontal price line + body label box at right edge of chart (MT5/TV reference style)
      createPointFigures({ overlay, coordinates, bounding }: any) {
        const d = (overlay.extendData ?? {}) as {
          color?: string; lineWidth?: number; lineStyle?: string; label?: string;
        };
        const color     = d.color     ?? "#2962ff";
        const lineWidth = d.lineWidth ?? 1;
        const lineStyle = d.lineStyle ?? "solid";
        const label     = d.label     ?? "";
        const y = (coordinates[0]?.y ?? 0) as number;
        const fSize = 11;
        const boxH  = fSize + 8;
        const figures: any[] = [
          {
            type: "line",
            ignoreEvent: true,
            attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] },
            styles: { style: lineStyle, size: lineWidth, color },
          },
        ];
        if (label) {
          const boxW = Math.round(label.length * fSize * 0.58) + 14;
          const boxX = bounding.width - boxW - 2;
          figures.push(
            {
              type: "rect",
              ignoreEvent: true,
              attrs: { x: boxX, y: y - boxH / 2, width: boxW, height: boxH },
              styles: { style: "fill", color, borderColor: color, borderSize: 0, borderRadius: 2 },
            },
            {
              type: "text",
              ignoreEvent: true,
              attrs: { x: boxX + 6, y, text: label, align: "left", baseline: "middle" },
              styles: { color: "#fff", size: fSize, family: "monospace", weight: "600" },
            }
          );
        }
        return figures;
      },
      // Separate price box directly on the Y-axis scale (like TV position line price tag)
      createYAxisFigures({ overlay, coordinates }: any) {
        const d = (overlay.extendData ?? {}) as { priceLabel?: string; color?: string };
        const color      = d.color      ?? "#2962ff";
        const priceLabel = d.priceLabel ?? "";
        const y = (coordinates[0]?.y ?? 0) as number;
        if (!priceLabel) return [];
        const fSize = 11;
        const boxH  = fSize + 8;
        const boxW  = Math.round(priceLabel.length * fSize * 0.58) + 14;
        return [
          {
            type: "rect",
            ignoreEvent: true,
            attrs: { x: 0, y: y - boxH / 2, width: boxW, height: boxH },
            styles: { style: "fill", color, borderColor: color, borderSize: 0, borderRadius: 2 },
          },
          {
            type: "text",
            ignoreEvent: true,
            attrs: { x: 6, y, text: priceLabel, align: "left", baseline: "middle" },
            styles: { color: "#fff", size: fSize, family: "monospace", weight: "600" },
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

// ─── Drawing persistence helpers (module-level, no component state needed) ───
const DRAW_KEY = (sym: string) => `cx-draw:${sym}`;

function saveUserDrawings(kChart: any, sym: string) {
  try {
    const overlays: any[] = kChart.getOverlays?.() ?? [];
    const user = overlays.filter(
      (o) =>
        o.name !== "cubeXLine" &&
        Array.isArray(o.points) &&
        o.points.length > 0 &&
        o.points.every((p: any) => p != null && p.value != null),
    );
    if (user.length > 0) {
      localStorage.setItem(DRAW_KEY(sym), JSON.stringify(user.map((o) => ({ name: o.name, points: o.points }))));
    } else {
      localStorage.removeItem(DRAW_KEY(sym));
    }
  } catch {}
}

function clearUserDrawings(kChart: any) {
  try {
    const overlays: any[] = kChart.getOverlays?.() ?? [];
    for (const o of overlays) {
      if (o.name !== "cubeXLine") {
        try { kChart.removeOverlay?.({ id: o.id }); } catch {}
      }
    }
  } catch {}
}

function loadUserDrawings(kChart: any, sym: string) {
  try {
    const raw = localStorage.getItem(DRAW_KEY(sym));
    if (!raw) return;
    const items: Array<{ name: string; points: any[] }> = JSON.parse(raw);
    for (const item of items) {
      kChart.createOverlay?.({ name: item.name, points: item.points, lock: false, zLevel: 5 });
    }
  } catch {}
}

// ─── Drawing toolbar tool definitions ─────────────────────────────────────────
const DRAW_TOOLS = [
  {
    id: "none",
    label: "Select (Esc)",
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .557.103z" />
      </svg>
    ),
  },
  {
    id: "horizontalStraightLine",
    label: "Horizontal Line",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeLinecap="round">
        <line x1="1" y1="8" x2="15" y2="8" strokeWidth="1.8" />
        <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "straightLine",
    label: "Trend Line",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeLinecap="round">
        <line x1="2" y1="13" x2="14" y2="3" strokeWidth="1.8" />
        <circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="14" cy="3" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "fibRetrace",
    label: "Fibonacci Retracement",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeLinecap="round">
        <line x1="1.5" y1="3"    x2="14.5" y2="3"    strokeWidth="1.4" />
        <line x1="1.5" y1="6.5"  x2="14.5" y2="6.5"  strokeWidth="1.1" strokeOpacity="0.65" />
        <line x1="1.5" y1="9.5"  x2="14.5" y2="9.5"  strokeWidth="1.1" strokeOpacity="0.65" />
        <line x1="1.5" y1="13"   x2="14.5" y2="13"   strokeWidth="1.4" />
        <line x1="2.5" y1="3"    x2="2.5"  y2="13"   strokeWidth="1" strokeOpacity="0.5" />
        <line x1="13.5" y1="3"   x2="13.5" y2="13"   strokeWidth="1" strokeOpacity="0.5" />
      </svg>
    ),
  },
  {
    id: "parallelStraightLine",
    label: "Parallel Channel",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeLinecap="round">
        <line x1="2" y1="10.5" x2="14" y2="5.5" strokeWidth="1.8" />
        <line x1="2" y1="13"   x2="14" y2="8"   strokeWidth="1.8" />
      </svg>
    ),
  },
];

// ─── KlineCharts Pro chart (all non-TV domains) ──────────────────────────────
function KlineChartInternal({ symbol, tf, theme, digits = 2, symbols, bare, showDrawingTools, positions, spreadPips, onCandleUpdate }: Props) {
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
  const symbolRef      = useRef(symbol); symbolRef.current = symbol;
  const onCandleRef    = useRef(onCandleUpdate); onCandleRef.current = onCandleUpdate;

  // Drawing toolbar state
  const [activeTool, setActiveTool] = useState("none");
  const [chartReady, setChartReady] = useState(false);

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
          if (bars.length) {
            lastBarRef.current = bars[bars.length - 1];
            const lb = bars[bars.length - 1];
            onCandleRef.current?.({ open: lb.open, high: lb.high, low: lb.low, close: lb.close });
          }
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
          // Spike filter: reject ticks >2% from last close (bad feed outliers)
          if (lastBarRef.current && lastBarRef.current.close > 0) {
            if (Math.abs(price - lastBarRef.current.close) / lastBarRef.current.close > 0.02) return;
          }
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
            onCandleRef.current?.({ open: updated.open, high: updated.high, low: updated.low, close: updated.close });
          } else {
            const open = lastBarRef.current?.close ?? price;
            const newBar = {
              timestamp: barTsMs, open,
              high: Math.max(open, price), low: Math.min(open, price),
              close: price, volume: 0,
            };
            lastBarRef.current = newBar;
            cb(newBar);
            onCandleRef.current?.({ open: newBar.open, high: newBar.high, low: newBar.low, close: newBar.close });
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
      // Custom floating toolbar replaces the built-in drawing bar
      drawingBarVisible: false,
      ...({ periodBarVisible: false, timezoneBarVisible: false, indicatorBarVisible: false } as any),
      styles: {
        candle: {
          tooltip: {
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
    const resolveTimer = setTimeout(() => {
      if (!kChartRef.current && containerRef.current) {
        const el = containerRef.current.querySelector("[k-line-chart-id]") as HTMLElement | null;
        if (el) {
          kChartRef.current = klineInit(el);
          try {
            kChartRef.current.subscribeAction(ActionType.OnCrosshairChange, (data: any) => {
              if (data?.kLineData) {
                const d = data.kLineData;
                onCandleRef.current?.({ open: d.open, high: d.high, low: d.low, close: d.close });
              } else if (lastBarRef.current) {
                const lb = lastBarRef.current;
                onCandleRef.current?.({ open: lb.open, high: lb.high, low: lb.low, close: lb.close });
              }
            });
          } catch {}
        }
      }
      drawOverlaysRef.current();
      setChartReady(true);
    }, 400);

    return () => {
      clearTimeout(resolveTimer);
      callbackRef.current = null;
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      chartRef.current = null;
      kChartRef.current = null;
      setChartReady(false);
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
      if (!kChartRef.current && containerRef.current) {
        const el = containerRef.current.querySelector("[k-line-chart-id]") as HTMLElement | null;
        if (el) kChartRef.current = klineInit(el);
      }
      const kChart = kChartRef.current; if (!kChart) return;

      // Remove old position overlays
      for (const id of overlayIdsRef.current) {
        try { kChart.removeOverlay({ id }); } catch {}
      }
      overlayIdsRef.current = [];

      const dg  = digitsRef.current;
      const fmt = (v: number) => v.toFixed(dg);

      const addLine = (
        price: number, color: string,
        lineWidth: number, lineStyle: string,
        label: string, priceLabel: string,
      ) => {
        try {
          const id = kChart.createOverlay({
            name: "cubeXLine",
            lock: true,
            visible: true,
            points: [{ value: price }],
            extendData: { label, priceLabel, color, lineWidth, lineStyle },
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
          addLine(p.openPrice, color, 1, "dashed", `${p.kind} ${p.type}${tkt}  ${fmt(p.openPrice)}`, fmt(p.openPrice));
        } else {
          addLine(p.openPrice, color, 2, "solid", `${p.type}${tkt}${pnlStr}  ${fmt(p.openPrice)}`, fmt(p.openPrice));
        }
        if (p.sl && p.sl > 0) addLine(p.sl,  "#f43f5e", 1, "dashed", `SL${tkt}  ${fmt(p.sl)}`,  fmt(p.sl));
        if (p.tp && p.tp > 0) addLine(p.tp,  "#10b981", 1, "dashed", `TP${tkt}  ${fmt(p.tp)}`,  fmt(p.tp));
      }

      // Spread ask line
      if (spreadRef.current > 0 && lastBarRef.current) {
        const pip      = Math.pow(10, -dg);
        const spPips   = Math.round(spreadRef.current * 100) / 100;
        const askPrice = lastBarRef.current.close + spPips * pip;
        addLine(askPrice, "#26a69a", 1, "dotted", `Ask +${spPips}p  ${fmt(askPrice)}`, fmt(askPrice));
      }
    };

    drawOverlaysRef.current = doDrawOverlays;
    doDrawOverlays();
  }, [positions, symbol, digits, spreadPips]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing save / load on symbol change ─────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    const kChart = kChartRef.current; if (!kChart) return;
    // Clear any stale drawings left from previous symbol and load saved ones for this symbol
    clearUserDrawings(kChart);
    loadUserDrawings(kChart, symbol);
    return () => {
      // Save before symbol changes or component unmounts
      if (kChartRef.current) saveUserDrawings(kChartRef.current, symbol);
    };
  }, [chartReady, symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing tool activation ───────────────────────────────────────────────────
  const handleToolClick = useCallback((toolId: string) => {
    const kChart = kChartRef.current; if (!kChart) return;
    const sym = symbolRef.current;

    if (toolId === "clear") {
      clearUserDrawings(kChart);
      try { localStorage.removeItem(DRAW_KEY(sym)); } catch {}
      setActiveTool("none");
      return;
    }

    setActiveTool(toolId);
    if (toolId === "none") return;

    // Starts klinecharts interactive drawing mode — user clicks chart to place points
    kChartRef.current?.createOverlay?.({ name: toolId, lock: false, zLevel: 5 });

    // Save after a generous delay (covers single-click H-lines and two-click trend/fib)
    setTimeout(() => {
      if (kChartRef.current) saveUserDrawings(kChartRef.current, sym);
    }, 600);
  }, []);

  // Escape key cancels active drawing tool
  useEffect(() => {
    if (activeTool === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveTool("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool]);

  // Show toolbar on all non-bare chart instances (bare = mobile compact view)
  const showToolbar = !bare;

  // ── Toolbar styling (derived from theme prop) ────────────────────────────────
  const tb = {
    bg:       theme === "dark" ? "rgba(14,16,24,0.90)"       : "rgba(255,255,255,0.93)",
    border:   theme === "dark" ? "rgba(255,255,255,0.09)"    : "rgba(0,0,0,0.11)",
    btnColor: theme === "dark" ? "rgba(185,195,215,0.85)"    : "rgba(50,60,80,0.75)",
    btnActive:   "#2962ff",
    btnActiveBg: "rgba(41,98,255,0.16)",
    btnActiveBorder: "rgba(41,98,255,0.45)",
    clearColor: theme === "dark" ? "rgba(248,100,100,0.80)"  : "rgba(200,30,30,0.75)",
    sep:      theme === "dark" ? "rgba(255,255,255,0.09)"    : "rgba(0,0,0,0.09)",
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* KlineCharts Pro mounts here */}
      <div
        ref={containerRef}
        className={!showDrawingTools && bare ? "kline-bare" : ""}
        style={{ position: "absolute", inset: 0 }}
      />

      {/* Custom floating drawing toolbar */}
      {showToolbar && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "4px",
            background: tb.bg,
            border: `1px solid ${tb.border}`,
            borderRadius: 7,
            backdropFilter: "blur(10px)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
          }}
        >
          {DRAW_TOOLS.map((tool) => {
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                title={tool.label}
                onClick={() => handleToolClick(tool.id)}
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: active ? tb.btnActiveBg : "transparent",
                  color: active ? tb.btnActive : tb.btnColor,
                  border: `1px solid ${active ? tb.btnActiveBorder : "transparent"}`,
                  borderRadius: 5,
                  cursor: "pointer",
                  outline: "none",
                  padding: 0,
                  flexShrink: 0,
                  transition: "background 0.1s, color 0.1s, border-color 0.1s",
                }}
              >
                {tool.icon}
              </button>
            );
          })}

          {/* Separator before clear button */}
          <div style={{ height: 1, margin: "1px 0", background: tb.sep }} />

          {/* Clear all drawings */}
          <button
            title="Clear All Drawings"
            onClick={() => handleToolClick("clear")}
            style={{
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              color: tb.clearColor,
              border: "1px solid transparent",
              borderRadius: 5,
              cursor: "pointer",
              outline: "none",
              padding: 0,
              flexShrink: 0,
              transition: "background 0.1s",
            }}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
              <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
            </svg>
          </button>
        </div>
      )}
    </div>
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

  // Non-licensed domains: use open-source Lightweight Charts
  return (
    <LWChart
      symbol={props.symbol}
      tf={props.tf}
      theme={props.theme}
      digits={props.digits}
      positions={props.positions}
      spreadPips={props.spreadPips}
      onCandleUpdate={props.onCandleUpdate}
      showTools={!props.bare}
    />
  );
}
