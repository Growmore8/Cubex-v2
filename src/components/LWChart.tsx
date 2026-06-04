"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle } from "lightweight-charts";
import { io, Socket } from "socket.io-client";

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
    if (barsRef.current.length) { series.setData(barsRef.current); chart.timeScale().fitContent(); }
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [theme, digits]);

  // Load Twelve Data historical candles (up to 5000) on symbol / timeframe change
  useEffect(() => {
    let alive = true;
    barsRef.current = [];
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
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const ok = d && d.ok && seed(d.candles);
        // Fallback: if TD returned nothing (derived/unsupported symbol), use the
        // in-memory socket history so the chart isn't empty.
        if (!ok) { const sock: Socket = io({ path: "/socket.io" }); sock.on("history", (h: any) => { seed(h[symRef.current]); sock.disconnect(); }); setTimeout(() => sock.disconnect(), 4000); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [symbol, tf]);

  // Live updates: build the forming bar from the live price stream
  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    socket.on("tick", ({ symbol: sym, price }: any) => {
      if (sym !== symRef.current || price == null || !seriesRef.current) return;
      const sec = TF_SECONDS[tfRef.current] || 60;
      const t = Math.floor(Date.now() / 1000 / sec) * sec;
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      if (last && last.time === t) {
        last.high = Math.max(last.high, price); last.low = Math.min(last.low, price); last.close = price;
        seriesRef.current.update(last);
      } else if (!last || t > last.time) {
        const bar = { time: t, open: price, high: price, low: price, close: price };
        bars.push(bar);
        seriesRef.current.update(bar);
      }
    });
    return () => { socket.disconnect(); };
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

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
