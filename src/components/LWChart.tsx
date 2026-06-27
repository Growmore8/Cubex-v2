"use client";
import { useEffect, useRef, useState, memo, type CSSProperties } from "react";
import { createChart, ColorType, LineStyle, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } from "lightweight-charts";
import { io, Socket } from "socket.io-client";
import { RSI, SMA, EMA, BollingerBands, MACD, PSAR, Stochastic, ATR, ADX, bullishengulfingpattern, bearishengulfingpattern, morningstar, eveningstar, hammerpattern, shootingstar, doji } from "technicalindicators";

// Indicators are computed with the `technicalindicators` library; each helper
// keeps the same {time,value} output shape, aligned back to the candle times.
// (Library results omit the leading warm-up bars, so we offset by length diff.)

// RSI (Wilder) over candle closes -> line-series data.
function computeRSI(bars: any[], period = 14) {
  if (!bars || bars.length < period + 1) return [];
  const res = RSI.calculate({ period, values: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  return res.map((v, k) => ({ time: bars[off + k].time, value: Number(v.toFixed(2)) }));
}

// Simple / exponential moving average over candle closes -> line-series data.
function computeMA(bars: any[], period: number, exp: boolean) {
  if (!bars || bars.length < period) return [];
  const res = (exp ? EMA : SMA).calculate({ period, values: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  return res.map((v: number, k: number) => ({ time: bars[off + k].time, value: v }));
}

// Bollinger Bands (SMA20 ± 2σ) — mid, upper, lower band
function computeBB(bars: any[], period = 20, mult = 2) {
  if (!bars || bars.length < period) return { mid: [], upper: [], lower: [] };
  const res = BollingerBands.calculate({ period, stdDev: mult, values: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  const mid: any[] = [], upper: any[] = [], lower: any[] = [];
  res.forEach((b: any, k: number) => { const t = bars[off + k].time; mid.push({ time: t, value: b.middle }); upper.push({ time: t, value: b.upper }); lower.push({ time: t, value: b.lower }); });
  return { mid, upper, lower };
}

// Stochastic oscillator — %K and %D lines (0..100).
function computeStoch(bars: any[], period = 14, signalPeriod = 3) {
  if (!bars || bars.length < period + signalPeriod) return { k: [], d: [] };
  const res = Stochastic.calculate({ period, signalPeriod, high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  const k: any[] = [], d: any[] = [];
  res.forEach((r: any, i: number) => { const t = bars[off + i].time; if (r.k != null) k.push({ time: t, value: +r.k.toFixed(2) }); if (r.d != null) d.push({ time: t, value: +r.d.toFixed(2) }); });
  return { k, d };
}
// ATR — average true range (volatility), price-scale line.
function computeATR(bars: any[], period = 14) {
  if (!bars || bars.length < period + 1) return [];
  const res = ATR.calculate({ period, high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  return res.map((v: number, i: number) => ({ time: bars[off + i].time, value: v }));
}
// ADX — trend strength (0..100).
function computeADX(bars: any[], period = 14) {
  if (!bars || bars.length < period * 2) return [];
  const res = ADX.calculate({ period, high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: bars.map((b) => b.close) });
  const off = bars.length - res.length;
  return res.map((r: any, i: number) => ({ time: bars[off + i].time, value: r.adx != null ? +r.adx.toFixed(2) : 0 }));
}

// EMA aligned to every bar (leading warm-up bars = null).
function emaAligned(closes: number[], period: number): (number | null)[] {
  const res = EMA.calculate({ period, values: closes });
  const off = closes.length - res.length;
  const a: (number | null)[] = new Array(closes.length).fill(null);
  res.forEach((v: number, k: number) => { a[off + k] = v; });
  return a;
}
// Trade signal engine: EMA(9/21) crossover, graded by RSI + ADX → BUY/SELL/Strong.
function computeSignals(bars: any[]) {
  if (!bars || bars.length < 30) return [];
  const closes = bars.map((b) => b.close);
  const ef = emaAligned(closes, 9), es = emaAligned(closes, 21);
  const rres = RSI.calculate({ period: 14, values: closes }); const roff = closes.length - rres.length; const rsiA: number[] = new Array(closes.length).fill(50); rres.forEach((v, k) => { rsiA[roff + k] = v; });
  const ares = ADX.calculate({ period: 14, high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: closes }); const aoff = closes.length - ares.length; const adxA: number[] = new Array(closes.length).fill(0); ares.forEach((v: any, k: number) => { adxA[aoff + k] = v?.adx ?? 0; });
  const out: any[] = []; let last: boolean | null = null;
  for (let i = 0; i < bars.length; i++) {
    const a = ef[i], b = es[i]; if (a == null || b == null) continue;
    const trend = a > b;
    if (last !== null && trend !== last) {
      const strong = adxA[i] > 25 && (trend ? rsiA[i] >= 52 : rsiA[i] <= 48);
      out.push({ time: bars[i].time, position: trend ? "belowBar" : "aboveBar", color: trend ? "#26a69a" : "#ef5350", shape: trend ? "arrowUp" : "arrowDown", text: trend ? (strong ? "Strong BUY" : "BUY") : (strong ? "Strong SELL" : "SELL") });
    }
    last = trend;
  }
  return out;
}
// MA ribbon: 5 EMAs, each split into green (uptrend) / red (downtrend) line data.
const RIBBON_PERIODS = [8, 13, 21, 34, 55];
function computeRibbon(bars: any[]) {
  const closes = bars.map((b) => b.close);
  const ef = emaAligned(closes, 9), es = emaAligned(closes, 21);
  return RIBBON_PERIODS.map((p) => {
    const line = emaAligned(closes, p);
    const g: any[] = [], r: any[] = [];
    for (let i = 0; i < bars.length; i++) {
      const t = bars[i].time;
      if (line[i] == null) { g.push({ time: t }); r.push({ time: t }); continue; }
      const up = ef[i] != null && es[i] != null ? (ef[i] as number) >= (es[i] as number) : true;
      g.push(up ? { time: t, value: +(line[i] as number).toFixed(6) } : { time: t });
      r.push(!up ? { time: t, value: +(line[i] as number).toFixed(6) } : { time: t });
    }
    return { g, r };
  });
}

// Candlestick pattern markers — scan each bar and tag recognised reversal/indecision
// patterns. Returns lightweight-charts markers (sorted ascending by time).
function patWin(bars: any[], i: number, n: number) {
  const s = bars.slice(Math.max(0, i - n + 1), i + 1);
  return { open: s.map((b) => b.open), high: s.map((b) => b.high), low: s.map((b) => b.low), close: s.map((b) => b.close) };
}
function computePatterns(bars: any[]) {
  if (!bars || bars.length < 3) return [];
  const out: any[] = [];
  for (let i = 2; i < bars.length; i++) {
    const t = bars[i].time;
    let m: { up: boolean; color: string; text: string } | null = null;
    try {
      if (eveningstar(patWin(bars, i, 3))) m = { up: false, color: "#ef5350", text: "Evening Star" };
      else if (morningstar(patWin(bars, i, 3))) m = { up: true, color: "#26a69a", text: "Morning Star" };
      else if (bearishengulfingpattern(patWin(bars, i, 2))) m = { up: false, color: "#ef5350", text: "Bear Engulf" };
      else if (bullishengulfingpattern(patWin(bars, i, 2))) m = { up: true, color: "#26a69a", text: "Bull Engulf" };
      else if (shootingstar(patWin(bars, i, 5))) m = { up: false, color: "#ef5350", text: "Shooting Star" };
      else if (hammerpattern(patWin(bars, i, 5))) m = { up: true, color: "#26a69a", text: "Hammer" };
      else if (doji(patWin(bars, i, 1))) m = { up: false, color: "#9aa0aa", text: "Doji" };
    } catch { /* pattern fn needs more candles — skip */ }
    if (m) out.push({ time: t, position: m.up ? "belowBar" : "aboveBar", color: m.color, shape: m.up ? "arrowUp" : "arrowDown", text: m.text });
  }
  return out;
}

// Parabolic SAR — trend dots plotted on the price chart (one value per bar).
function computePSAR(bars: any[], step = 0.02, max = 0.2) {
  if (!bars || bars.length < 3) return [];
  const res = PSAR.calculate({ step, max, high: bars.map((b) => b.high), low: bars.map((b) => b.low) });
  const off = bars.length - res.length;
  return res.map((v: number, k: number) => ({ time: bars[off + k].time, value: v }));
}

// MACD (12, 26, 9) — macd line, signal line, histogram bars
function computeMACD(bars: any[], fast = 12, slow = 26, sig = 9) {
  if (!bars || bars.length < slow + sig) return { macd: [], signal: [], hist: [] };
  const res = MACD.calculate({ values: bars.map((b) => b.close), fastPeriod: fast, slowPeriod: slow, signalPeriod: sig, SimpleMAOscillator: false, SimpleMASignal: false });
  const off = bars.length - res.length;
  const macd: any[] = [], signal: any[] = [], hist: any[] = [];
  res.forEach((r: any, k: number) => {
    const t = bars[off + k].time;
    if (r.MACD != null) macd.push({ time: t, value: +r.MACD.toFixed(6) });
    if (r.signal != null) signal.push({ time: t, value: +r.signal.toFixed(6) });
    if (r.histogram != null) hist.push({ time: t, value: +r.histogram.toFixed(6), color: r.histogram >= 0 ? "#26a69a99" : "#e0526099" });
  });
  return { macd, signal, hist };
}

export type ChartPosition = {
  id: string;
  type: "BUY" | "SELL";
  lots: number | string;
  openPrice: number;
  sl?: number;
  tp?: number;
  pnl?: number;
  kind?: string; // present => pending order
};

const TF_SECONDS: Record<string, number> = { "1M": 60, "5M": 300, "15M": 900, "30M": 1800, "1H": 3600, "4H": 14400, "1D": 86400 };

function LWChart({
  symbol, tf, theme, positions, digits = 2, showTools = true, ind, cfg, calcPnl, tool: toolProp, onTool, clearKey, spreadPips,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  positions?: ChartPosition[];
  digits?: number;
  onClose?: (id: string) => void;
  showTools?: boolean;
  spreadPips?: number;
  /** Pure P&L formula from the parent so the chart can update position labels
      live on its own internal tick (without re-rendering). */
  calcPnl?: (p: ChartPosition, price: number) => number;
  /** Controlled indicators from a parent header (desktop). When set, the in-chart
      left sidebar is hidden and the parent renders the SMA/EMA/BB/RSI/MACD buttons. */
  ind?: { sma: boolean; ema: boolean; bb: boolean; rsi: boolean; macd: boolean; psar?: boolean; cdl?: boolean; stoch?: boolean; atr?: boolean; adx?: boolean; sig?: boolean; ribbon?: boolean };
  /** Configurable indicator periods (TradingView-style settings). */
  cfg?: { ma?: number; rsi?: number; bb?: number; macdF?: number; macdS?: number; macdSig?: number };
  /** Controlled drawing tool from a parent header (H-line / trend next to indicators).
      When onTool is set, the in-chart floating draw toolbar is hidden. */
  tool?: "none" | "hline" | "trend" | "erase";
  onTool?: (t: "none" | "hline" | "trend" | "erase") => void;
  clearKey?: number; // increment to clear all drawings
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const barsRef = useRef<any[]>([]);
  const askLineRef = useRef<any>(null);
  const bidLineRef = useRef<any>(null);
  const spreadPipsRef = useRef(spreadPips ?? 0);
  spreadPipsRef.current = spreadPips ?? 0;
  // TradingView-style OHLC legend (updated via ref, no re-render) + right-click menu
  const legendRef = useRef<HTMLDivElement | null>(null);
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const cfgKey = JSON.stringify(cfg || {});
  const fmtLegRef = useRef<(b: any) => void>(() => {});
  const hoveringRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; price: number | null } | null>(null);
  const lineRefs = useRef<any[]>([]);
  const linePricesRef = useRef<number[]>([]); // entry/SL/TP/trigger prices to keep in view
  const posLinesRef = useRef<{ line: any; p: ChartPosition }[]>([]); // open-trade entry lines for live P&L labels
  const calcPnlRef = useRef(calcPnl); calcPnlRef.current = calcPnl;
  const symRef = useRef(symbol);
  const tfRef = useRef(tf);
  symRef.current = symbol; tfRef.current = tf;

  // Drawing tools + indicators — `tool` may be controlled by a parent header.
  const [internalTool, setInternalTool] = useState<"none" | "hline" | "trend" | "erase">("none");
  const tool = toolProp !== undefined ? toolProp : internalTool;
  const setTool = (t: "none" | "hline" | "trend" | "erase") => { if (onTool) onTool(t); else setInternalTool(t); };
  const toolRef = useRef(tool); toolRef.current = tool;
  const [sma, setSma] = useState(false);
  const [ema, setEma] = useState(false);
  const [rsi, setRsi] = useState(false);
  const [psar, setPsar] = useState(false);
  const [cdl, setCdl] = useState(false);
  const markersRef = useRef<any>(null);
  const [sig, setSig] = useState(false);
  const sigMarkersRef = useRef<any>(null);
  const [ribbon, setRibbon] = useState(false);
  const ribbonRefs = useRef<any[]>([]);
  const [drawN, setDrawN] = useState(0);
  const hlineRefs = useRef<any[]>([]);
  const trendRefs = useRef<any[]>([]);
  const trendStart = useRef<{ time: any; value: number } | null>(null);
  const smaRef = useRef<any>(null);
  const emaRef = useRef<any>(null);
  const psarRef = useRef<any>(null);
  const rsiWrapRef = useRef<HTMLDivElement | null>(null);
  const rsiChartRef = useRef<any>(null);
  const rsiSeriesRef = useRef<any>(null);
  // Called inside seed() after bars load so indicators update even before user toggles
  const onBarsLoaded = useRef<() => void>(() => {});
  // Bollinger Bands
  const [bb, setBb] = useState(false);
  const bbMidRef = useRef<any>(null), bbUpRef = useRef<any>(null), bbLoRef = useRef<any>(null);
  // MACD
  const [macd, setMacd] = useState(false);
  const macdWrapRef = useRef<HTMLDivElement | null>(null);
  const macdChartRef = useRef<any>(null), macdLineRef = useRef<any>(null), macdSignalRef = useRef<any>(null), macdHistRef = useRef<any>(null);
  // Stochastic / ATR / ADX sub-panes
  const [stoch, setStoch] = useState(false);
  const stochWrapRef = useRef<HTMLDivElement | null>(null);
  const stochChartRef = useRef<any>(null), stochKRef = useRef<any>(null), stochDRef = useRef<any>(null);
  const [atr, setAtr] = useState(false);
  const atrWrapRef = useRef<HTMLDivElement | null>(null);
  const atrChartRef = useRef<any>(null), atrSeriesRef = useRef<any>(null);
  const [adx, setAdx] = useState(false);
  const adxWrapRef = useRef<HTMLDivElement | null>(null);
  const adxChartRef = useRef<any>(null), adxSeriesRef = useRef<any>(null);

  // When indicators are controlled by a parent header (desktop), sync them into
  // the internal state so all the existing chart effects keep working unchanged.
  useEffect(() => {
    if (!ind) return;
    setSma(ind.sma); setEma(ind.ema); setBb(ind.bb); setRsi(ind.rsi); setMacd(ind.macd); setPsar(!!ind.psar); setCdl(!!ind.cdl); setStoch(!!ind.stoch); setAtr(!!ind.atr); setAdx(!!ind.adx); setSig(!!ind.sig); setRibbon(!!ind.ribbon);
  }, [ind?.sma, ind?.ema, ind?.bb, ind?.rsi, ind?.macd, ind?.psar, ind?.cdl, ind?.stoch, ind?.atr, ind?.adx, ind?.sig, ind?.ribbon]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearDrawings() {
    for (const h of hlineRefs.current) { try { seriesRef.current?.removePriceLine(h.line ?? h); } catch {} }
    hlineRefs.current = [];
    for (const tr of trendRefs.current) { try { chartRef.current?.removeSeries(tr.series ?? tr); } catch {} }
    trendRefs.current = [];
    trendStart.current = null; setDrawN(0); setTool("none");
  }
  // Parent-triggered clear (header "clear drawings" button).
  useEffect(() => { if (clearKey) clearDrawings(); /* eslint-disable-next-line */ }, [clearKey]);

  // Create / recreate chart on theme change
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const dark = theme === "dark";
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dark ? "#9aa6bf" : "#475569", fontSize: 11 },
      grid: { vertLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" }, horzLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" } },
      rightPriceScale: { borderColor: dark ? "#242a38" : "#e2e8f0" },
      timeScale: { borderColor: dark ? "#242a38" : "#e2e8f0", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a", downColor: "#e05260", borderUpColor: "#26a69a", borderDownColor: "#e05260",
      wickUpColor: "#26a69a", wickDownColor: "#e05260",
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
      // Scale to the CANDLES only (MT4/MT5 behaviour). Open-trade entry/SL/TP
      // lines still draw, but they no longer stretch the axis — a far-away entry
      // price won't force the chart to zoom out and squash the price action.
    });
    chartRef.current = chart;
    seriesRef.current = series;
    // Bid / Ask price lines (MT5 style) — created once, updated on each tick via ref
    askLineRef.current = series.createPriceLine({ price: 0, color: "#26a69a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Ask" });
    bidLineRef.current = series.createPriceLine({ price: 0, color: "#ef5350", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Bid" });
    // a recreated chart loses prior drawings/indicators — drop the stale refs
    hlineRefs.current = []; trendRefs.current = []; smaRef.current = null; emaRef.current = null; psarRef.current = null; markersRef.current = null; sigMarkersRef.current = null; ribbonRefs.current = []; trendStart.current = null;
    // Click handler for H-Line / Trend drawing tools
    chart.subscribeClick((param: any) => {
      const t = toolRef.current;
      if (t === "none" || !param.point || param.time == null || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price == null) return;
      if (t === "hline") {
        const line = seriesRef.current.createPriceLine({ price, color: "#f0b90b", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" });
        hlineRefs.current.push({ line, price });
        setTool("none"); setDrawN((n) => n + 1);
      } else if (t === "trend") {
        if (!trendStart.current) { trendStart.current = { time: param.time, value: price }; }
        else {
          const pts = [trendStart.current, { time: param.time, value: price }].sort((x, y) => (x.time as number) - (y.time as number));
          const ls = chart.addSeries(LineSeries, { color: "#5aa9ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          try { ls.setData(pts); } catch {}
          trendRefs.current.push({ series: ls, a: pts[0], b: pts[1] });
          trendStart.current = null; setTool("none"); setDrawN((n) => n + 1);
        }
      } else if (t === "erase") {
        // Delete just the ONE drawn line nearest to the click (within ~13px).
        const yPx = param.point.y; const s2 = seriesRef.current;
        let bestDist = 13, bestKind = "", bestIdx = -1;
        hlineRefs.current.forEach((h: any, i: number) => { const ly = s2.priceToCoordinate(h.price); if (ly == null) return; const d = Math.abs(ly - yPx); if (d < bestDist) { bestDist = d; bestKind = "h"; bestIdx = i; } });
        trendRefs.current.forEach((tr: any, i: number) => { const a = tr.a, b = tr.b; if (!a || !b) return; const ct = param.time as number; let v: number; if (ct <= (a.time as number)) v = a.value; else if (ct >= (b.time as number)) v = b.value; else v = a.value + (b.value - a.value) * ((ct - (a.time as number)) / ((b.time as number) - (a.time as number))); const ly = s2.priceToCoordinate(v); if (ly == null) return; const d = Math.abs(ly - yPx); if (d < bestDist) { bestDist = d; bestKind = "t"; bestIdx = i; } });
        if (bestKind === "h") { try { s2.removePriceLine(hlineRefs.current[bestIdx].line); } catch {} hlineRefs.current.splice(bestIdx, 1); setDrawN((n) => n + 1); }
        else if (bestKind === "t") { try { chart.removeSeries(trendRefs.current[bestIdx].series); } catch {} trendRefs.current.splice(bestIdx, 1); setDrawN((n) => n + 1); }
      }
    });
    // OHLC legend (TradingView-style) — updated on crosshair move / each tick.
    fmtLegRef.current = (b: any) => {
      if (!legendRef.current || !b || b.open == null) return;
      const up = b.close >= b.open; const col = up ? "#26a69a" : "#ef5350";
      const ch = b.close - b.open, pct = b.open ? (ch / b.open) * 100 : 0;
      legendRef.current.innerHTML =
        `<span style="opacity:.6">O</span><span style="color:${col}">${b.open}</span>` +
        ` <span style="opacity:.6">H</span><span style="color:${col}">${b.high}</span>` +
        ` <span style="opacity:.6">L</span><span style="color:${col}">${b.low}</span>` +
        ` <span style="opacity:.6">C</span><span style="color:${col}">${b.close}</span>` +
        ` <span style="color:${col}">${ch >= 0 ? "+" : ""}${ch.toFixed(digits)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)</span>`;
    };
    chart.subscribeCrosshairMove((param: any) => {
      const d = param?.seriesData?.get(series);
      if (d && d.open != null) { hoveringRef.current = true; fmtLegRef.current(d); }
      else { hoveringRef.current = false; const last = barsRef.current[barsRef.current.length - 1]; if (last) fmtLegRef.current(last); }
    });
    if (barsRef.current.length) { series.setData(barsRef.current); chart.timeScale().fitContent(); fmtLegRef.current(barsRef.current[barsRef.current.length - 1]); }
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [theme, digits]);

  // Indicators (SMA / EMA / BB overlays) — add/remove + recompute on toggle or data change
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    // SMA
    if (sma && !smaRef.current) smaRef.current = chart.addSeries(LineSeries, { color: "#f0b90b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    if (!sma && smaRef.current) { try { chart.removeSeries(smaRef.current); } catch {} smaRef.current = null; }
    if (sma && smaRef.current) { try { smaRef.current.setData(computeMA(barsRef.current, cfgRef.current?.ma || 20, false)); } catch {} }
    // EMA
    if (ema && !emaRef.current) emaRef.current = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    if (!ema && emaRef.current) { try { chart.removeSeries(emaRef.current); } catch {} emaRef.current = null; }
    if (ema && emaRef.current) { try { emaRef.current.setData(computeMA(barsRef.current, cfgRef.current?.ma || 20, true)); } catch {} }
    // Bollinger Bands
    if (bb && !bbMidRef.current) {
      bbMidRef.current = chart.addSeries(LineSeries, { color: "#f0b90b88", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      bbUpRef.current = chart.addSeries(LineSeries, { color: "#5aa9ff66", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      bbLoRef.current = chart.addSeries(LineSeries, { color: "#5aa9ff66", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }
    if (!bb && bbMidRef.current) {
      try { chart.removeSeries(bbMidRef.current); chart.removeSeries(bbUpRef.current); chart.removeSeries(bbLoRef.current); } catch {}
      bbMidRef.current = null; bbUpRef.current = null; bbLoRef.current = null;
    }
    if (bb && bbMidRef.current) { const { mid, upper, lower } = computeBB(barsRef.current, cfgRef.current?.bb || 20); try { bbMidRef.current.setData(mid); bbUpRef.current.setData(upper); bbLoRef.current.setData(lower); } catch {} }
    // Parabolic SAR — dots on the price chart (line hidden, point markers shown)
    if (psar && !psarRef.current) psarRef.current = chart.addSeries(LineSeries, { color: "#eab308", lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.7, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as any);
    if (!psar && psarRef.current) { try { chart.removeSeries(psarRef.current); } catch {} psarRef.current = null; }
    if (psar && psarRef.current) { try { psarRef.current.setData(computePSAR(barsRef.current)); } catch {} }
    // MA ribbon (5 EMAs, green up / red down)
    if (ribbon && ribbonRefs.current.length === 0 && seriesRef.current) {
      for (let i = 0; i < RIBBON_PERIODS.length; i++) {
        const op = 0.3 + i * 0.08;
        ribbonRefs.current.push(chart.addSeries(LineSeries, { color: `rgba(38,166,154,${op})`, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
        ribbonRefs.current.push(chart.addSeries(LineSeries, { color: `rgba(239,83,80,${op})`, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
      }
    }
    if (!ribbon && ribbonRefs.current.length) { for (const s of ribbonRefs.current) { try { chart.removeSeries(s); } catch {} } ribbonRefs.current = []; }
    if (ribbon && ribbonRefs.current.length) { try { const rb = computeRibbon(barsRef.current); rb.forEach((d, i) => { ribbonRefs.current[i * 2]?.setData(d.g); ribbonRefs.current[i * 2 + 1]?.setData(d.r); }); } catch {} }
    // Trade signals (BUY/SELL/Strong markers on the price series)
    if (sig && seriesRef.current) {
      try { const ms = computeSignals(barsRef.current); if (sigMarkersRef.current) sigMarkersRef.current.setMarkers(ms); else sigMarkersRef.current = createSeriesMarkers(seriesRef.current, ms); } catch {}
    } else if (!sig && sigMarkersRef.current) { try { sigMarkersRef.current.setMarkers([]); } catch {} }
    // Candlestick pattern markers (on the price series)
    if (cdl && seriesRef.current) {
      try {
        const mk = computePatterns(barsRef.current);
        if (markersRef.current) markersRef.current.setMarkers(mk);
        else markersRef.current = createSeriesMarkers(seriesRef.current, mk);
      } catch {}
    } else if (!cdl && markersRef.current) {
      try { markersRef.current.setMarkers([]); } catch {}
    }
    // Sub-pane data sync (charts managed by their own effects)
    if (rsi && rsiSeriesRef.current) { try { rsiSeriesRef.current.setData(computeRSI(barsRef.current, cfgRef.current?.rsi || 14)); } catch {} }
    if (macd && macdLineRef.current) { const { macd: ml, signal: sl, hist: hl } = computeMACD(barsRef.current, cfgRef.current?.macdF || 12, cfgRef.current?.macdS || 26, cfgRef.current?.macdSig || 9); try { macdLineRef.current.setData(ml); macdSignalRef.current?.setData(sl); macdHistRef.current?.setData(hl); } catch {} }
    if (stoch && stochKRef.current) { const { k, d } = computeStoch(barsRef.current); try { stochKRef.current.setData(k); stochDRef.current?.setData(d); } catch {} }
    if (atr && atrSeriesRef.current) { try { atrSeriesRef.current.setData(computeATR(barsRef.current)); } catch {} }
    if (adx && adxSeriesRef.current) { try { adxSeriesRef.current.setData(computeADX(barsRef.current)); } catch {} }
    // Keep onBarsLoaded fresh so seed() triggers indicator recompute after async bar load
    onBarsLoaded.current = () => {
      if (smaRef.current) { try { smaRef.current.setData(computeMA(barsRef.current, cfgRef.current?.ma || 20, false)); } catch {} }
      if (emaRef.current) { try { emaRef.current.setData(computeMA(barsRef.current, cfgRef.current?.ma || 20, true)); } catch {} }
      if (bbMidRef.current) { const { mid, upper, lower } = computeBB(barsRef.current, cfgRef.current?.bb || 20); try { bbMidRef.current.setData(mid); bbUpRef.current?.setData(upper); bbLoRef.current?.setData(lower); } catch {} }
      if (psarRef.current) { try { psarRef.current.setData(computePSAR(barsRef.current)); } catch {} }
      if (ribbonRefs.current.length) { try { const rb = computeRibbon(barsRef.current); rb.forEach((d, i) => { ribbonRefs.current[i * 2]?.setData(d.g); ribbonRefs.current[i * 2 + 1]?.setData(d.r); }); } catch {} }
      if (sigMarkersRef.current && sig) { try { sigMarkersRef.current.setMarkers(computeSignals(barsRef.current)); } catch {} }
      if (markersRef.current && cdl) { try { markersRef.current.setMarkers(computePatterns(barsRef.current)); } catch {} }
      if (rsiSeriesRef.current) { try { rsiSeriesRef.current.setData(computeRSI(barsRef.current, cfgRef.current?.rsi || 14)); } catch {} }
      if (macdLineRef.current) { const { macd: ml, signal: sl, hist: hl } = computeMACD(barsRef.current, cfgRef.current?.macdF || 12, cfgRef.current?.macdS || 26, cfgRef.current?.macdSig || 9); try { macdLineRef.current.setData(ml); macdSignalRef.current?.setData(sl); macdHistRef.current?.setData(hl); } catch {} }
      if (stochKRef.current) { const { k, d } = computeStoch(barsRef.current); try { stochKRef.current.setData(k); stochDRef.current?.setData(d); } catch {} }
      if (atrSeriesRef.current) { try { atrSeriesRef.current.setData(computeATR(barsRef.current)); } catch {} }
      if (adxSeriesRef.current) { try { adxSeriesRef.current.setData(computeADX(barsRef.current)); } catch {} }
    };
  }, [sma, ema, bb, rsi, macd, psar, cdl, sig, ribbon, stoch, atr, adx, symbol, tf, theme, digits, drawN, cfgKey]);

  // RSI sub-pane chart (separate LW instance below main chart)
  useEffect(() => {
    if (!rsi) {
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; rsiSeriesRef.current = null; }
      return;
    }
    const el = rsiWrapRef.current;
    if (!el) return;
    let raf = 0;
    let syncFn: ((r: any) => void) | null = null;
    raf = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const dark = theme === "dark";
      const chart = createChart(el, {
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dark ? "#9aa6bf" : "#475569", fontSize: 9 },
        grid: { vertLines: { color: "transparent" }, horzLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" } },
        rightPriceScale: { borderColor: dark ? "#242a38" : "#e2e8f0", scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { visible: false },
        autoSize: true,
        handleScroll: false,
        handleScale: false,
      });
      const series = chart.addSeries(LineSeries, {
        color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      series.createPriceLine({ price: 30, color: "#e05260", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      series.createPriceLine({ price: 70, color: "#26a69a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      rsiChartRef.current = chart; rsiSeriesRef.current = series;
      if (barsRef.current.length) { try { series.setData(computeRSI(barsRef.current, cfgRef.current?.rsi || 14)); } catch {} }
      syncFn = (range: any) => { if (range && rsiChartRef.current) { try { rsiChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {} } };
      if (chartRef.current) chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncFn);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (syncFn && chartRef.current) { try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(syncFn); } catch {} }
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; rsiSeriesRef.current = null; }
    };
  }, [rsi, theme]);

  // MACD sub-pane chart (separate LW instance, stacks below RSI if both active)
  useEffect(() => {
    if (!macd) {
      if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; macdLineRef.current = null; macdSignalRef.current = null; macdHistRef.current = null; }
      return;
    }
    const el = macdWrapRef.current; if (!el) return;
    let raf = 0; let syncFn: ((r: any) => void) | null = null;
    raf = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const dark = theme === "dark";
      const chart = createChart(el, {
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dark ? "#9aa6bf" : "#475569", fontSize: 9 },
        grid: { vertLines: { color: "transparent" }, horzLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" } },
        rightPriceScale: { borderColor: dark ? "#242a38" : "#e2e8f0", scaleMargins: { top: 0.15, bottom: 0.15 } },
        timeScale: { visible: false }, autoSize: true, handleScroll: false, handleScale: false,
      });
      const histS = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      const lineS = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: 5, minMove: 0.00001 } });
      const sigS = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      macdChartRef.current = chart; macdLineRef.current = lineS; macdSignalRef.current = sigS; macdHistRef.current = histS;
      if (barsRef.current.length) { const { macd: ml, signal: sl, hist: hl } = computeMACD(barsRef.current, cfgRef.current?.macdF || 12, cfgRef.current?.macdS || 26, cfgRef.current?.macdSig || 9); try { lineS.setData(ml); sigS.setData(sl); histS.setData(hl); } catch {} }
      syncFn = (range: any) => { if (range && macdChartRef.current) { try { macdChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {} } };
      if (chartRef.current) chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncFn);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (syncFn && chartRef.current) { try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(syncFn); } catch {} }
      if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; macdLineRef.current = null; macdSignalRef.current = null; macdHistRef.current = null; }
    };
  }, [macd, theme]);

  // Generic 0..100 / price sub-pane factory for Stochastic, ATR, ADX.
  function makePane(el: HTMLDivElement, opts: { range100?: boolean }) {
    const dark = theme === "dark";
    return createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dark ? "#9aa6bf" : "#475569", fontSize: 9 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" } },
      rightPriceScale: { borderColor: dark ? "#242a38" : "#e2e8f0", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { visible: false }, autoSize: true, handleScroll: false, handleScale: false,
    });
  }
  // Stochastic sub-pane (%K cyan, %D orange, 0..100)
  useEffect(() => {
    if (!stoch) { if (stochChartRef.current) { stochChartRef.current.remove(); stochChartRef.current = null; stochKRef.current = null; stochDRef.current = null; } return; }
    const el = stochWrapRef.current; if (!el) return;
    let raf = 0; let syncFn: ((r: any) => void) | null = null;
    raf = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const chart = makePane(el, { range100: true });
      const kS = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: 1, minMove: 0.1 }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      const dS = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      kS.createPriceLine({ price: 20, color: "#e05260", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      kS.createPriceLine({ price: 80, color: "#26a69a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      stochChartRef.current = chart; stochKRef.current = kS; stochDRef.current = dS;
      if (barsRef.current.length) { const { k, d } = computeStoch(barsRef.current); try { kS.setData(k); dS.setData(d); } catch {} }
      syncFn = (range: any) => { if (range && stochChartRef.current) { try { stochChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {} } };
      if (chartRef.current) chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncFn);
    });
    return () => { cancelAnimationFrame(raf); if (syncFn && chartRef.current) { try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(syncFn); } catch {} } if (stochChartRef.current) { stochChartRef.current.remove(); stochChartRef.current = null; stochKRef.current = null; stochDRef.current = null; } };
  }, [stoch, theme]);
  // ATR sub-pane (single line, price-scale auto)
  useEffect(() => {
    if (!atr) { if (atrChartRef.current) { atrChartRef.current.remove(); atrChartRef.current = null; atrSeriesRef.current = null; } return; }
    const el = atrWrapRef.current; if (!el) return;
    let raf = 0; let syncFn: ((r: any) => void) | null = null;
    raf = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const chart = makePane(el, {});
      const s = chart.addSeries(LineSeries, { color: "#eab308", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) } });
      atrChartRef.current = chart; atrSeriesRef.current = s;
      if (barsRef.current.length) { try { s.setData(computeATR(barsRef.current)); } catch {} }
      syncFn = (range: any) => { if (range && atrChartRef.current) { try { atrChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {} } };
      if (chartRef.current) chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncFn);
    });
    return () => { cancelAnimationFrame(raf); if (syncFn && chartRef.current) { try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(syncFn); } catch {} } if (atrChartRef.current) { atrChartRef.current.remove(); atrChartRef.current = null; atrSeriesRef.current = null; } };
  }, [atr, theme, digits]);
  // ADX sub-pane (single line, 0..100)
  useEffect(() => {
    if (!adx) { if (adxChartRef.current) { adxChartRef.current.remove(); adxChartRef.current = null; adxSeriesRef.current = null; } return; }
    const el = adxWrapRef.current; if (!el) return;
    let raf = 0; let syncFn: ((r: any) => void) | null = null;
    raf = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const chart = makePane(el, { range100: true });
      const s = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: 1, minMove: 0.1 }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      s.createPriceLine({ price: 25, color: "#9aa0aa", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      adxChartRef.current = chart; adxSeriesRef.current = s;
      if (barsRef.current.length) { try { s.setData(computeADX(barsRef.current)); } catch {} }
      syncFn = (range: any) => { if (range && adxChartRef.current) { try { adxChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {} } };
      if (chartRef.current) chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(syncFn);
    });
    return () => { cancelAnimationFrame(raf); if (syncFn && chartRef.current) { try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(syncFn); } catch {} } if (adxChartRef.current) { adxChartRef.current.remove(); adxChartRef.current = null; adxSeriesRef.current = null; } };
  }, [adx, theme]);

  // Load Twelve Data historical candles (up to 5000) on symbol / timeframe change
  useEffect(() => {
    let alive = true;
    barsRef.current = [];
    // Clear the series immediately so a live tick arriving mid-reseed can't push a
    // bar with a time older than the previous timeframe's last bar (which throws
    // "Cannot update oldest data").
    try { seriesRef.current?.setData([]); } catch {}
    function seed(raw: any[]) {
      if (!alive || !seriesRef.current || !raw || !raw.length) return false;
      const seen = new Set<number>();
      const bars = raw
        .map((c: any) => ({ time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }))
        .filter((c: any) => isFinite(c.time) && isFinite(c.close))
        .sort((a: any, b: any) => a.time - b.time)
        .filter((c: any) => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
      if (!bars.length) return false;
      try { seriesRef.current.setData(bars); barsRef.current = bars; chartRef.current?.timeScale().fitContent(); onBarsLoaded.current(); fmtLegRef.current(bars[bars.length - 1]); return true; }
      catch { return false; }
    }
    // Build a plausible `count`-bar history (random walk) ending at `lastPrice`,
    // so symbols the data feed can't supply (derived metals, grams, some indices)
    // still get a full chart that connects seamlessly to the live price.
    function synth(lastPrice: number, count: number) {
      const sec = TF_SECONDS[tf] || 60;
      const now = Math.floor(Date.now() / 1000 / sec) * sec;
      const step = Math.pow(10, -digits);
      const round = (n: number) => Number(n.toFixed(digits));
      const tmp: any[] = [];
      let close = lastPrice;
      for (let i = 0; i < count; i++) {
        const t = now - i * sec;
        const vol = step * (6 + Math.random() * 22); // per-bar range in points
        let open = close + (Math.random() - 0.5) * vol;
        if (open <= 0) open = close;
        const high = Math.max(open, close) + Math.random() * vol * 0.5;
        const low = Math.max(step, Math.min(open, close) - Math.random() * vol * 0.5);
        tmp.push({ time: t, open: round(open), high: round(high), low: round(low), close: round(close) });
        close = open; // walk backwards
      }
      return tmp.reverse();
    }

    // Instant open: seed the chart from the last cached bars for this symbol+tf so
    // it renders immediately on refresh, then the live fetch below refreshes it.
    const cacheKey = "cubex-candles:" + symbol + ":" + tf;
    try { const cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); if (cached && cached.length) seed(cached); } catch {}

    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const ok = d && d.ok && seed(d.candles);
        if (ok && d.candles) { try { localStorage.setItem(cacheKey, JSON.stringify(d.candles.slice(-300))); } catch {} }
        // Fallback: the feed returned nothing for this symbol. Synthesize a full
        // 5000-bar history seeded from the first live price we receive.
        if (!ok) {
          const sock: Socket = io({ path: "/socket.io" });
          let done = false;
          const finish = () => { if (!done) { done = true; try { sock.disconnect(); } catch {} } };
          sock.on("tick", ({ symbol: sym, price }: any) => {
            if (!alive) { finish(); return; }
            if (done || sym !== symRef.current || !(price > 0) || barsRef.current.length) return;
            if (seed(synth(price, 5000))) finish();
          });
          // last resort: whatever live 1-min history the server already holds
          sock.on("history", (h: any) => { if (!barsRef.current.length) seed(h[symRef.current]); });
          setTimeout(finish, 5000);
        }
      })
      .catch((e) => console.warn("[LWChart] candle fetch failed", e));
    return () => { alive = false; };
  }, [symbol, tf]);

  // Live updates: build the forming bar from the live price stream. Ticks are
  // buffered and applied on a fixed ~80ms cadence (tracking the interval high/low so
  // the candle stays accurate) — the same cadence the Buy/Sell buttons use, so the
  // chart and the buttons move at the same speed.
  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    let pClose: number | null = null, pHi = -Infinity, pLo = Infinity;
    socket.on("tick", ({ symbol: sym, price }: any) => {
      if (sym !== symRef.current || price == null) return;
      pClose = price; if (price > pHi) pHi = price; if (price < pLo) pLo = price;
    });
    const apply = () => {
      if (pClose == null || !seriesRef.current) return;
      const close = pClose, hi = pHi, lo = pLo; pClose = null; pHi = -Infinity; pLo = Infinity;
      const sec = TF_SECONDS[tfRef.current] || 60;
      const t = Math.floor(Date.now() / 1000 / sec) * sec;
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      try {
        if (last && last.time === t) {
          last.high = Math.max(last.high, hi); last.low = Math.min(last.low, lo); last.close = close;
          seriesRef.current.update(last);
        } else if (!last || t > last.time) {
          const bar = { time: t, open: close, high: hi, low: lo, close };
          bars.push(bar);
          seriesRef.current.update(bar);
        }
        // Update bid/ask lines on each tick; hide bid when spread = 0 (bid = ask)
        const spPx = spreadPipsRef.current * Math.pow(10, -(digits - 1));
        try {
          askLineRef.current?.applyOptions({ price: close });
          bidLineRef.current?.applyOptions({ price: close - spPx, axisLabelVisible: spPx > 0 });
        } catch {}
        if (!hoveringRef.current) fmtLegRef.current(barsRef.current[barsRef.current.length - 1]);
      } catch { /* out-of-order tick during a reseed — ignore */ }
    };
    const iv = setInterval(apply, 80);
    return () => { socket.disconnect(); clearInterval(iv); };
  }, [symbol]);

  // Draw position / pending price lines (entry, SL, TP) — colored by order side
  useEffect(() => {
    const s = seriesRef.current; if (!s) return;
    for (const l of lineRefs.current) { try { s.removePriceLine(l); } catch {} }
    lineRefs.current = [];
    posLinesRef.current = [];
    const lp: number[] = [];
    for (const p of positions || []) { lp.push(p.openPrice); if (p.sl) lp.push(p.sl); if (p.tp) lp.push(p.tp); }
    linePricesRef.current = lp;
    for (const p of positions || []) {
      const pending = !!p.kind;
      // Entry line: BUY=blue, SELL=crimson; pending=amber (dotted)
      const entryCol = pending ? "#f59e0b" : (p.type === "BUY" ? "#3b82f6" : "#ef4444");
      // Thin dotted entry line; label shows side + lots only (no running P&L).
      const entryLine = s.createPriceLine({
        price: p.openPrice, color: entryCol, lineWidth: 1,
        lineStyle: LineStyle.Dotted, axisLabelVisible: true,
        title: `${p.kind ? p.kind + " " : ""}${p.type} ${Number(p.openPrice)}`,
      });
      lineRefs.current.push(entryLine);
      // SL = rose red; TP = emerald green — thin dotted, same for all trade types.
      // Label each with its exact price so multiple trades' SL/TP stay distinct.
      if (p.sl) lineRefs.current.push(s.createPriceLine({ price: p.sl, color: "#f43f5e", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `SL ${Number(p.sl)}` }));
      if (p.tp) lineRefs.current.push(s.createPriceLine({ price: p.tp, color: "#10b981", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `TP ${Number(p.tp)}` }));
    }
  }, [positions, theme, tf, symbol]);

  const tbV = (active: boolean): CSSProperties => ({
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    width: 30, height: 30, borderRadius: 7, border: "none",
    background: active ? "rgba(90,169,255,0.18)" : "transparent",
    color: active ? "#5aa9ff" : (theme === "dark" ? "#7a8699" : "#64748b"),
    transition: "background 0.12s, color 0.12s",
    outline: active ? "1.5px solid rgba(90,169,255,0.4)" : "none",
  });
  const bord = theme === "dark" ? "#242a38" : "#e2e8f0";
  const panelBg = theme === "dark" ? "rgba(14,18,28,0.96)" : "rgba(246,248,252,0.97)";
  // Drawing + indicator buttons, shared between the left sidebar (mobile) and the
  // top header bar (desktop, when topTools is set).
  const toolBtns = (
    <>
      <button style={tbV(tool === "hline")} onClick={() => setTool(tool === "hline" ? "none" : "hline")} title="Horizontal line">
        <i className="fa-solid fa-minus" style={{ fontSize: 12 }} />
      </button>
      <button style={tbV(tool === "trend")} onClick={() => setTool(tool === "trend" ? "none" : "trend")} title="Trend line">
        <i className="fa-solid fa-arrow-trend-up" style={{ fontSize: 12 }} />
      </button>
      <button style={tbV(tool === "erase")} onClick={() => setTool(tool === "erase" ? "none" : "erase")} title="Erase one (click a line)">
        <i className="fa-solid fa-eraser" style={{ fontSize: 12 }} />
      </button>
      {(drawN > 0 || hlineRefs.current.length > 0 || trendRefs.current.length > 0) && (
        <button style={tbV(false)} onClick={clearDrawings} title="Clear all drawings">
          <i className="fa-solid fa-trash-can" style={{ fontSize: 11 }} />
        </button>
      )}
      <button style={{ ...tbV(sma), fontSize: 9, fontWeight: 700 }} onClick={() => setSma((v) => !v)} title="SMA 20">SMA</button>
      <button style={{ ...tbV(ema), fontSize: 9, fontWeight: 700 }} onClick={() => setEma((v) => !v)} title="EMA 20">EMA</button>
      <button style={{ ...tbV(bb), fontSize: 8, fontWeight: 700 }} onClick={() => setBb((v) => !v)} title="Bollinger Bands (20,2)">BB</button>
      <button style={{ ...tbV(rsi), fontSize: 9, fontWeight: 700 }} onClick={() => setRsi((v) => !v)} title="RSI 14">RSI</button>
      <button style={{ ...tbV(macd), fontSize: 7, fontWeight: 700 }} onClick={() => setMacd((v) => !v)} title="MACD (12,26,9)">MACD</button>
    </>
  );
  // Drawing tools only (H-line / trend / clear) — shown as a floating toolbar on the
  // chart for desktop, where indicators live in the page header (`ind` controlled).
  const drawBtns = (
    <>
      <button style={tbV(tool === "hline")} onClick={() => setTool(tool === "hline" ? "none" : "hline")} title="Horizontal line">
        <i className="fa-solid fa-minus" style={{ fontSize: 12 }} />
      </button>
      <button style={tbV(tool === "trend")} onClick={() => setTool(tool === "trend" ? "none" : "trend")} title="Trend line">
        <i className="fa-solid fa-arrow-trend-up" style={{ fontSize: 12 }} />
      </button>
      <button style={tbV(tool === "erase")} onClick={() => setTool(tool === "erase" ? "none" : "erase")} title="Erase one (click a line)">
        <i className="fa-solid fa-eraser" style={{ fontSize: 12 }} />
      </button>
      {(drawN > 0 || hlineRefs.current.length > 0 || trendRefs.current.length > 0) && (
        <button style={tbV(false)} onClick={clearDrawings} title="Clear all drawings">
          <i className="fa-solid fa-trash-can" style={{ fontSize: 11 }} />
        </button>
      )}
    </>
  );
  return (
    <>
    <div style={{ display: "flex", flexDirection: "row", height: "100%", width: "100%" }}>
      {/* Left sidebar — TradingView-style tool panel (mobile / default). Hidden when
          showTools=false, or when indicators are controlled by a parent header (`ind`). */}
      {showTools && !ind && (
        <div style={{ width: 42, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 5px", gap: 4, background: panelBg, borderRight: `1px solid ${bord}` }}>
          {toolBtns}
        </div>
      )}
      {/* Chart column */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        {/* Main price chart */}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}
          onContextMenu={(e) => { e.preventDefault(); let price: number | null = null; try { const r = wrapRef.current?.getBoundingClientRect(); if (r && seriesRef.current) price = seriesRef.current.coordinateToPrice(e.clientY - r.top); } catch {} setCtxMenu({ x: e.clientX, y: e.clientY, price }); }}>
          <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
          {/* TradingView-style OHLC legend — next to the Trade toggle (showTools only) */}
          {showTools && <div ref={legendRef} style={{ position: "absolute", top: 8, left: 70, zIndex: 6, fontSize: 11, fontWeight: 600, pointerEvents: "none", whiteSpace: "nowrap", color: theme === "dark" ? "#9aa6bf" : "#475569", textShadow: theme === "dark" ? "0 1px 2px rgba(0,0,0,0.6)" : "none" }} />}
          {/* Desktop drawing tools (H-line / trend / clear) — floating top-left.
              Hidden when the parent header controls the tool (onTool set). */}
          {showTools && ind && !onTool && (
            <div style={{ position: "absolute", top: 26, left: 8, zIndex: 6, display: "flex", gap: 3, padding: "3px 5px", borderRadius: 8, background: panelBg, border: `1px solid ${bord}` }}>
              {drawBtns}
            </div>
          )}
          {tool !== "none" && (
            <div style={{ position: "absolute", bottom: 6, left: 8, zIndex: 5, pointerEvents: "none" }}>
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(90,169,255,0.85)", color: "#fff" }}>
                {tool === "hline" ? "Click chart to place line" : trendStart.current ? "Click second point" : "Click first point"}
              </span>
            </div>
          )}
        </div>
        {/* RSI sub-pane */}
        {rsi && (
          <div style={{ flexShrink: 0, height: 100, position: "relative", borderTop: `1px solid ${bord}` }}>
            <div ref={rsiWrapRef} style={{ position: "absolute", inset: 0 }} />
            <span style={{ position: "absolute", top: 3, left: 6, zIndex: 5, fontSize: 9, color: "#a78bfa", pointerEvents: "none" }}>RSI 14</span>
          </div>
        )}
        {/* MACD sub-pane */}
        {macd && (
          <div style={{ flexShrink: 0, height: 100, position: "relative", borderTop: `1px solid ${bord}` }}>
            <div ref={macdWrapRef} style={{ position: "absolute", inset: 0 }} />
            <span style={{ position: "absolute", top: 3, left: 6, zIndex: 5, fontSize: 9, pointerEvents: "none" }}>
              <span style={{ color: "#22d3ee" }}>MACD</span><span style={{ color: "#f97316", marginLeft: 4 }}>Signal</span>
            </span>
          </div>
        )}
        {/* Stochastic sub-pane */}
        {stoch && (
          <div style={{ flexShrink: 0, height: 100, position: "relative", borderTop: `1px solid ${bord}` }}>
            <div ref={stochWrapRef} style={{ position: "absolute", inset: 0 }} />
            <span style={{ position: "absolute", top: 3, left: 6, zIndex: 5, fontSize: 9, pointerEvents: "none" }}><span style={{ color: "#22d3ee" }}>Stoch %K</span><span style={{ color: "#f97316", marginLeft: 4 }}>%D</span></span>
          </div>
        )}
        {/* ATR sub-pane */}
        {atr && (
          <div style={{ flexShrink: 0, height: 100, position: "relative", borderTop: `1px solid ${bord}` }}>
            <div ref={atrWrapRef} style={{ position: "absolute", inset: 0 }} />
            <span style={{ position: "absolute", top: 3, left: 6, zIndex: 5, fontSize: 9, color: "#eab308", pointerEvents: "none" }}>ATR 14</span>
          </div>
        )}
        {/* ADX sub-pane */}
        {adx && (
          <div style={{ flexShrink: 0, height: 100, position: "relative", borderTop: `1px solid ${bord}` }}>
            <div ref={adxWrapRef} style={{ position: "absolute", inset: 0 }} />
            <span style={{ position: "absolute", top: 3, left: 6, zIndex: 5, fontSize: 9, color: "#a78bfa", pointerEvents: "none" }}>ADX 14</span>
          </div>
        )}
        </div>
      </div>
      {/* Right-click context menu (TradingView-style) */}
      {ctxMenu && (() => {
        const close = () => setCtxMenu(null);
        const item = (label: string, icon: string, onClick: () => void, danger = false) => (
          <button onMouseDown={(e) => { e.preventDefault(); onClick(); close(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", textAlign: "left", fontSize: 12, color: danger ? "#ef5350" : (theme === "dark" ? "#e8eaed" : "#0f172a"), background: "transparent", border: 0, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <i className={"fa-solid " + icon} style={{ width: 14, opacity: 0.8, fontSize: 11 }} />{label}
          </button>
        );
        const sep = <div style={{ height: 1, margin: "4px 0", background: bord }} />;
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 130 }} onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
            <div style={{ position: "fixed", left: Math.min(ctxMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220), top: ctxMenu.y, zIndex: 131, minWidth: 200, padding: "4px 0", borderRadius: 10, background: panelBg, border: `1px solid ${bord}`, boxShadow: "0 16px 40px rgba(0,0,0,0.45)" }} onContextMenu={(e) => e.preventDefault()}>
              {item("Reset chart view", "fa-rotate-left", () => { try { chartRef.current?.timeScale().fitContent(); seriesRef.current?.priceScale().applyOptions({ autoScale: true }); } catch {} })}
              {ctxMenu.price != null && item(`Copy price ${ctxMenu.price.toFixed(digits)}`, "fa-copy", () => { try { navigator.clipboard.writeText(ctxMenu.price!.toFixed(digits)); } catch {} })}
              {sep}
              {item("Fit data", "fa-arrows-left-right-to-line", () => { try { chartRef.current?.timeScale().fitContent(); } catch {} })}
              {sep}
              {item("Regular scale", "fa-chart-line", () => { try { chartRef.current?.priceScale("right").applyOptions({ mode: 0 }); } catch {} })}
              {item("Logarithmic scale", "fa-chart-area", () => { try { chartRef.current?.priceScale("right").applyOptions({ mode: 1 }); } catch {} })}
              {item("Percent scale", "fa-percent", () => { try { chartRef.current?.priceScale("right").applyOptions({ mode: 2 }); } catch {} })}
              {sep}
              {item("Take screenshot", "fa-camera", () => { try { const cv = chartRef.current?.takeScreenshot(); if (cv) { const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = `${symRef.current}-${tfRef.current}.png`; a.click(); } } catch {} })}
              {sep}
              {item("Remove drawings", "fa-eraser", () => clearDrawings(), true)}
            </div>
          </>
        );
      })()}
    </>
  );
}

// The chart streams its own live candles via an internal socket, so the parent's
// `positions` prop is only for overlay lines. Re-render ONLY when the chart's
// inputs or a position's STRUCTURE change — NOT on every per-tick P&L update.
// This stops the heavy desk from re-rendering all open charts on each price tick.
function posSig(ps?: ChartPosition[]) {
  if (!ps || !ps.length) return "";
  return ps.map((p) => `${p.id}:${p.type}:${p.openPrice}:${p.sl ?? ""}:${p.tp ?? ""}:${p.lots ?? ""}:${p.kind ?? ""}`).join("|");
}
function areEqual(a: any, b: any) {
  return a.symbol === b.symbol && a.tf === b.tf && a.theme === b.theme && a.digits === b.digits
    && a.showTools === b.showTools && JSON.stringify(a.ind) === JSON.stringify(b.ind)
    && JSON.stringify(a.cfg) === JSON.stringify(b.cfg)
    && a.tool === b.tool && a.clearKey === b.clearKey && a.spreadPips === b.spreadPips
    && posSig(a.positions) === posSig(b.positions);
}
export default memo(LWChart, areEqual);
