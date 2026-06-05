"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createChart, ColorType, LineStyle } from "lightweight-charts";
import { io, Socket } from "socket.io-client";

// Simple / exponential moving average over candle closes -> line-series data.
function computeMA(bars: any[], period: number, exp: boolean) {
  if (!bars || bars.length < period) return [];
  const out: { time: any; value: number }[] = [];
  if (exp) {
    const k = 2 / (period + 1);
    let ema = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
    for (let i = period - 1; i < bars.length; i++) {
      if (i === period - 1) ema = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
      else ema = bars[i].close * k + ema * (1 - k);
      out.push({ time: bars[i].time, value: ema });
    }
  } else {
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += bars[i].close;
      if (i >= period) sum -= bars[i - period].close;
      if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
    }
  }
  return out;
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

export default function LWChart({
  symbol, tf, theme, positions, digits = 2,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  positions?: ChartPosition[];
  digits?: number;
  onClose?: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const barsRef = useRef<any[]>([]);
  const lineRefs = useRef<any[]>([]);
  const linePricesRef = useRef<number[]>([]); // entry/SL/TP/trigger prices to keep in view
  const symRef = useRef(symbol);
  const tfRef = useRef(tf);
  symRef.current = symbol; tfRef.current = tf;

  // Drawing tools + indicators
  const [tool, setTool] = useState<"none" | "hline" | "trend">("none");
  const toolRef = useRef(tool); toolRef.current = tool;
  const [sma, setSma] = useState(false);
  const [ema, setEma] = useState(false);
  const [drawN, setDrawN] = useState(0);
  const hlineRefs = useRef<any[]>([]);
  const trendRefs = useRef<any[]>([]);
  const trendStart = useRef<{ time: any; value: number } | null>(null);
  const smaRef = useRef<any>(null);
  const emaRef = useRef<any>(null);

  function clearDrawings() {
    for (const l of hlineRefs.current) { try { seriesRef.current?.removePriceLine(l); } catch {} }
    hlineRefs.current = [];
    for (const ls of trendRefs.current) { try { chartRef.current?.removeSeries(ls); } catch {} }
    trendRefs.current = [];
    trendStart.current = null; setDrawN(0); setTool("none");
  }

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
    const series = (chart as any).addCandlestickSeries({
      upColor: "#26a69a", downColor: "#e05260", borderUpColor: "#26a69a", borderDownColor: "#e05260",
      wickUpColor: "#26a69a", wickDownColor: "#e05260",
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
      autoscaleInfoProvider: (orig: any) => {
        const res = orig();
        const ps = linePricesRef.current;
        if (!res || !ps.length) return res;
        let mn = res.priceRange.minValue, mx = res.priceRange.maxValue;
        for (const p of ps) { if (isFinite(p)) { mn = Math.min(mn, p); mx = Math.max(mx, p); } }
        return { ...res, priceRange: { minValue: mn, maxValue: mx } };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    // a recreated chart loses prior drawings/indicators — drop the stale refs
    hlineRefs.current = []; trendRefs.current = []; smaRef.current = null; emaRef.current = null; trendStart.current = null;
    // Click handler for H-Line / Trend drawing tools
    chart.subscribeClick((param: any) => {
      const t = toolRef.current;
      if (t === "none" || !param.point || param.time == null || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price == null) return;
      if (t === "hline") {
        hlineRefs.current.push(seriesRef.current.createPriceLine({ price, color: "#f0b90b", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" }));
        setTool("none"); setDrawN((n) => n + 1);
      } else if (t === "trend") {
        if (!trendStart.current) { trendStart.current = { time: param.time, value: price }; }
        else {
          const pts = [trendStart.current, { time: param.time, value: price }].sort((x, y) => (x.time as number) - (y.time as number));
          const ls = (chart as any).addLineSeries({ color: "#5aa9ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          try { ls.setData(pts); } catch {}
          trendRefs.current.push(ls);
          trendStart.current = null; setTool("none"); setDrawN((n) => n + 1);
        }
      }
    });
    if (barsRef.current.length) { series.setData(barsRef.current); chart.timeScale().fitContent(); }
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [theme, digits]);

  // Indicators (SMA/EMA over closes) — add/remove + recompute on toggle or data change
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    if (sma && !smaRef.current) smaRef.current = chart.addLineSeries({ color: "#f0b90b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    if (!sma && smaRef.current) { try { chart.removeSeries(smaRef.current); } catch {} smaRef.current = null; }
    if (sma && smaRef.current) { try { smaRef.current.setData(computeMA(barsRef.current, 20, false)); } catch {} }
    if (ema && !emaRef.current) emaRef.current = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    if (!ema && emaRef.current) { try { chart.removeSeries(emaRef.current); } catch {} emaRef.current = null; }
    if (ema && emaRef.current) { try { emaRef.current.setData(computeMA(barsRef.current, 20, true)); } catch {} }
  }, [sma, ema, symbol, tf, theme, digits, drawN]);

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
      try { seriesRef.current.setData(bars); barsRef.current = bars; chartRef.current?.timeScale().fitContent(); return true; }
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

    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const ok = d && d.ok && seed(d.candles);
        // Fallback: the feed returned nothing for this symbol. Synthesize a full
        // 5000-bar history seeded from the first live price we receive.
        if (!ok) {
          const sock: Socket = io({ path: "/socket.io" });
          let done = false;
          const finish = () => { if (!done) { done = true; try { sock.disconnect(); } catch {} } };
          sock.on("tick", ({ symbol: sym, price }: any) => {
            if (done || sym !== symRef.current || !(price > 0) || barsRef.current.length) return;
            if (seed(synth(price, 5000))) finish();
          });
          // last resort: whatever live 1-min history the server already holds
          sock.on("history", (h: any) => { if (!barsRef.current.length) seed(h[symRef.current]); });
          setTimeout(finish, 5000);
        }
      })
      .catch(() => {});
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
    const lp: number[] = [];
    for (const p of positions || []) { lp.push(p.openPrice); if (p.sl) lp.push(p.sl); if (p.tp) lp.push(p.tp); }
    linePricesRef.current = lp;
    try { s.priceScale().applyOptions({ autoScale: true }); } catch {} // force rescale to include the lines
    for (const p of positions || []) {
      const col = p.type === "BUY" ? "#2f81f7" : "#e05260";
      const pending = !!p.kind;
      lineRefs.current.push(s.createPriceLine({
        price: p.openPrice, color: col, lineWidth: 2,
        lineStyle: pending ? LineStyle.Dotted : LineStyle.Solid, axisLabelVisible: true,
        title: `${p.kind ? p.kind + " " : ""}${p.type} ${p.lots}`,
      }));
      if (p.sl) lineRefs.current.push(s.createPriceLine({ price: p.sl, color: "#e05260", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "SL" }));
      if (p.tp) lineRefs.current.push(s.createPriceLine({ price: p.tp, color: "#26a69a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP" }));
    }
  }, [positions, theme, tf, symbol]);

  const tb = (active: boolean): CSSProperties => ({
    pointerEvents: "auto", cursor: "pointer", fontSize: 10, padding: "2px 7px", borderRadius: 5,
    border: "1px solid " + (active ? "#5aa9ff" : (theme === "dark" ? "#2a3142" : "#d8dee9")),
    background: active ? "#5aa9ff" : (theme === "dark" ? "rgba(20,26,38,0.85)" : "rgba(255,255,255,0.9)"),
    color: active ? "#fff" : (theme === "dark" ? "#9aa6bf" : "#475569"),
  });
  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 6, left: 6, zIndex: 5, display: "flex", gap: 4, alignItems: "center", pointerEvents: "none" }}>
        <button style={tb(tool === "hline")} onClick={() => setTool(tool === "hline" ? "none" : "hline")} title="Horizontal line — click the chart"><i className="fa-solid fa-minus" /> H-Line</button>
        <button style={tb(tool === "trend")} onClick={() => setTool(tool === "trend" ? "none" : "trend")} title="Trend line — click two points"><i className="fa-solid fa-arrow-trend-up" /> Trend</button>
        <button style={tb(sma)} onClick={() => setSma((v) => !v)} title="Simple MA (20)">SMA</button>
        <button style={tb(ema)} onClick={() => setEma((v) => !v)} title="Exponential MA (20)">EMA</button>
        {(drawN > 0 || hlineRefs.current.length > 0 || trendRefs.current.length > 0) && <button style={tb(false)} onClick={clearDrawings} title="Clear drawings"><i className="fa-solid fa-eraser" /></button>}
        {tool !== "none" && <span style={{ pointerEvents: "none", fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(90,169,255,0.85)", color: "#fff" }}>{tool === "hline" ? "Click chart to place line" : trendStart.current ? "Click second point" : "Click first point"}</span>}
      </div>
    </div>
  );
}
