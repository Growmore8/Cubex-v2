"use client";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { BUY, SELL } from "@/config/theme";
import type { ChartPosition } from "./LWChart";

// Alternative chart engine (KLineCharts, MIT) offered side-by-side with the
// classic lightweight-charts view. Reuses the SAME data sources as LWChart:
// history from /api/candles (seconds-based OHLC) + live Socket.IO "tick" stream.
// Locale is forced to en-US so nothing renders in Chinese.

const TF_SECONDS: Record<string, number> = { "1M": 60, "5M": 300, "15M": 900, "30M": 1800, "1H": 3600, "4H": 14400, "1D": 86400 };

function stylesFor(theme: "dark" | "light") {
  const text = theme === "dark" ? "#7a8699" : "#64748b";
  const grid = theme === "dark" ? "#1b2230" : "#eef2f7";
  const axis = theme === "dark" ? "#242a38" : "#e2e8f0";
  return {
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      bar: { upColor: BUY, downColor: SELL, noChangeColor: text, upBorderColor: BUY, downBorderColor: SELL, upWickColor: BUY, downWickColor: SELL },
      tooltip: { text: { color: text } },
      priceMark: { high: { color: text }, low: { color: text } },
    },
    xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text } },
    yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text } },
    crosshair: { horizontal: { text: { backgroundColor: "#5aa9ff" } }, vertical: { text: { backgroundColor: "#5aa9ff" } } },
    indicator: { tooltip: { text: { color: text } } },
    separator: { color: axis },
  };
}

export default function KLineChart({ symbol, tf, theme, digits = 2, positions, ind }: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  positions?: ChartPosition[];
  ind?: { sma?: boolean; ema?: boolean; bb?: boolean; rsi?: boolean; macd?: boolean };
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const kcRef = useRef<any>(null);
  const barsRef = useRef<any[]>([]);
  const symRef = useRef(symbol); symRef.current = symbol;
  const tfRef = useRef(tf); tfRef.current = tf;
  const overlayIds = useRef<string[]>([]);
  const mainInd = useRef<Record<string, string>>({}); // key -> indicator name on candle_pane
  const subInd = useRef<Record<string, string>>({}); // key -> sub paneId

  // init + dispose (mount only)
  useEffect(() => {
    let disposed = false;
    import("klinecharts").then((kc) => {
      if (disposed || !elRef.current) return;
      kcRef.current = kc;
      const chart = kc.init(elRef.current, { locale: "en-US" });
      if (!chart) return;
      chartRef.current = chart;
      try { chart.setStyles(stylesFor(theme)); } catch {}
      try { chart.setPriceVolumePrecision(digits, 0); } catch {}
    });
    return () => {
      disposed = true;
      try { kcRef.current?.dispose(elRef.current); } catch {}
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // theme / precision
  useEffect(() => {
    const c = chartRef.current; if (!c) return;
    try { c.setStyles(stylesFor(theme)); } catch {}
    try { c.setPriceVolumePrecision(digits, 0); } catch {}
  }, [theme, digits]);

  // history load on symbol / tf (waits for chart init)
  useEffect(() => {
    let alive = true, tries = 0;
    const go = () => {
      if (!alive) return;
      const c = chartRef.current;
      if (!c) { if (tries++ < 60) setTimeout(go, 50); return; }
      fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive || !d?.ok || !d.candles?.length) return;
          const data = d.candles.map((b: any) => ({ timestamp: b.time * 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
          barsRef.current = data;
          try { c.applyNewData(data); } catch {}
        })
        .catch(() => {});
    };
    go();
    return () => { alive = false; };
  }, [symbol, tf]);

  // live ticks → forming bar (mount only; reads current symbol/tf via refs)
  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    let pClose: number | null = null, pHi = -Infinity, pLo = Infinity;
    socket.on("tick", ({ symbol: sym, price }: any) => {
      if (sym !== symRef.current || price == null) return;
      pClose = price; if (price > pHi) pHi = price; if (price < pLo) pLo = price;
    });
    const id = setInterval(() => {
      const c = chartRef.current;
      if (pClose == null || !c) return;
      const close = pClose, hi = pHi, lo = pLo; pClose = null; pHi = -Infinity; pLo = Infinity;
      const sec = TF_SECONDS[tfRef.current] || 60;
      const t = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      let bar: any;
      if (last && last.timestamp === t) {
        last.high = Math.max(last.high, hi); last.low = Math.min(last.low, lo); last.close = close; bar = last;
      } else if (!last || t > last.timestamp) {
        bar = { timestamp: t, open: close, high: hi, low: lo, close, volume: 0 }; bars.push(bar);
      } else return;
      try { c.updateData(bar); } catch {}
    }, 200);
    return () => { clearInterval(id); try { socket.disconnect(); } catch {} };
  }, []);

  // indicators (MA/BOLL on main pane; RSI/MACD as sub-panes)
  useEffect(() => {
    const c = chartRef.current; if (!c) return;
    const wantMain: Record<string, string> = {};
    if (ind?.sma || ind?.ema) wantMain.ma = "MA";
    if (ind?.bb) wantMain.bb = "BOLL";
    const wantSub: Record<string, string> = {};
    if (ind?.rsi) wantSub.rsi = "RSI";
    if (ind?.macd) wantSub.macd = "MACD";
    // main pane
    for (const k of Object.keys(mainInd.current)) if (!wantMain[k]) { try { c.removeIndicator("candle_pane", mainInd.current[k]); } catch {} delete mainInd.current[k]; }
    for (const k of Object.keys(wantMain)) if (!mainInd.current[k]) { try { c.createIndicator(wantMain[k], true, { id: "candle_pane" }); mainInd.current[k] = wantMain[k]; } catch {} }
    // sub panes
    for (const k of Object.keys(subInd.current)) if (!wantSub[k]) { try { c.removeIndicator(subInd.current[k]); } catch {} delete subInd.current[k]; }
    for (const k of Object.keys(wantSub)) if (!subInd.current[k]) { try { const pid = c.createIndicator(wantSub[k], false); if (pid) subInd.current[k] = pid; } catch {} }
  }, [ind?.sma, ind?.ema, ind?.bb, ind?.rsi, ind?.macd]);

  // position overlays (entry / SL / TP) — colored horizontal price lines
  useEffect(() => {
    const c = chartRef.current; if (!c) return;
    for (const id of overlayIds.current) { try { c.removeOverlay(id); } catch {} }
    overlayIds.current = [];
    const add = (value: number, color: string) => {
      try {
        const id = c.createOverlay({
          name: "priceLine", points: [{ value }], lock: true,
          styles: { line: { color, style: "dashed", size: 1 }, text: { color: "#fff", backgroundColor: color } },
        });
        if (typeof id === "string") overlayIds.current.push(id);
      } catch {}
    };
    for (const p of positions || []) {
      const pending = !!p.kind;
      add(p.openPrice, pending ? "#f59e0b" : (p.type === "BUY" ? "#3b82f6" : "#ef4444"));
      if (p.sl) add(p.sl, "#f43f5e");
      if (p.tp) add(p.tp, "#10b981");
    }
  }, [positions, symbol, tf]);

  return <div ref={elRef} style={{ width: "100%", height: "100%" }} />;
}
