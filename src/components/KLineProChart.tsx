"use client";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";
import "@klinecharts/pro/dist/klinecharts-pro.css";

// Full KLineChart Pro widget (MIT) — the packaged pro UI from the reference:
// left drawing-tools rail, indicator manager, time zone, settings, screenshot,
// full screen, VOL + MACD sub-panes. Driven by a Datafeed adapter wired to our
// own /api/candles history + Socket.IO "tick" stream. Locale forced to en-US.

type Sym = { symbol: string; category?: string };

const PERIODS = [
  { multiplier: 1, timespan: "minute", text: "1m" },
  { multiplier: 5, timespan: "minute", text: "5m" },
  { multiplier: 15, timespan: "minute", text: "15m" },
  { multiplier: 1, timespan: "hour", text: "1H" },
  { multiplier: 4, timespan: "hour", text: "4H" },
  { multiplier: 1, timespan: "day", text: "1D" },
];
const periodTf = (p: any) => p.timespan === "minute" ? (p.multiplier === 1 ? "1M" : p.multiplier === 5 ? "5M" : "15M") : p.timespan === "hour" ? (p.multiplier === 4 ? "4H" : "1H") : "1D";
const periodSec = (p: any) => (p.timespan === "minute" ? 60 : p.timespan === "hour" ? 3600 : 86400) * p.multiplier;
const tfToPeriod = (tf: string) => PERIODS.find((p) => p.text.toUpperCase() === String(tf).toUpperCase()) || PERIODS[2];

// Register a custom full-width horizontal level overlay (entry / SL / TP /
// pending) once — draws a coloured dashed line + a label tag, independent of
// the x-axis so it always spans the chart. Memoised so it runs a single time.
let _ovReg: Promise<void> | null = null;
function ensureLevelOverlay() {
  if (!_ovReg) _ovReg = import("klinecharts").then((kc: any) => {
    try {
      kc.registerOverlay({
        name: "cubexLevel",
        totalStep: 2, // 1 point + finish step — required for the overlay to reach "drawn" state
        needDefaultPointFigure: false,
        needDefaultXAxisFigure: false,
        needDefaultYAxisFigure: true,
        createPointFigures: ({ overlay, coordinates, bounding }: any) => {
          const c = coordinates && coordinates[0];
          if (!c || c.y == null) return [];
          const color = overlay.extendData?.color || "#888";
          const text = overlay.extendData?.text || "";
          return [
            { type: "line", attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] }, styles: { color, style: "dashed", size: 1 } },
            { type: "text", ignoreEvent: true, attrs: { x: 4, y: c.y, text, align: "left", baseline: "middle" }, styles: { color: "#fff", backgroundColor: color, paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1, borderRadius: 2, size: 10 } },
          ];
        },
      });
    } catch {}
  });
  return _ovReg;
}

export default function KLineProChart({ symbol, tf, theme, digits = 2, symbols, positions }: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  symbols?: Sym[];
  positions?: ChartPosition[];
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const proRef = useRef<any>(null);
  const dfRef = useRef<any>(null);
  const overlayIds = useRef<string[]>([]);

  // build once
  useEffect(() => {
    let disposed = false;
    const list = symbols && symbols.length ? symbols : [{ symbol }];
    const subs: Record<string, Socket> = {};
    const lastBar: Record<string, any> = {};

    // Datafeed: history from /api/candles, realtime from Socket.IO ticks.
    const datafeed = {
      searchSymbols: async (search?: string) => {
        const q = (search || "").toUpperCase();
        return list.filter((s) => !q || s.symbol.toUpperCase().includes(q))
          .map((s) => ({ ticker: s.symbol, name: s.symbol, shortName: s.symbol, exchange: s.category || "CubeX", market: "forex", pricePrecision: digits, volumePrecision: 0, priceCurrency: "USD", type: "forex" }));
      },
      getHistoryKLineData: async (sym: any, period: any, from: number, to: number) => {
        try {
          const r = await fetch(`/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${periodTf(period)}`, { cache: "no-store" }).then((x) => x.json());
          if (!r?.ok || !r.candles?.length) return [];
          const data = r.candles.map((b: any) => ({ timestamp: b.time * 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
          lastBar[sym.ticker + "_" + period.text] = data[data.length - 1];
          // honour the requested window so Pro's left-scroll paging terminates cleanly
          return data.filter((d: any) => d.timestamp >= from && d.timestamp <= to);
        } catch { return []; }
      },
      subscribe: (sym: any, period: any, callback: (d: any) => void) => {
        const key = sym.ticker + "_" + period.text;
        const sec = periodSec(period);
        const seed = lastBar[key];
        let last: any = seed && typeof seed.timestamp === "number" ? { ...seed } : null;
        const sock: Socket = io({ path: "/socket.io" });
        sock.on("tick", ({ symbol: tk, price }: any) => {
          if (tk !== sym.ticker || price == null) return;
          const t = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
          if (last && last.timestamp === t) { last.high = Math.max(last.high, price); last.low = Math.min(last.low, price); last.close = price; }
          else { last = { timestamp: t, open: price, high: price, low: price, close: price, volume: 0 }; }
          callback({ ...last });
        });
        subs[key] = sock;
      },
      unsubscribe: (sym: any, period: any) => {
        const key = sym.ticker + "_" + period.text;
        try { subs[key]?.disconnect(); } catch {}
        delete subs[key];
      },
    };
    dfRef.current = { subs };

    import("@klinecharts/pro").then(({ KLineChartPro }) => {
      if (disposed || !elRef.current) return;
      const first = list.find((s) => s.symbol === symbol) || list[0];
      proRef.current = new KLineChartPro({
        container: elRef.current,
        locale: "en-US",
        theme,
        symbol: { ticker: first.symbol, name: first.symbol, shortName: first.symbol, pricePrecision: digits, volumePrecision: 0, priceCurrency: "USD", type: "forex" },
        period: tfToPeriod(tf),
        periods: PERIODS,
        mainIndicators: [], // start clean — user adds indicators via the Indicator menu
        subIndicators: [],
        datafeed: datafeed as any,
      });
    });

    return () => {
      disposed = true;
      for (const k of Object.keys(subs)) { try { subs[k].disconnect(); } catch {} }
      try { if (elRef.current) elRef.current.innerHTML = ""; } catch {}
      proRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // theme sync (no rebuild)
  useEffect(() => { try { proRef.current?.setTheme(theme); } catch {} }, [theme]);
  // follow the app's symbol selection
  useEffect(() => { try { if (proRef.current && symbol) proRef.current.setSymbol({ ticker: symbol, name: symbol, shortName: symbol, pricePrecision: digits, volumePrecision: 0, priceCurrency: "USD", type: "forex" }); } catch {} }, [symbol, digits]);

  // Trade overlays (entry / SL / TP) drawn on Pro's underlying core chart
  // instance (`_chartApi`) — keeps the full Pro UI but still shows live positions.
  useEffect(() => {
    let tries = 0, cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const core = proRef.current?._chartApi;
      if (!core || typeof core.createOverlay !== "function") { if (tries++ < 80) setTimeout(draw, 120); return; }
      for (const id of overlayIds.current) { try { core.removeOverlay(id); } catch {} }
      overlayIds.current = [];
      // anchor to the latest bar's timestamp so klinecharts always resolves a
      // coordinate (a value-only point can be skipped on some builds)
      let ts: number | undefined;
      try { const dl = core.getDataList?.() || []; if (dl.length) ts = dl[dl.length - 1].timestamp; } catch {}
      const add = (value: number, color: string, text: string) => {
        try {
          const id = core.createOverlay({ name: "cubexLevel", points: [{ timestamp: ts, value }], lock: true, extendData: { color, text } });
          if (typeof id === "string") overlayIds.current.push(id);
        } catch {}
      };
      for (const p of positions || []) {
        const pending = !!p.kind;
        const side = p.type === "BUY" ? "BUY" : "SELL";
        add(p.openPrice, pending ? "#f59e0b" : (p.type === "BUY" ? "#3b82f6" : "#ef4444"), `${pending ? (p.kind + " ") : ""}${side} ${p.openPrice}`);
        if (p.sl) add(p.sl, "#f43f5e", `SL ${p.sl}`);
        if (p.tp) add(p.tp, "#10b981", `TP ${p.tp}`);
      }
    };
    ensureLevelOverlay().then(draw);
    return () => { cancelled = true; };
  }, [positions, symbol]);

  // Absolutely fill the (relative) parent so the widget always matches the
  // container box and shrinks/grows when panels are dragged — core klinecharts
  // has its own ResizeObserver, so it re-renders once the box changes.
  return <div ref={elRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
