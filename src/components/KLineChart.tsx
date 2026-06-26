"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";

// klinecharts v10 — direct core usage (no pro wrapper).
// touch-action:none is set on the container BEFORE init() so mobile works.

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

const TF_LIST = [
  { label: "1m",  type: "minute" as const, span: 1   },
  { label: "5m",  type: "minute" as const, span: 5   },
  { label: "15m", type: "minute" as const, span: 15  },
  { label: "30m", type: "minute" as const, span: 30  },
  { label: "1H",  type: "hour"   as const, span: 1   },
  { label: "2H",  type: "hour"   as const, span: 2   },
  { label: "4H",  type: "hour"   as const, span: 4   },
  { label: "D",   type: "day"    as const, span: 1   },
  { label: "W",   type: "day"    as const, span: 7   },
];
const TF_MAP: Record<string, { type: "minute"|"hour"|"day"; span: number }> = {
  "1m":  { type: "minute", span: 1  }, "5m":  { type: "minute", span: 5  },
  "15m": { type: "minute", span: 15 }, "30m": { type: "minute", span: 30 },
  "1H":  { type: "hour",   span: 1  }, "2H":  { type: "hour",   span: 2  },
  "4H":  { type: "hour",   span: 4  },
  "D":   { type: "day",    span: 1  }, "W":   { type: "day",    span: 7  },
};
const TF_SEC: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1H": 3600, "2H": 7200, "4H": 14400, "D": 86400, "W": 604800,
};
// Map display labels → API timeframe strings
const TF_API: Record<string, string> = {
  "1m":"1M","5m":"5M","15m":"15M","30m":"30M","1H":"1H","2H":"2H","4H":"4H","D":"1D","W":"1W",
};

// Main-pane indicators
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

// Left sidebar drawing tools (vertical panel, TradingView-style)
const DRAW_TOOLS = [
  { name: "line",                   label: "Trend Line",      svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="17" x2="17" y2="3"/></svg> },
  { name: "horizontalStraightLine", label: "Horizontal Line", svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="2" y1="10" x2="18" y2="10"/></svg> },
  { name: "verticalStraightLine",   label: "Vertical Line",   svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="10" y1="2" x2="10" y2="18"/></svg> },
  { name: "rayLine",                label: "Ray",             svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="10" x2="17" y2="10"/><polyline points="13,6 17,10 13,14"/></svg> },
  { name: "segment",                label: "Segment",         svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="4" y1="16" x2="16" y2="4"/><circle cx="4" cy="16" r="1.5" fill="currentColor"/><circle cx="16" cy="4" r="1.5" fill="currentColor"/></svg> },
  { name: "priceChannelLine",       label: "Price Channel",   svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="6" x2="17" y2="6"/><line x1="3" y1="14" x2="17" y2="14"/></svg> },
  { name: "parallelStraightLine",   label: "Parallel Lines",  svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg> },
  { name: "fibonacciLine",          label: "Fibonacci",       svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="4" x2="17" y2="4"/><line x1="3" y1="9" x2="17" y2="9"/><line x1="3" y1="13" x2="17" y2="13"/><line x1="3" y1="16" x2="17" y2="16"/></svg> },
  { name: "rect",                   label: "Rectangle",       svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="14" height="10" rx="1"/></svg> },
  { name: "circle",                 label: "Circle",          svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10" cy="10" r="7"/></svg> },
  { name: "text",                   label: "Text",            svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><text x="4" y="15" fontSize="13" fontWeight="700" stroke="currentColor" strokeWidth="0.5" fill="currentColor">T</text></svg> },
  { name: "priceLine",              label: "Price Line",      svg: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="2" y1="10" x2="14" y2="10"/><rect x="14" y="7" width="5" height="6" rx="1"/></svg> },
];

function pip(digits: number) { return Math.pow(10, -(digits - 1)); }

let _kc: Promise<any> | null = null;
const loadKc = () => (_kc || (_kc = import("klinecharts")));

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
          { type: "line", attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] },
            styles: { color, style: "dashed", size: 1, dashedValue: [4, 3] } },
          { type: "text", ignoreEvent: true,
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
  const elRef      = useRef<HTMLDivElement>(null);
  const chartRef   = useRef<any>(null);
  const sockRef    = useRef<Socket | null>(null);
  const lastBarRef = useRef<Record<string, any>>({});
  const overlayIdsRef = useRef<string[]>([]);
  const bidAskIdsRef  = useRef<{ bid: string|null; ask: string|null }>({ bid: null, ask: null });
  const posRef   = useRef(positions);      posRef.current   = positions;
  const symRef   = useRef(symbol);         symRef.current   = symbol;
  const digRef   = useRef(digits);         digRef.current   = digits;
  const spRef    = useRef(spreadPips??0);  spRef.current    = spreadPips??0;
  const tfRef    = useRef(tf);             tfRef.current    = tf;
  const onSymRef = useRef(onSymbolChange); onSymRef.current = onSymbolChange;

  // Normalise incoming tf prop (from parent using old names like "1M") to display label
  const normTf = (raw: string) => {
    if (raw === "1M") return "1m"; if (raw === "5M") return "5m";
    if (raw === "15M") return "15m"; if (raw === "30M") return "30m";
    if (raw === "1D") return "D"; if (raw === "1W") return "W";
    return raw;
  };

  const [activeTf,      setActiveTf]      = useState(() => normTf(tf));
  const [activeTool,    setActiveTool]    = useState<string|null>(null);
  const [activeInds,    setActiveInds]    = useState<Set<string>>(new Set());
  const [showIndPanel,  setShowIndPanel]  = useState(false);
  const [showSetupPanel,setShowSetupPanel]= useState(false);

  // ── init chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let disposed = false;

    ensureOverlays();

    loadKc().then((kc) => {
      if (disposed || !el) return;

      // touch-action:none BEFORE init — the mobile fix
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;inset:0;touch-action:none;overflow:hidden;";
      el.appendChild(wrap);

      const dark = theme === "dark";
      const text = dark ? "#e7ecf3" : "#0f172a";
      const grid = dark ? "#1c2330" : "#e6eaf0";
      const up = "#16a34a", dn = "#ef4444";

      const chart = kc.init(wrap, {
        styles: {
          candle: {
            type: "candle_solid",
            bar: { upColor: up, downColor: dn, upBorderColor: up, downBorderColor: dn, upWickColor: up, downWickColor: dn },
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
          crosshair: {
            horizontal: { line: { color: dark?"#3b4a5a":"#cbd5e1", style: "dashed" }, text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } },
            vertical:   { line: { color: dark?"#3b4a5a":"#cbd5e1", style: "dashed" }, text: { color: text, backgroundColor: dark?"#1c2330":"#e2e8f0", borderColor: grid } },
          },
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

      // ── DataLoader ───────────────────────────────────────────────────────
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
            const r = await fetch(url, { cache: "no-store" }).then(x => x.json());
            if (r?.ok && r.candles?.length) {
              const bars = r.candles.map((b: any) => ({ timestamp: b.time*1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume??0 }));
              lastBarRef.current[lbKey] = bars[bars.length - 1];
              callback(bars, { forward: bars.length >= 200, backward: false });
            } else { callback([], false); }
          } catch { callback([], false); }
          void sec; // used in subscribeBar
        },
        subscribeBar: ({ symbol: sym, period, callback }: any) => {
          const tfKey = TF_LIST.find(t => t.type === period.type && t.span === period.span)?.label ?? "1H";
          const sec   = TF_SEC[tfKey] ?? 3600;
          const lbKey = sym.ticker + ":" + tfKey;
          socks[lbKey]?.disconnect();
          const sock = io({ path: "/socket.io" });
          socks[lbKey] = sock;
          sockRef.current = sock;
          sock.on("tick", (msg: any) => {
            if (msg.symbol !== sym.ticker) return;
            const price = msg.price; if (price == null) return;
            const real = msg.real ?? price;
            const t = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
            let last = lastBarRef.current[lbKey];
            if (last && last.timestamp === t) {
              last.high = Math.max(last.high, price, real);
              last.low  = Math.min(last.low,  price, real);
              last.close = price;
            } else {
              const open = last ? last.close : price;
              last = { timestamp: t, open, high: Math.max(open, price, real), low: Math.min(open, price, real), close: price, volume: 0 };
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

      const initTf = normTf(tf);
      const period = TF_MAP[initTf] ?? { type: "hour", span: 1 };
      chart.setSymbol({ ticker: symbol, pricePrecision: digits, volumePrecision: 0 });
      chart.setPeriod(period);

      return () => { Object.values(socks).forEach(s => { try { s.disconnect(); } catch {} }); };
    });

    return () => {
      disposed = true;
      try { chartRef.current && loadKc().then(kc => { try { kc.dispose(elRef.current?.querySelector("div") as any); } catch {} }); } catch {}
      chartRef.current = null;
      sockRef.current?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── theme ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    const dark = theme === "dark";
    const text = dark ? "#e7ecf3" : "#0f172a";
    const grid = dark ? "#1c2330" : "#e6eaf0";
    try {
      chart.setStyles({
        candle: { bar: { upColor: "#16a34a", downColor: "#ef4444", upBorderColor: "#16a34a", downBorderColor: "#ef4444", upWickColor: "#16a34a", downWickColor: "#ef4444" },
          tooltip: { rect: { borderColor: grid, color: dark?"#1c2330":"#fff" }, text: { color: text } } },
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

  // ── symbol change ────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    try { chart.setSymbol({ ticker: symbol, pricePrecision: digits, volumePrecision: 0 }); } catch {}
  }, [symbol, digits]);

  // ── timeframe change ─────────────────────────────────────────────────────
  const changeTf = useCallback((label: string) => {
    const chart = chartRef.current; if (!chart) return;
    setActiveTf(label);
    tfRef.current = label;
    const period = TF_MAP[label] ?? { type: "hour", span: 1 };
    try { chart.setPeriod(period); } catch {}
  }, []);

  // ── indicator toggle ─────────────────────────────────────────────────────
  const toggleInd = useCallback((name: string, isMain: boolean) => {
    const chart = chartRef.current; if (!chart) return;
    setActiveInds(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        try { chart.removeIndicator({ name }); } catch {}
      } else {
        next.add(name);
        try {
          if (isMain) chart.createIndicator(name, { paneOptions: { id: "candle_pane" } });
          else         chart.createIndicator(name, { paneOptions: { height: 80 } });
        } catch {}
      }
      return next;
    });
  }, []);

  // ── drawing tool ─────────────────────────────────────────────────────────
  // Each click starts ONE new drawing. klinecharts auto-fires "overlay_create_end"
  // after the final point — we re-enter drawing mode so the user can draw multiple.
  const drawingRef = useRef(false);
  const activeToolRef = useRef<string|null>(null); activeToolRef.current = activeTool;

  const pickTool = useCallback((name: string) => {
    const chart = chartRef.current; if (!chart) return;
    if (activeToolRef.current === name && drawingRef.current) return; // already drawing
    setActiveTool(name);
    drawingRef.current = true;
    // No groupId — each overlay is independent so delete-one works
    try { chart.createOverlay({ name, lock: false }); } catch {}
    // Re-enter drawing mode after each completed overlay
    const onDone = () => {
      if (activeToolRef.current !== name) return;
      drawingRef.current = true;
      try { chart.createOverlay({ name, lock: false }); } catch {}
    };
    try { chart.subscribeAction?.("onOverlayDrawEnd", onDone); } catch {}
  }, []);

  const stopTool = useCallback(() => {
    setActiveTool(null);
    drawingRef.current = false;
    // Remove any in-progress (unfinished) overlay by removing last created overlay
    try { chartRef.current?.removeOverlay({}); } catch {}
    // Actually only remove the in-progress one; complete ones stay
    // klinecharts removes the incomplete overlay automatically when mode exits
  }, []);

  const clearDrawings = useCallback(() => {
    const chart = chartRef.current; if (!chart) return;
    // Remove all overlays that are not trade/price lines (name != cubexLevel, priceLine)
    try { chart.removeOverlay({ name: "line" }); } catch {}
    try { chart.removeOverlay({ name: "horizontalStraightLine" }); } catch {}
    try { chart.removeOverlay({ name: "verticalStraightLine" }); } catch {}
    try { chart.removeOverlay({ name: "rayLine" }); } catch {}
    try { chart.removeOverlay({ name: "segment" }); } catch {}
    try { chart.removeOverlay({ name: "priceChannelLine" }); } catch {}
    try { chart.removeOverlay({ name: "parallelStraightLine" }); } catch {}
    try { chart.removeOverlay({ name: "fibonacciLine" }); } catch {}
    try { chart.removeOverlay({ name: "rect" }); } catch {}
    try { chart.removeOverlay({ name: "circle" }); } catch {}
    try { chart.removeOverlay({ name: "text" }); } catch {}
    setActiveTool(null);
    drawingRef.current = false;
  }, []);

  // ── trade overlays ───────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      for (const id of overlayIdsRef.current) { try { chart.removeOverlay({ id }); } catch {} }
      overlayIdsRef.current = [];
      try { chart.removeOverlay({ id: bidAskIdsRef.current.bid ?? "" }); } catch {}
      try { chart.removeOverlay({ id: bidAskIdsRef.current.ask ?? "" }); } catch {}
      bidAskIdsRef.current = { bid: null, ask: null };

      const pos = posRef.current ?? [];
      const dg = digRef.current;
      const sp = spRef.current;
      const p  = pip(dg);

      const mk = (price: number, color: string, text: string) => {
        try {
          const id = chart.createOverlay({ name: "cubexLevel", lock: true, needDefaultPointFigure: false,
            needDefaultYAxisFigure: true, points: [{ timestamp: Date.now(), value: price }],
            extendData: { color, text } } as any) as string;
          if (typeof id === "string") overlayIdsRef.current.push(id);
        } catch {}
      };

      for (const o of pos) {
        if (o.kind) {
          mk(o.openPrice, "#a78bfa", `${o.type} ${Number(o.lots).toFixed(2)}L @ ${o.openPrice.toFixed(dg)}`);
        } else {
          const col = o.type === "BUY" ? "#16a34a" : "#ef4444";
          mk(o.openPrice, col, `${o.type} ${Number(o.lots).toFixed(2)}L @ ${o.openPrice.toFixed(dg)}`);
          if (o.sl) mk(o.sl, "#ef4444", `SL ${o.sl.toFixed(dg)}`);
          if (o.tp) mk(o.tp, "#16a34a", `TP ${o.tp.toFixed(dg)}`);
        }
      }

      const latestKey = Object.keys(lastBarRef.current).find(k => k.startsWith(symRef.current + ":"));
      const ask = latestKey ? lastBarRef.current[latestKey]?.close : null;
      if (ask != null && sp > 0) {
        const bid = Math.max(0, ask - sp * p);
        try {
          const askId = chart.createOverlay({ name: "priceLine", lock: true, points: [{ timestamp: Date.now(), value: ask }],
            styles: { line: { color: "#2f81f7", size: 1 } }, extendData: { text: `ASK ${ask.toFixed(dg)}` } } as any) as string;
          const bidId = chart.createOverlay({ name: "priceLine", lock: true, points: [{ timestamp: Date.now(), value: bid }],
            styles: { line: { color: "#ef4444",  size: 1 } }, extendData: { text: `BID ${bid.toFixed(dg)}` } } as any) as string;
          bidAskIdsRef.current = { bid: typeof bidId==="string"?bidId:null, ask: typeof askId==="string"?askId:null };
        } catch {}
      }
    };
    const t = setTimeout(draw, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [positions, spreadPips]);

  // ── resize ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { try { chartRef.current?.resize(); } catch {} });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dark = theme === "dark";
  const BDR  = dark ? "#1c2330" : "#e2e8f0";
  const BG   = dark ? "#11151d" : "#ffffff";
  const TXT  = dark ? "#e7ecf3" : "#0f172a";
  const MUT  = dark ? "#8a93a6" : "#64748b";
  const BLUE = "#2f81f7";
  const SIDE = dark ? "#0f1420" : "#f8fafc"; // left sidebar bg

  const SvgBtn = ({ tool }: { tool: typeof DRAW_TOOLS[number] }) => {
    const active = activeTool === tool.name;
    return (
      <button title={tool.label} onClick={() => pickTool(tool.name)}
        style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 6, border: "none", cursor: "pointer", color: active ? BLUE : MUT,
          background: active ? (dark?"rgba(47,129,247,0.15)":"rgba(47,129,247,0.1)") : "transparent" }}>
        <span style={{ width: 18, height: 18, display: "flex" }}>{tool.svg}</span>
      </button>
    );
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: dark?"#0a0d12":"#f3f5f9", overflow: "hidden" }}>

      {/* ── TOP TOOLBAR ─────────────────────────────────────────────────── */}
      {showToolbar && (
        <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: `1px solid ${BDR}`, background: BG, height: 38, flexShrink: 0, paddingLeft: 6, paddingRight: 6, overflow: "hidden" }}>

          {/* Hamburger / menu */}
          <button title="Menu" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: MUT, cursor: "pointer", borderRadius: 5, flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="2" width="16" height="2" rx="1"/><rect y="7" width="16" height="2" rx="1"/><rect y="12" width="16" height="2" rx="1"/></svg>
          </button>

          {/* Symbol badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px", borderRight: `1px solid ${BDR}`, height: "100%", flexShrink: 0 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {symbol.charAt(0)}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: TXT, letterSpacing: 0.3 }}>{symbol}</span>
          </div>

          {/* Timeframes */}
          <div style={{ display: "flex", alignItems: "center", height: "100%", paddingLeft: 4, borderRight: `1px solid ${BDR}`, overflowX: "auto", flexShrink: 0, scrollbarWidth: "none" }}>
            {TF_LIST.map(t => (
              <button key={t.label} onClick={() => changeTf(t.label)}
                style={{ padding: "0 7px", height: "100%", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", borderRadius: 4, whiteSpace: "nowrap",
                  background: activeTf === t.label ? (dark?"rgba(47,129,247,0.18)":"rgba(47,129,247,0.12)") : "transparent",
                  color: activeTf === t.label ? BLUE : MUT, borderBottom: activeTf === t.label ? `2px solid ${BLUE}` : "2px solid transparent" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Indicators button */}
          <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button onClick={() => { setShowIndPanel(p => !p); setShowSetupPanel(false); }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 10px", height: "100%", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                background: showIndPanel ? (dark?"rgba(47,129,247,0.12)":"rgba(47,129,247,0.08)") : "transparent",
                color: showIndPanel ? BLUE : MUT, borderRight: `1px solid ${BDR}` }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="1,10 4,5 7,8 10,3 13,6"/></svg>
              Indicators
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.5 }}><path d="M1 2l3 4 3-4z"/></svg>
            </button>
            {showIndPanel && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowIndPanel(false)} />
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, zIndex: 100, background: BG,
                  border: `1px solid ${BDR}`, borderRadius: 8, padding: 8, minWidth: 210, boxShadow: "0 8px 28px rgba(0,0,0,0.25)" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: 1, padding: "2px 6px 6px" }}>Main Pane</div>
                  {MAIN_INDS.map(ind => (
                    <button key={ind.name} onClick={() => toggleInd(ind.name, true)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12,
                        background: activeInds.has(ind.name) ? "rgba(47,129,247,0.1)" : "transparent", color: activeInds.has(ind.name) ? BLUE : TXT }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${activeInds.has(ind.name)?BLUE:BDR}`, background: activeInds.has(ind.name)?BLUE:"transparent",
                        display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {activeInds.has(ind.name) && <svg width="8" height="8" viewBox="0 0 8 8" fill="#fff"><polyline points="1,4 3,6 7,2" strokeWidth="1.5" stroke="#fff" fill="none"/></svg>}
                      </span>
                      {ind.label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: BDR, margin: "6px 0" }} />
                  <div style={{ fontSize: 9, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: 1, padding: "2px 6px 6px" }}>Sub Panes</div>
                  {SUB_INDS.map(ind => (
                    <button key={ind.name} onClick={() => toggleInd(ind.name, false)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12,
                        background: activeInds.has(ind.name) ? "rgba(47,129,247,0.1)" : "transparent", color: activeInds.has(ind.name) ? BLUE : TXT }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${activeInds.has(ind.name)?BLUE:BDR}`, background: activeInds.has(ind.name)?BLUE:"transparent",
                        display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {activeInds.has(ind.name) && <svg width="8" height="8" viewBox="0 0 8 8" fill="#fff"><polyline points="1,4 3,6 7,2" strokeWidth="1.5" stroke="#fff" fill="none"/></svg>}
                      </span>
                      {ind.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right-side utility buttons */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 0, height: "100%", flexShrink: 0 }}>
            {/* Screenshot */}
            <button title="Screenshot" onClick={() => {
              try {
                const url = chartRef.current?.getConvertPictureUrl?.(true, "png", dark?"#0a0d12":"#f3f5f9");
                if (url) { const a = document.createElement("a"); a.href = url; a.download = `chart-${symbol}.png`; a.click(); }
              } catch {}
            }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 10px", height: "100%", border: "none", cursor: "pointer", fontSize: 12, background: "transparent", color: MUT, borderLeft: `1px solid ${BDR}` }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="3" width="12" height="9" rx="1.5"/><circle cx="7" cy="7.5" r="2.2"/><path d="M5 3l.8-1.5h2.4L9 3"/></svg>
              screenshot
            </button>
            {/* Full screen */}
            <button title="Full screen" onClick={() => {
              try {
                const el = document.documentElement;
                if (!document.fullscreenElement) el.requestFullscreen?.();
                else document.exitFullscreen?.();
              } catch {}
            }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 10px", height: "100%", border: "none", cursor: "pointer", fontSize: 12, background: "transparent", color: MUT, borderLeft: `1px solid ${BDR}` }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>
              full screen
            </button>
          </div>
        </div>
      )}

      {/* ── BODY: left sidebar + chart ──────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* Left drawing tools sidebar */}
        {showToolbar && (
          <div style={{ width: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, paddingTop: 6, paddingBottom: 6, background: SIDE, borderRight: `1px solid ${BDR}`, flexShrink: 0, overflowY: "auto", scrollbarWidth: "none" }}>
            {/* Cursor / pointer mode — exit drawing, keep existing drawings */}
            <button title="Pointer (exit drawing)" onClick={stopTool}
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", cursor: "pointer",
                color: !activeTool ? BLUE : MUT, background: !activeTool ? (dark?"rgba(47,129,247,0.15)":"rgba(47,129,247,0.1)") : "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2l10 6-5 1-2 5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            </button>

            <div style={{ width: 24, height: 1, background: BDR, margin: "3px 0" }} />

            {DRAW_TOOLS.map(tool => <SvgBtn key={tool.name} tool={tool} />)}

            <div style={{ width: 24, height: 1, background: BDR, margin: "3px 0" }} />

            {/* Magnet */}
            <button title="Magnet mode" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", cursor: "pointer", color: MUT, background: "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8V4a5 5 0 0110 0v4"/><path d="M3 8h2v2a3 3 0 006 0V8h2"/></svg>
            </button>
            {/* Lock */}
            <button title="Lock drawings" onClick={() => { try { chartRef.current?.overrideOverlay?.({ lock: true }); } catch {} }}
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", cursor: "pointer", color: MUT, background: "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="8" width="10" height="7" rx="1.5"/><path d="M5 8V5.5a3 3 0 016 0V8"/></svg>
            </button>
            {/* Hide all */}
            <button title="Hide drawings" onClick={() => { try { chartRef.current?.overrideOverlay?.({ visible: false }); } catch {} }}
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", cursor: "pointer", color: MUT, background: "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="14" x2="14" y2="2"/></svg>
            </button>

            <div style={{ width: 24, height: 1, background: BDR, margin: "3px 0" }} />

            {/* Delete all */}
            <button title="Clear all drawings" onClick={clearDrawings}
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", cursor: "pointer", color: "#ef4444", background: "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3,4 13,4"/><path d="M6 4V3h4v1M5 4l1 9h4l1-9"/></svg>
            </button>
          </div>
        )}

        {/* Chart canvas */}
        <div ref={elRef} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }} />
      </div>
    </div>
  );
}
