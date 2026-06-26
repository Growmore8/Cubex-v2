"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";

// klinecharts v10 — direct core usage (no pro wrapper).
// touch-action:none is set on the container BEFORE init() so mobile works.

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

const TF_LIST = [
  { label: "1M",  type: "minute" as const, span: 1  },
  { label: "5M",  type: "minute" as const, span: 5  },
  { label: "15M", type: "minute" as const, span: 15 },
  { label: "30M", type: "minute" as const, span: 30 },
  { label: "1H",  type: "hour"   as const, span: 1  },
  { label: "4H",  type: "hour"   as const, span: 4  },
  { label: "1D",  type: "day"    as const, span: 1  },
];
const TF_MAP: Record<string, { type: "minute"|"hour"|"day"; span: number }> = {
  "1M": { type: "minute", span: 1  }, "5M":  { type: "minute", span: 5  },
  "15M":{ type: "minute", span: 15 }, "30M": { type: "minute", span: 30 },
  "1H": { type: "hour",   span: 1  }, "4H":  { type: "hour",   span: 4  },
  "1D": { type: "day",    span: 1  },
};
const TF_SEC: Record<string, number> = {
  "1M": 60, "5M": 300, "15M": 900, "30M": 1800, "1H": 3600, "4H": 14400, "1D": 86400,
};
const TF_API: Record<string, string> = {
  "1M":"1M","5M":"5M","15M":"15M","30M":"30M","1H":"1H","4H":"4H","1D":"1D",
};

// Main-pane indicators (overlaid on candles)
const MAIN_INDS = [
  { name: "MA",   label: "MA"   },
  { name: "EMA",  label: "EMA"  },
  { name: "BOLL", label: "BOLL" },
  { name: "SAR",  label: "SAR"  },
  { name: "AVP",  label: "VWAP" },
];
// Sub-pane indicators
const SUB_INDS = [
  { name: "VOL",  label: "VOL"  },
  { name: "MACD", label: "MACD" },
  { name: "RSI",  label: "RSI"  },
  { name: "KDJ",  label: "KDJ"  },
  { name: "CCI",  label: "CCI"  },
  { name: "WR",   label: "WR"   },
  { name: "DMI",  label: "DMI"  },
  { name: "BIAS", label: "BIAS" },
  { name: "ROC",  label: "ROC"  },
  { name: "OBV",  label: "OBV"  },
];

// Drawing tools
const DRAW_TOOLS = [
  { name: "line",                    label: "Trend Line",       icon: "fa-minus",        rotate: -45 },
  { name: "horizontalStraightLine",  label: "Horizontal Line",  icon: "fa-minus",        rotate: 0   },
  { name: "verticalStraightLine",    label: "Vertical Line",    icon: "fa-grip-lines-vertical", rotate: 0 },
  { name: "rayLine",                 label: "Ray",              icon: "fa-arrow-right",  rotate: -30 },
  { name: "segment",                 label: "Segment",          icon: "fa-arrows-left-right", rotate: -30 },
  { name: "priceChannelLine",        label: "Price Channel",    icon: "fa-arrows-up-down", rotate: 0 },
  { name: "parallelStraightLine",    label: "Parallel Lines",   icon: "fa-bars",         rotate: 0   },
  { name: "fibonacciLine",           label: "Fibonacci",        icon: "fa-wave-square",  rotate: 0   },
  { name: "rect",                    label: "Rectangle",        icon: "fa-square",       rotate: 0   },
  { name: "circle",                  label: "Circle",           icon: "fa-circle",       rotate: 0   },
  { name: "text",                    label: "Text",             icon: "fa-font",         rotate: 0   },
  { name: "priceLine",               label: "Price Line",       icon: "fa-tag",          rotate: 0   },
];

function pip(digits: number) { return Math.pow(10, -(digits - 1)); }

let _kc: Promise<any> | null = null;
const loadKc = () => (_kc || (_kc = import("klinecharts")));

// Register a custom horizontal level overlay (entry / SL / TP) on first load.
let _ovReady = false;
async function ensureOverlays() {
  if (_ovReady) return;
  _ovReady = true;
  const kc = await loadKc();
  try {
    kc.registerOverlay({
      name: "cubexLevel",
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ overlay, coordinates, bounding }: any) => {
        const c = coordinates?.[0];
        if (!c || c.y == null) return [];
        const color = overlay.extendData?.color || "#888";
        const text  = overlay.extendData?.text  || "";
        return [
          { type: "line",  attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] },
            styles: { color, style: "dashed", size: 1, dashedValue: [4, 3] } },
          { type: "text",  ignoreEvent: true,
            attrs: { x: bounding.width - 6, y: c.y, text, align: "right", baseline: "middle" },
            styles: { color: "#fff", backgroundColor: color, borderColor: color, borderSize: 1,
              paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4,
              size: 11, weight: "bold" } },
        ];
      },
    });
  } catch {}
}

export default function KLineChart({
  symbol, tf, theme, digits = 5, symbols, positions, onSymbolChange, spreadPips, showToolbar = true,
}: {
  symbol: string; tf: string; theme: "dark" | "light";
  digits?: number; symbols?: Sym[];
  positions?: ChartPosition[];
  onSymbolChange?: (sym: string) => void;
  spreadPips?: number;
  showToolbar?: boolean;
}) {
  const elRef   = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const sockRef  = useRef<Socket | null>(null);
  const lastBarRef = useRef<Record<string, any>>({});
  const overlayIdsRef = useRef<string[]>([]);
  const bidAskIdsRef  = useRef<{ bid: string|null; ask: string|null }>({ bid: null, ask: null });
  const posRef   = useRef(positions);     posRef.current = positions;
  const symRef   = useRef(symbol);        symRef.current = symbol;
  const digRef   = useRef(digits);        digRef.current = digits;
  const spRef    = useRef(spreadPips??0); spRef.current  = spreadPips??0;
  const tfRef    = useRef(tf);            tfRef.current  = tf;
  const onSymRef = useRef(onSymbolChange); onSymRef.current = onSymbolChange;

  const [activeTf,   setActiveTf]   = useState(tf);
  const [activeTool, setActiveTool] = useState<string|null>(null);
  const [activeInds, setActiveInds] = useState<Set<string>>(new Set(["VOL"]));
  const [showIndPanel, setShowIndPanel] = useState(false);
  const [showDrawPanel, setShowDrawPanel] = useState(false);

  // ── init chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let disposed = false;

    ensureOverlays();

    loadKc().then((kc) => {
      if (disposed || !el) return;

      // Create an inner container with touch-action:none BEFORE init —
      // this is the key fix for mobile: browser reads touch-action at
      // the moment of first touch, so it must be set before any user interaction.
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;inset:0;touch-action:none;overflow:hidden;";
      el.appendChild(wrap);

      const dark = theme === "dark";
      const bg   = dark ? "#0a0d12" : "#f3f5f9";
      const text = dark ? "#e7ecf3" : "#0f172a";
      const grid = dark ? "#1c2330" : "#e6eaf0";
      const up   = "#16a34a", dn = "#ef4444";

      const chart = kc.init(wrap, {
        styles: {
          candle: {
            type: "candle_solid",
            bar: { upColor: up, downColor: dn, upBorderColor: up, downBorderColor: dn,
              upWickColor: up, downWickColor: dn },
            tooltip: { showType: "rect", showRule: "follow_cross",
              rect: { position: "pointer", offsetLeft: 8, offsetTop: 8, offsetRight: 8, offsetBottom: 8,
                borderRadius: 6, borderSize: 1, borderColor: grid, color: dark ? "#1c2330" : "#fff" },
              text: { size: 11, family: "system-ui", weight: "normal", color: text },
            },
          },
          indicator: { tooltip: { text: { size: 11 } } },
          xAxis: { axisLine: { color: grid }, tickText: { color: dark?"#8a93a6":"#64748b", size: 11 } },
          yAxis: { axisLine: { color: grid }, tickText: { color: dark?"#8a93a6":"#64748b", size: 11 } },
          grid: { horizontal: { color: grid, style: "dashed", size: 1 }, vertical: { show: false } },
          crosshair: { horizontal: { line: { color: dark?"#3b4a5a":"#cbd5e1", style: "dashed" },
            text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } },
            vertical:   { line: { color: dark?"#3b4a5a":"#cbd5e1", style: "dashed" },
            text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } } },
          overlay: { point: { color: "#2f81f7" }, line: { color: "#2f81f7" } },
        } as any,
        timezone: "Etc/UTC",
        locale: "en-US",
      });
      if (!chart) return;
      chartRef.current = chart;
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
      chart.setOffsetRightDistance(50);
      chart.setBarSpace(8);

      // ── DataLoader ────────────────────────────────────────────────────────
      const socks: Record<string, Socket> = {};

      chart.setDataLoader({
        getBars: async ({ type, symbol: sym, period, timestamp, callback }: any) => {
          const tfKey = TF_LIST.find(t => t.type === period.type && t.span === period.span)?.label ?? "1H";
          const apiTf = TF_API[tfKey] ?? "1H";
          const sec   = TF_SEC[tfKey] ?? 3600;
          const lbKey = sym.ticker + ":" + tfKey;

          try {
            const url = type === "forward" && timestamp
              ? `/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${apiTf}&before=${Math.floor(timestamp/1000)}`
              : `/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${apiTf}`;
            const r = await fetch(url, { cache: "no-store" }).then((x) => x.json());
            if (r?.ok && r.candles?.length) {
              const bars = r.candles.map((b: any) => ({
                timestamp: b.time * 1000, open: b.open, high: b.high, low: b.low,
                close: b.close, volume: b.volume ?? 0,
              }));
              lastBarRef.current[lbKey] = bars[bars.length - 1];
              callback(bars, { forward: bars.length >= 200, backward: false });
            } else {
              callback([], false);
            }
          } catch { callback([], false); }

          // Subscribe realtime (only on init)
          if (type === "init") {
            const old = socks[lbKey];
            if (old) old.disconnect();
            const sock = io({ path: "/socket.io" });
            socks[lbKey] = sock;
            sock.on("tick", (msg: any) => {
              if (msg.symbol !== sym.ticker) return;
              const price = msg.price; if (price == null) return;
              const real  = msg.real ?? price;
              const t     = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
              let last    = lastBarRef.current[lbKey];
              if (last && last.timestamp === t) {
                last.high = Math.max(last.high, price, real);
                last.low  = Math.min(last.low,  price, real);
                last.close = price;
              } else {
                const open = last ? last.close : price;
                last = { timestamp: t, open, high: Math.max(open, price, real),
                         low: Math.min(open, price, real), close: price, volume: 0 };
                lastBarRef.current[lbKey] = last;
              }
              chart.setDataLoader && undefined; // keep reference alive
              // use subscribeBar callback instead
            });
          }
        },
        subscribeBar: ({ symbol: sym, period, callback }: any) => {
          const tfKey = TF_LIST.find(t => t.type === period.type && t.span === period.span)?.label ?? "1H";
          const sec   = TF_SEC[tfKey] ?? 3600;
          const lbKey = sym.ticker + ":" + tfKey;
          const old = socks[lbKey];
          if (old) old.disconnect();
          const sock = io({ path: "/socket.io" });
          socks[lbKey] = sock;
          sockRef.current = sock;
          sock.on("tick", (msg: any) => {
            if (msg.symbol !== sym.ticker) return;
            const price = msg.price; if (price == null) return;
            const real  = msg.real ?? price;
            const t     = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
            let last    = lastBarRef.current[lbKey];
            if (last && last.timestamp === t) {
              last.high  = Math.max(last.high,  price, real);
              last.low   = Math.min(last.low,   price, real);
              last.close = price;
            } else {
              const open = last ? last.close : price;
              last = { timestamp: t, open, high: Math.max(open, price, real),
                       low: Math.min(open, price, real), close: price, volume: 0 };
              lastBarRef.current[lbKey] = last;
            }
            callback({ ...last });
          });
        },
        unsubscribeBar: ({ symbol: sym, period }: any) => {
          const tfKey = TF_LIST.find(t => t.type === period.type && t.span === period.span)?.label ?? "1H";
          const lbKey = sym.ticker + ":" + tfKey;
          socks[lbKey]?.disconnect();
          delete socks[lbKey];
        },
      });

      // Load initial data
      const period = TF_MAP[tf] ?? { type: "hour", span: 1 };
      chart.setSymbol({ ticker: symbol, pricePrecision: digits, volumePrecision: 0 });
      chart.setPeriod(period);

      // Apply initial indicators
      chart.createIndicator("VOL", { paneOptions: { height: 60 } });

      return () => {
        Object.values(socks).forEach((s) => { try { s.disconnect(); } catch {} });
      };
    });

    return () => {
      disposed = true;
      try { chartRef.current && loadKc().then((kc) => { try { kc.dispose(elRef.current?.querySelector("div") as any); } catch {} }); } catch {}
      chartRef.current = null;
      sockRef.current?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── theme change ─────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dark = theme === "dark";
    const text = dark ? "#e7ecf3" : "#0f172a";
    const grid = dark ? "#1c2330" : "#e6eaf0";
    try {
      chart.setStyles({
        candle: {
          bar: { upColor: "#16a34a", downColor: "#ef4444", upBorderColor: "#16a34a", downBorderColor: "#ef4444", upWickColor: "#16a34a", downWickColor: "#ef4444" },
          tooltip: { rect: { borderColor: grid, color: dark ? "#1c2330" : "#fff" }, text: { color: text } },
        },
        xAxis: { axisLine: { color: grid }, tickText: { color: dark?"#8a93a6":"#64748b" } },
        yAxis: { axisLine: { color: grid }, tickText: { color: dark?"#8a93a6":"#64748b" } },
        grid:  { horizontal: { color: grid }, vertical: { show: false } },
        crosshair: {
          horizontal: { line: { color: dark?"#3b4a5a":"#cbd5e1" }, text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } },
          vertical:   { line: { color: dark?"#3b4a5a":"#cbd5e1" }, text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } },
        },
      } as any);
    } catch {}
  }, [theme]);

  // ── symbol change ─────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      chart.setSymbol({ ticker: symbol, pricePrecision: digits, volumePrecision: 0 });
      onSymRef.current?.(symbol);
    } catch {}
  }, [symbol, digits]);

  // ── timeframe change ──────────────────────────────────────────────────────
  const changeTf = useCallback((newTf: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    setActiveTf(newTf);
    tfRef.current = newTf;
    const period = TF_MAP[newTf] ?? { type: "hour", span: 1 };
    try { chart.setPeriod(period); } catch {}
  }, []);

  // ── indicator toggle ──────────────────────────────────────────────────────
  const toggleIndicator = useCallback((name: string, isMain: boolean) => {
    const chart = chartRef.current;
    if (!chart) return;
    setActiveInds((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        try { chart.removeIndicator({ name }); } catch {}
      } else {
        next.add(name);
        try {
          if (isMain) {
            chart.createIndicator(name, { paneOptions: { id: "candle_pane" } });
          } else {
            chart.createIndicator(name, { paneOptions: { height: 80 } });
          }
        } catch {}
      }
      return next;
    });
  }, []);

  // ── drawing tool ──────────────────────────────────────────────────────────
  const pickTool = useCallback((name: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    setActiveTool((prev) => {
      if (prev === name) {
        try { chart.removeOverlay({ groupId: "drawing" }); } catch {}
        return null;
      }
      try { chart.createOverlay({ name, groupId: "drawing", lock: false }); } catch {}
      return name;
    });
    setShowDrawPanel(false);
  }, []);

  const clearDrawings = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try { chart.removeOverlay({}); } catch {}
    setActiveTool(null);
  }, []);

  // ── trade + bid/ask overlays ──────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let cancelled = false;

    const draw = () => {
      if (cancelled || !chartRef.current) return;
      const c = chart;

      // Remove old trade overlays
      for (const id of overlayIdsRef.current) { try { c.removeOverlay({ id }); } catch {} }
      overlayIdsRef.current = [];
      try { c.removeOverlay({ id: bidAskIdsRef.current.bid ?? "" }); } catch {}
      try { c.removeOverlay({ id: bidAskIdsRef.current.ask ?? "" }); } catch {}
      bidAskIdsRef.current = { bid: null, ask: null };

      const pos = posRef.current ?? [];
      const dg  = digRef.current;
      const sp  = spRef.current;
      const p   = pip(dg);

      const mk = (price: number, color: string, text: string) => {
        try {
          const id = c.createOverlay({
            name: "cubexLevel", lock: true, needDefaultPointFigure: false,
            needDefaultYAxisFigure: true,
            points: [{ timestamp: Date.now(), value: price }],
            extendData: { color, text },
          } as any) as string;
          if (typeof id === "string") overlayIdsRef.current.push(id);
        } catch {}
      };

      for (const o of pos) {
        if (o.kind) {
          // Pending order
          mk(o.openPrice, "#a78bfa", `${o.type} ${Number(o.lots).toFixed(2)}L @ ${o.openPrice.toFixed(dg)}`);
        } else {
          const col = o.type === "BUY" ? "#16a34a" : "#ef4444";
          mk(o.openPrice, col, `${o.type} ${Number(o.lots).toFixed(2)}L @ ${o.openPrice.toFixed(dg)}`);
          if (o.sl) mk(o.sl, "#ef4444", `SL ${o.sl.toFixed(dg)}`);
          if (o.tp) mk(o.tp, "#16a34a", `TP ${o.tp.toFixed(dg)}`);
        }
      }

      // Bid/ask lines
      const priceData = lastBarRef.current;
      const latestKey = Object.keys(priceData).find(k => k.startsWith(symRef.current + ":"));
      const ask = latestKey ? priceData[latestKey]?.close : null;
      if (ask != null && sp > 0) {
        const bid = Math.max(0, ask - sp * p);
        try {
          const askId = c.createOverlay({ name: "priceLine", lock: true,
            points: [{ timestamp: Date.now(), value: ask }],
            styles: { line: { color: "#2f81f7", size: 1 } }, extendData: { text: `ASK ${ask.toFixed(dg)}` } } as any) as string;
          const bidId = c.createOverlay({ name: "priceLine", lock: true,
            points: [{ timestamp: Date.now(), value: bid }],
            styles: { line: { color: "#ef4444", size: 1 } }, extendData: { text: `BID ${bid.toFixed(dg)}` } } as any) as string;
          bidAskIdsRef.current = {
            bid: typeof bidId === "string" ? bidId : null,
            ask: typeof askId === "string" ? askId : null,
          };
        } catch {}
      }
    };

    // Wait a tick for chart to be ready
    const t = setTimeout(draw, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [positions, spreadPips]);

  // ── resize on container change ────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { try { chartRef.current?.resize(); } catch {} });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dark = theme === "dark";
  const BDR  = dark ? "#1c2330" : "#e6eaf0";
  const BG   = dark ? "#11151d" : "#ffffff";
  const TXT  = dark ? "#e7ecf3" : "#0f172a";
  const MUT  = dark ? "#8a93a6" : "#64748b";
  const SOFT = dark ? "#151b25" : "#f3f5f9";
  const BLUE = "#2f81f7";

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: dark?"#0a0d12":"#f3f5f9", overflow: "hidden" }}>

      {showToolbar && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${BDR}`, background: BG, padding: "4px 8px", flexShrink: 0, flexWrap: "wrap" }}>

          {/* Timeframe buttons */}
          <div style={{ display: "flex", gap: 2 }}>
            {TF_LIST.map((t) => (
              <button key={t.label} onClick={() => changeTf(t.label)}
                style={{ padding: "3px 7px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                  background: activeTf === t.label ? BLUE : "transparent",
                  color: activeTf === t.label ? "#fff" : MUT }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 18, background: BDR, margin: "0 4px" }} />

          {/* Indicators dropdown */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setShowIndPanel(p => !p); setShowDrawPanel(false); }}
              style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${showIndPanel ? BLUE : BDR}`, background: showIndPanel ? "rgba(47,129,247,0.12)" : "transparent",
                color: showIndPanel ? BLUE : TXT, display: "flex", alignItems: "center", gap: 5 }}>
              <i className="fa-solid fa-chart-area" style={{ fontSize: 10 }} />Indicators
              <i className="fa-solid fa-chevron-down" style={{ fontSize: 8, opacity: 0.6 }} />
            </button>
            {showIndPanel && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowIndPanel(false)} />
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100, background: BG,
                  border: `1px solid ${BDR}`, borderRadius: 8, padding: 8, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: 1, padding: "2px 6px 6px" }}>Main Pane</div>
                  {MAIN_INDS.map((ind) => (
                    <button key={ind.name} onClick={() => toggleIndicator(ind.name, true)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                        borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                        background: activeInds.has(ind.name) ? "rgba(47,129,247,0.12)" : "transparent",
                        color: activeInds.has(ind.name) ? BLUE : TXT }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${activeInds.has(ind.name) ? BLUE : BDR}`,
                        background: activeInds.has(ind.name) ? BLUE : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {activeInds.has(ind.name) && <i className="fa-solid fa-check" style={{ fontSize: 7, color: "#fff" }} />}
                      </span>
                      {ind.label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: BDR, margin: "6px 0" }} />
                  <div style={{ fontSize: 9, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: 1, padding: "2px 6px 6px" }}>Sub Panes</div>
                  {SUB_INDS.map((ind) => (
                    <button key={ind.name} onClick={() => toggleIndicator(ind.name, false)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                        borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                        background: activeInds.has(ind.name) ? "rgba(47,129,247,0.12)" : "transparent",
                        color: activeInds.has(ind.name) ? BLUE : TXT }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${activeInds.has(ind.name) ? BLUE : BDR}`,
                        background: activeInds.has(ind.name) ? BLUE : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {activeInds.has(ind.name) && <i className="fa-solid fa-check" style={{ fontSize: 7, color: "#fff" }} />}
                      </span>
                      {ind.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Drawing tools dropdown */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setShowDrawPanel(p => !p); setShowIndPanel(false); }}
              style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${(showDrawPanel || activeTool) ? BLUE : BDR}`,
                background: (showDrawPanel || activeTool) ? "rgba(47,129,247,0.12)" : "transparent",
                color: (showDrawPanel || activeTool) ? BLUE : TXT,
                display: "flex", alignItems: "center", gap: 5 }}>
              <i className="fa-solid fa-pencil" style={{ fontSize: 10 }} />Draw
              {activeTool && <span style={{ fontSize: 9, background: BLUE, color: "#fff", borderRadius: 3, padding: "1px 4px" }}>
                {DRAW_TOOLS.find(t => t.name === activeTool)?.label ?? activeTool}
              </span>}
              <i className="fa-solid fa-chevron-down" style={{ fontSize: 8, opacity: 0.6 }} />
            </button>
            {showDrawPanel && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowDrawPanel(false)} />
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100, background: BG,
                  border: `1px solid ${BDR}`, borderRadius: 8, padding: 8, minWidth: 190, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {DRAW_TOOLS.map((tool) => (
                    <button key={tool.name} onClick={() => pickTool(tool.name)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                        borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12,
                        background: activeTool === tool.name ? "rgba(47,129,247,0.12)" : "transparent",
                        color: activeTool === tool.name ? BLUE : TXT }}>
                      <i className={`fa-solid ${tool.icon}`} style={{ fontSize: 11, width: 14, textAlign: "center",
                        transform: tool.rotate ? `rotate(${tool.rotate}deg)` : undefined }} />
                      {tool.label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: BDR, margin: "4px 0" }} />
                  <button onClick={clearDrawings}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                      borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, color: "#ef4444", background: "transparent" }}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 11, width: 14, textAlign: "center" }} />Clear All
                  </button>
                </div>
              </>
            )}
          </div>

          <div style={{ width: 1, height: 18, background: BDR, margin: "0 4px" }} />

          {/* Screenshot */}
          <button title="Screenshot" onClick={() => {
            try {
              const url = chartRef.current?.getConvertPictureUrl?.(true, "png", dark?"#0a0d12":"#f3f5f9");
              if (url) { const a = document.createElement("a"); a.href = url; a.download = `chart-${symbol}.png`; a.click(); }
            } catch {}
          }}
            style={{ padding: "3px 7px", borderRadius: 5, fontSize: 11, border: `1px solid ${BDR}`,
              background: "transparent", color: MUT, cursor: "pointer" }}>
            <i className="fa-solid fa-camera" style={{ fontSize: 10 }} />
          </button>

          {/* Reset zoom */}
          <button title="Reset view" onClick={() => { try { chartRef.current?.scrollToRealTime?.(200); } catch {} }}
            style={{ padding: "3px 7px", borderRadius: 5, fontSize: 11, border: `1px solid ${BDR}`,
              background: "transparent", color: MUT, cursor: "pointer" }}>
            <i className="fa-solid fa-rotate-left" style={{ fontSize: 10 }} />
          </button>
        </div>
      )}

      {/* Chart container — touch-action:none set on inner div at init */}
      <div ref={elRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }} />
    </div>
  );
}
