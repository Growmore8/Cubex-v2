"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";

// ─── Timeframe helpers ────────────────────────────────────────────────────────
const TF_SECS: Record<string, number> = { "1M": 60, "5M": 300, "15M": 900, "1H": 3600, "4H": 14400, "1D": 86400 };
const TF_API: Record<string, string> = { "1M": "1M", "5M": "5M", "15M": "15M", "1H": "1H", "4H": "4H", "1D": "1D" };
const TFS = ["1M", "5M", "15M", "1H", "4H", "1D"];

// ─── Indicator math ───────────────────────────────────────────────────────────
function calcEMA(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) { ema = closes[i] * k + ema * (1 - k); out[i] = ema; }
  return out;
}
function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gains += d; else losses -= d; }
  let ag = gains / period, al = losses / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function calcMACD(closes: number[]): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  const macdLine: (number | null)[] = closes.map((_, i) => (ema12[i] != null && ema26[i] != null) ? (ema12[i]! - ema26[i]!) : null);
  const macdVals = macdLine.filter((v) => v != null) as number[];
  const signalRaw = calcEMA(macdVals, 9);
  const nullCount = macdLine.findIndex((v) => v != null) + (macdLine.filter((v) => v != null).length - macdVals.length);
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  let si = 0;
  for (let i = 0; i < closes.length; i++) { if (macdLine[i] != null) { signal[i] = signalRaw[si++] ?? null; } }
  const hist: (number | null)[] = closes.map((_, i) => (macdLine[i] != null && signal[i] != null) ? (macdLine[i]! - signal[i]!) : null);
  return { macd: macdLine, signal, hist };
}
function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => i < period - 1 ? null : closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
}
function calcBB(closes: number[], period = 20, mult = 2): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = calcSMA(closes, period);
  const upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = mid[i]!;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period);
    upper.push(avg + mult * std); lower.push(avg - mult * std);
  }
  return { upper, mid, lower };
}

// ─── Candle conversion ────────────────────────────────────────────────────────
function toCandle(b: { time: number; open: number; high: number; low: number; close: number; volume?: number }) {
  return { id: String(b.time), timestamp: b.time * 1000, open: b.open, hi: b.high, lo: b.low, close: b.close, volume: b.volume ?? 0 };
}
function toTickCandle(ts: number, open: number, high: number, low: number, close: number) {
  return { id: String(ts / 1000), timestamp: ts, open, hi: high, lo: low, close, volume: 0 };
}

type Sym = { symbol: string; category?: string; digits?: number; display?: string };
type Ind = { ema20: boolean; ema50: boolean; bb: boolean; vol: boolean; rsi: boolean; macd: boolean };

// ─── Theme palettes ───────────────────────────────────────────────────────────
const DARK_COLORS = {
  backgroundColor: "#131722",
  barTheme: { bullColor: "#26a69a", bearColor: "#ef5350", bullInnerColor: "#26a69a", bearInnerColor: "#ef5350" },
  lineTheme: { upColor: "#26a69a", downColor: "#ef5350" },
  areaTheme: { lineColor: "#2962ff", startColor: "rgba(41,98,255,0.18)", endColor: "rgba(41,98,255,0)" },
  gridTheme: { horizontalLineColor: "#1e2235", verticalLineColor: "#1e2235" },
  yAxis: { labelBoxColor: "#1e2235", labelTextColor: "#848ea8", labelInvertedTextColor: "#c8cbda", typeface: "system-ui" },
  xAxis: { backgroundColor: "#131722", labelTextColor: "#848ea8", typeface: "system-ui" },
  crossTool: { lineColor: "#848ea8", labelBoxColor: "#2a2e39", labelTextColor: "#c8cbda" },
  waterMark: { firstRowColor: "#1e2235", secondRowColor: "#1e2235", thirdRowColor: "#1e2235" },
  volumes: { barCapColors: [{ upCapColor: "#26a69a88", downCapColor: "#ef535088" }] },
};
const LIGHT_COLORS = {
  backgroundColor: "#ffffff",
  barTheme: { bullColor: "#26a69a", bearColor: "#ef5350", bullInnerColor: "#26a69a", bearInnerColor: "#ef5350" },
  lineTheme: { upColor: "#26a69a", downColor: "#ef5350" },
  areaTheme: { lineColor: "#2962ff", startColor: "rgba(41,98,255,0.12)", endColor: "rgba(41,98,255,0)" },
  gridTheme: { horizontalLineColor: "#f0f3fa", verticalLineColor: "#f0f3fa" },
  yAxis: { labelBoxColor: "#f0f3fa", labelTextColor: "#787b86", labelInvertedTextColor: "#131722", typeface: "system-ui" },
  xAxis: { backgroundColor: "#ffffff", labelTextColor: "#787b86", typeface: "system-ui" },
  crossTool: { lineColor: "#9598a1", labelBoxColor: "#f0f3fa", labelTextColor: "#131722" },
  waterMark: { firstRowColor: "#f0f3fa", secondRowColor: "#f0f3fa", thirdRowColor: "#f0f3fa" },
  volumes: { barCapColors: [{ upCapColor: "#26a69a88", downCapColor: "#ef535088" }] },
};

export default function DXChart({ symbol, tf, theme, digits = 2, symbols, positions, onSymbolChange, bare }: {
  symbol: string; tf: string; theme: "dark" | "light"; digits?: number;
  symbols?: Sym[]; positions?: ChartPosition[]; onSymbolChange?: (s: string) => void; bare?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);
  const paneManagerRef = useRef<any>(null);
  const rsiPaneRef = useRef<any>(null);
  const macdPaneRef = useRef<any>(null);
  const rsiSeriesRef = useRef<any>(null);
  const macdSeriesRef = useRef<any>(null);
  const macdSigSeriesRef = useRef<any>(null);
  const macdHistSeriesRef = useRef<any>(null);
  const ema20SeriesRef = useRef<any>(null);
  const ema50SeriesRef = useRef<any>(null);
  const bbUpperRef = useRef<any>(null);
  const bbLowerRef = useRef<any>(null);
  const bbMidRef = useRef<any>(null);
  const sockRef = useRef<Socket | null>(null);
  const candlesRawRef = useRef<any[]>([]);
  const lastBarRef = useRef<any>(null);
  const symbolRef = useRef(symbol);
  const tfRef = useRef(tf);
  const positionsRef = useRef(positions);
  const overlayRafRef = useRef<number>(0);
  const onSymRef = useRef(onSymbolChange);
  onSymRef.current = onSymbolChange;
  symbolRef.current = symbol;
  tfRef.current = tf;
  positionsRef.current = positions;

  const [activeTf, setActiveTf] = useState(tf);
  const [chartType, setChartType] = useState<"candle" | "line" | "area">("candle");
  const [ind, setInd] = useState<Ind>({ ema20: false, ema50: false, bb: false, vol: true, rsi: false, macd: false });
  const [loading, setLoading] = useState(true);
  const [mwOpen, setMwOpen] = useState(false);

  const isDark = theme === "dark";
  const BG = isDark ? "#131722" : "#ffffff";
  const BORDER = isDark ? "#2a2e39" : "#e0e3eb";
  const TEXT = isDark ? "#848ea8" : "#787b86";
  const PANEL = isDark ? "#1e2235" : "#f8f9fd";
  const ACCENT = "#2962ff";

  // ── Build chart once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    import("@devexperts/dxcharts-lite/dist/chart/chart").then(({ Chart }) => {
      if (disposed || !containerRef.current) return;

      const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
      const chart = new Chart(containerRef.current, {
        colors: colors as any,
        components: {
          chart: { type: chartType },
          yAxis: { type: "regular", alignLabels: false },
          offsets: { top: 8, bottom: 4, right: 60 },
          volumes: { showSeparately: true },
          crossTool: { type: "cross-and-labels" },
          waterMark: { visible: false },
          navigationMap: { visible: false },
        },
      } as any);

      chartRef.current = chart;
      paneManagerRef.current = (chart as any).paneManager;

      loadData(chart);
    });

    return () => {
      disposed = true;
      try { sockRef.current?.disconnect(); } catch {}
      try { chartRef.current?.destroy(); } catch {}
      chartRef.current = null;
      cancelAnimationFrame(overlayRafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load history + wire real-time ───────────────────────────────────────────
  async function loadData(chart: any) {
    setLoading(true);
    try { sockRef.current?.disconnect(); } catch {}

    const apiTf = TF_API[tfRef.current] || "15M";
    const r = await fetch(`/api/candles?symbol=${encodeURIComponent(symbolRef.current)}&tf=${apiTf}`).then((x) => x.json()).catch(() => null);
    const raw = r?.candles ?? [];
    candlesRawRef.current = raw;
    lastBarRef.current = raw.length ? raw[raw.length - 1] : null;

    const candles = raw.map(toCandle);
    try { chart.setData({ candles }); } catch {}
    updateIndicators(raw, chart);
    setLoading(false);
    scheduleOverlay();

    // Real-time Socket.IO
    const sec = TF_SECS[tfRef.current] || 900;
    const sock = io({ path: "/socket.io" });
    sockRef.current = sock;
    let last = lastBarRef.current ? { ...lastBarRef.current } : null;

    sock.on("tick", (msg: any) => {
      if (msg.symbol !== symbolRef.current) return;
      const price = msg.price; if (price == null) return;
      const real = msg.real ?? price;
      const ts = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
      const tsS = ts / 1000;

      if (last && last.time === tsS) {
        last.high = Math.max(last.high, price, real);
        last.low = Math.min(last.low, price, real);
        last.close = price;
        try { chart.data.updateLastCandle(toTickCandle(ts, last.open, last.high, last.low, last.close)); } catch {}
      } else {
        const open = last ? last.close : price;
        last = { time: tsS, open, high: Math.max(open, price, real), low: Math.min(open, price, real), close: price, volume: 0 };
        candlesRawRef.current = [...candlesRawRef.current, last];
        try { chart.data.addLastCandle(toTickCandle(ts, last.open, last.high, last.low, last.close)); } catch {}
        updateIndicators(candlesRawRef.current, chart);
      }
      scheduleOverlay();
    });
  }

  // ── Indicator data series ───────────────────────────────────────────────────
  function updateIndicators(raw: any[], chart: any) {
    const closes = raw.map((c) => c.close);
    const timestamps = raw.map((c) => c.time * 1000);
    const pm = (chart as any).paneManager;
    if (!pm) return;
    const mainPane = Object.values(pm.panes as Record<string, any>)[0];
    if (!mainPane) return;

    // EMA20
    if (ind.ema20) {
      const vals = calcEMA(closes, 20);
      const pts = vals.map((v, i) => ({ id: timestamps[i], timestamp: timestamps[i], value: v ?? undefined })).filter((p) => p.value != null);
      if (!ema20SeriesRef.current) {
        const s = mainPane.createDataSeries();
        s.setType("LINEAR");
        s.visualPoints = [];
        ema20SeriesRef.current = s;
        try { mainPane.addDataSeries(s); } catch {}
      }
      try { ema20SeriesRef.current?.setPoints?.(pts); } catch {}
    }
    // EMA50
    if (ind.ema50) {
      const vals = calcEMA(closes, 50);
      const pts = vals.map((v, i) => ({ id: timestamps[i], timestamp: timestamps[i], value: v ?? undefined })).filter((p) => p.value != null);
      if (!ema50SeriesRef.current) {
        const s = mainPane.createDataSeries();
        s.setType("LINEAR");
        ema50SeriesRef.current = s;
        try { mainPane.addDataSeries(s); } catch {}
      }
      try { ema50SeriesRef.current?.setPoints?.(pts); } catch {}
    }
    // Bollinger Bands
    if (ind.bb) {
      const { upper, mid, lower } = calcBB(closes, 20, 2);
      const pts = (arr: (number | null)[]) => arr.map((v, i) => ({ id: timestamps[i], timestamp: timestamps[i], value: v ?? undefined })).filter((p) => p.value != null);
      for (const [ref, vals] of [[bbUpperRef, upper], [bbMidRef, mid], [bbLowerRef, lower]] as const) {
        if (!ref.current) { const s = mainPane.createDataSeries(); s.setType("LINEAR"); ref.current = s; try { mainPane.addDataSeries(s); } catch {} }
        try { ref.current?.setPoints?.(pts(vals as any)); } catch {}
      }
    }
  }

  // ── Reload on symbol / tf change ───────────────────────────────────────────
  useEffect(() => {
    setActiveTf(tf);
    const chart = chartRef.current;
    if (!chart) return;
    // Clear indicator series refs so they get recreated
    ema20SeriesRef.current = null; ema50SeriesRef.current = null;
    bbUpperRef.current = null; bbMidRef.current = null; bbLowerRef.current = null;
    rsiSeriesRef.current = null; macdSeriesRef.current = null;
    macdSigSeriesRef.current = null; macdHistSeriesRef.current = null;
    loadData(chart);
  }, [symbol, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chart type change ───────────────────────────────────────────────────────
  useEffect(() => {
    try { chartRef.current?.setChartType(chartType); } catch {}
  }, [chartType]);

  // ── RSI pane ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const pm = (chart as any)?.paneManager;
    if (!pm) return;
    if (ind.rsi) {
      if (!rsiPaneRef.current) {
        const pane = pm.createPane();
        rsiPaneRef.current = pane;
        const s = pane.createDataSeries();
        s.setType("LINEAR");
        rsiSeriesRef.current = s;
        try { pane.addDataSeries(s); } catch {}
      }
      const closes = candlesRawRef.current.map((c) => c.close);
      const timestamps = candlesRawRef.current.map((c) => c.time * 1000);
      const rsi = calcRSI(closes, 14);
      const pts = rsi.map((v, i) => ({ id: timestamps[i], timestamp: timestamps[i], value: v ?? undefined })).filter((p) => p.value != null);
      try { rsiSeriesRef.current?.setPoints?.(pts); } catch {}
    } else {
      if (rsiPaneRef.current) {
        try { pm.removePane?.(rsiPaneRef.current); } catch {}
        rsiPaneRef.current = null; rsiSeriesRef.current = null;
      }
    }
  }, [ind.rsi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── MACD pane ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const pm = (chart as any)?.paneManager;
    if (!pm) return;
    if (ind.macd) {
      if (!macdPaneRef.current) {
        const pane = pm.createPane();
        macdPaneRef.current = pane;
        const ms = pane.createDataSeries(); ms.setType("LINEAR"); macdSeriesRef.current = ms; try { pane.addDataSeries(ms); } catch {}
        const ss = pane.createDataSeries(); ss.setType("LINEAR"); macdSigSeriesRef.current = ss; try { pane.addDataSeries(ss); } catch {}
        const hs = pane.createDataSeries(); hs.setType("HISTOGRAM"); macdHistSeriesRef.current = hs; try { pane.addDataSeries(hs); } catch {}
      }
      const closes = candlesRawRef.current.map((c) => c.close);
      const timestamps = candlesRawRef.current.map((c) => c.time * 1000);
      const { macd, signal, hist } = calcMACD(closes);
      const pts = (arr: (number | null)[]) => arr.map((v, i) => ({ id: timestamps[i], timestamp: timestamps[i], value: v ?? undefined })).filter((p) => p.value != null);
      try { macdSeriesRef.current?.setPoints?.(pts(macd)); macdSigSeriesRef.current?.setPoints?.(pts(signal)); macdHistSeriesRef.current?.setPoints?.(pts(hist)); } catch {}
    } else {
      if (macdPaneRef.current) {
        try { pm.removePane?.(macdPaneRef.current); } catch {}
        macdPaneRef.current = null; macdSeriesRef.current = null; macdSigSeriesRef.current = null; macdHistSeriesRef.current = null; macdHistSeriesRef.current = null;
      }
    }
  }, [ind.macd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Volume visibility ───────────────────────────────────────────────────────
  useEffect(() => { try { chartRef.current?.showSeparateVolumes(ind.vol); } catch {} }, [ind.vol]);

  // ── Trade position overlay (canvas) ─────────────────────────────────────────
  function scheduleOverlay() {
    cancelAnimationFrame(overlayRafRef.current);
    overlayRafRef.current = requestAnimationFrame(drawOverlay);
  }
  function drawOverlay() {
    const canvas = overlayRef.current;
    const chart = chartRef.current;
    if (!canvas || !chart) return;
    const pm = (chart as any).paneManager;
    const mainPane = pm ? Object.values(pm.panes as Record<string, any>)[0] : null;
    const ctx = canvas.getContext("2d");
    if (!ctx || !mainPane) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pos = positionsRef.current || [];
    for (const p of pos) {
      const isPending = !!p.kind;
      const isBuy = p.type === "BUY";
      const entryColor = isPending ? "#f59e0b" : isBuy ? "#2962ff" : "#ef5350";
      drawHLine(ctx, canvas, mainPane, p.openPrice, entryColor, `${isPending ? p.kind + " " : ""}${p.type} @ ${p.openPrice}`, true);
      if (p.sl) drawHLine(ctx, canvas, mainPane, p.sl, "#ef5350", `SL ${p.sl}`, false);
      if (p.tp) drawHLine(ctx, canvas, mainPane, p.tp, "#26a69a", `TP ${p.tp}`, false);
    }
  }
  function drawHLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, pane: any, price: number, color: string, label: string, bold: boolean) {
    try {
      const y = pane.toY(price);
      if (isNaN(y) || y < 0 || y > canvas.height) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = bold ? 1.5 : 1;
      ctx.setLineDash(bold ? [] : [4, 3]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width - 64, y);
      ctx.stroke();
      // Label pill
      const pad = 6;
      ctx.font = `${bold ? "600 " : ""}11px system-ui`;
      const tw = ctx.measureText(label).width;
      const px = canvas.width - 64;
      ctx.fillStyle = color;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(px, y - 10, tw + pad * 2, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, px + pad, y + 4);
      ctx.restore();
    } catch {}
  }

  // Redraw overlay whenever positions change
  useEffect(() => { scheduleOverlay(); }, [positions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuously refresh overlay on RAF (handles zoom/scroll)
  useEffect(() => {
    let alive = true;
    function loop() { if (!alive) return; drawOverlay(); overlayRafRef.current = requestAnimationFrame(loop); }
    overlayRafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(overlayRafRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Volume: show by default ─────────────────────────────────────────────────
  useEffect(() => { try { chartRef.current?.showSeparateVolumes(true); } catch {} }, []);

  const toggleInd = (key: keyof Ind) => setInd((p) => ({ ...p, [key]: !p[key] }));
  const indActive = (k: keyof Ind) => ind[k] ? { background: ACCENT + "22", color: ACCENT, borderColor: ACCENT } : { background: "transparent", color: TEXT, borderColor: BORDER };

  const btnBase = "rounded px-2.5 py-1 text-[11px] font-medium border transition-colors";

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: BG, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* ── Toolbar ── */}
      {!bare && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0, flexWrap: "wrap", background: PANEL }}>
        {/* Timeframe */}
        <div style={{ display: "flex", gap: 2 }}>
          {TFS.map((t) => (
            <button key={t} className={btnBase} style={t === activeTf ? { background: ACCENT, color: "#fff", borderColor: ACCENT } : { background: "transparent", color: TEXT, borderColor: "transparent" }}
              onClick={() => { setActiveTf(t); onSymRef.current?.(symbol); if (chartRef.current) { tfRef.current = t; loadData(chartRef.current); } }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: BORDER, margin: "0 2px" }} />
        {/* Chart type */}
        {([["candle", "fa-chart-candlestick"], ["line", "fa-chart-line"], ["area", "fa-chart-area"]] as const).map(([type, icon]) => (
          <button key={type} className={btnBase} title={type} style={chartType === type ? { background: ACCENT, color: "#fff", borderColor: ACCENT } : { background: "transparent", color: TEXT, borderColor: "transparent" }}
            onClick={() => setChartType(type)}>
            <i className={`fa-solid ${icon}`} />
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: BORDER, margin: "0 2px" }} />
        {/* Indicators */}
        {([["vol", "VOL"], ["ema20", "EMA 20"], ["ema50", "EMA 50"], ["bb", "BB"], ["rsi", "RSI"], ["macd", "MACD"]] as [keyof Ind, string][]).map(([key, label]) => (
          <button key={key} className={btnBase} style={indActive(key)} onClick={() => toggleInd(key)}>{label}</button>
        ))}
        {/* Symbol picker */}
        {symbols && symbols.length > 1 && (
          <>
            <div style={{ marginLeft: "auto" }} />
            <div style={{ position: "relative" }}>
              <button className={btnBase} style={{ background: PANEL, color: TEXT, borderColor: BORDER, minWidth: 80 }}
                onClick={() => setMwOpen((o) => !o)}>
                {symbol} <i className="fa-solid fa-chevron-down ml-1 text-[8px]" />
              </button>
              {mwOpen && (
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: isDark ? "#1e2235" : "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, zIndex: 90, width: 160, maxHeight: 220, overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                  {symbols.map((s) => (
                    <button key={s.symbol} onClick={() => { onSymRef.current?.(s.symbol); setMwOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", fontSize: 12, color: s.symbol === symbol ? ACCENT : TEXT, background: s.symbol === symbol ? ACCENT + "18" : "transparent", fontWeight: s.symbol === symbol ? 600 : 400 }}>
                      {s.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>}

      {/* ── Chart area ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, background: BG }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ color: ACCENT, fontSize: 22 }} />
          </div>
        )}
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {/* Canvas overlay for trade position lines */}
        <canvas ref={overlayRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }} />
      </div>
    </div>
  );
}
