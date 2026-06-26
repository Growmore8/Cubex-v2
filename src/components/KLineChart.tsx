"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

// ── Timeframes ────────────────────────────────────────────────────────────────
const TF_LIST = [
  { label: "1m",  type: "minute" as const, span: 1  },
  { label: "5m",  type: "minute" as const, span: 5  },
  { label: "15m", type: "minute" as const, span: 15 },
  { label: "30m", type: "minute" as const, span: 30 },
  { label: "1H",  type: "hour"   as const, span: 1  },
  { label: "2H",  type: "hour"   as const, span: 2  },
  { label: "4H",  type: "hour"   as const, span: 4  },
  { label: "D",   type: "day"    as const, span: 1  },
  { label: "W",   type: "day"    as const, span: 7  },
];
const TF_MAP: Record<string, { type: "minute"|"hour"|"day"; span: number }> = {
  "1m": {type:"minute",span:1}, "5m": {type:"minute",span:5}, "15m": {type:"minute",span:15},
  "30m":{type:"minute",span:30}, "1H":{type:"hour",span:1}, "2H":{type:"hour",span:2},
  "4H": {type:"hour",span:4},   "D":  {type:"day",span:1},  "W":  {type:"day",span:7},
};
const TF_SEC: Record<string, number> = {
  "1m":60,"5m":300,"15m":900,"30m":1800,"1H":3600,"2H":7200,"4H":14400,"D":86400,"W":604800,
};
const TF_API: Record<string, string> = {
  "1m":"1M","5m":"5M","15m":"15M","30m":"30M","1H":"1H","2H":"2H","4H":"4H","D":"1D","W":"1W",
};
const normTf = (r: string) => {
  if (r==="1M") return "1m"; if (r==="5M") return "5m"; if (r==="15M") return "15m";
  if (r==="30M") return "30m"; if (r==="1D") return "D"; if (r==="1W") return "W";
  return r;
};

// ── Chart types ───────────────────────────────────────────────────────────────
const CHART_TYPES = [
  { id: "candle_solid",  label: "Candles", icon: (c:string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="4" y1="2" x2="4" y2="14" stroke={c} strokeWidth="1.2"/>
      <rect x="2" y="4" width="4" height="6" fill={c}/>
      <line x1="11" y1="1" x2="11" y2="15" stroke={c} strokeWidth="1.2"/>
      <rect x="9" y="5" width="4" height="5" fill={c}/>
    </svg>
  )},
  { id: "candle_stroke", label: "Hollow Candles", icon: (c:string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="4" y1="2" x2="4" y2="14" stroke={c} strokeWidth="1.2"/>
      <rect x="2" y="4" width="4" height="6" stroke={c} strokeWidth="1.2"/>
      <line x1="11" y1="1" x2="11" y2="15" stroke={c} strokeWidth="1.2"/>
      <rect x="9" y="5" width="4" height="5" stroke={c} strokeWidth="1.2"/>
    </svg>
  )},
  { id: "ohlc",          label: "Bars", icon: (c:string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="4" y1="3" x2="4" y2="13" stroke={c} strokeWidth="1.4"/>
      <line x1="2" y1="6" x2="4" y2="6"  stroke={c} strokeWidth="1.4"/>
      <line x1="4" y1="9" x2="6" y2="9"  stroke={c} strokeWidth="1.4"/>
      <line x1="11" y1="2" x2="11" y2="12" stroke={c} strokeWidth="1.4"/>
      <line x1="9"  y1="5" x2="11" y2="5" stroke={c} strokeWidth="1.4"/>
      <line x1="11" y1="8" x2="13" y2="8" stroke={c} strokeWidth="1.4"/>
    </svg>
  )},
  { id: "area",          label: "Area", icon: (c:string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 12 L4 7 L8 9 L12 4 L15 6 L15 14 L1 14 Z" fill={c} fillOpacity="0.3"/>
      <path d="M1 12 L4 7 L8 9 L12 4 L15 6" stroke={c} strokeWidth="1.5" fill="none"/>
    </svg>
  )},
  { id: "line",          label: "Line", icon: (c:string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 12 L4 7 L8 9 L12 4 L15 6" stroke={c} strokeWidth="1.8" fill="none"/>
    </svg>
  )},
];

// ── Indicators ────────────────────────────────────────────────────────────────
const MAIN_INDS = [
  {name:"MA",label:"MA — Moving Average"},
  {name:"EMA",label:"EMA — Exponential MA"},
  {name:"BOLL",label:"BB — Bollinger Bands"},
  {name:"SAR",label:"SAR — Parabolic SAR"},
  {name:"AVP",label:"VWAP — Volume Weighted"},
];
const SUB_INDS = [
  {name:"VOL",label:"Volume"},
  {name:"MACD",label:"MACD"},
  {name:"RSI",label:"RSI"},
  {name:"KDJ",label:"KDJ — Stochastic"},
  {name:"CCI",label:"CCI"},
  {name:"WR",label:"W%R — Williams %R"},
  {name:"DMI",label:"DMI — Directional Index"},
  {name:"BIAS",label:"BIAS"},
  {name:"ROC",label:"ROC — Rate of Change"},
  {name:"OBV",label:"OBV — On Balance Volume"},
];

// ── Drawing tools ─────────────────────────────────────────────────────────────
const DRAW_GROUPS = [
  {
    label: "Lines",
    tools: [
      { name:"line",                  label:"Trend Line",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="16" x2="16" y2="2"/><circle cx="2" cy="16" r="1.5" fill="currentColor"/><circle cx="16" cy="2" r="1.5" fill="currentColor"/></svg> },
      { name:"horizontalStraightLine",label:"Horizontal Line",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="1" y1="9" x2="17" y2="9"/></svg> },
      { name:"verticalStraightLine",  label:"Vertical Line",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="9" y1="1" x2="9" y2="17"/></svg> },
      { name:"rayLine",               label:"Ray",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="9" x2="16" y2="9"/><polyline points="12,5 16,9 12,13"/></svg> },
      { name:"segment",               label:"Arrow Segment",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="3" y1="15" x2="15" y2="3"/><polyline points="10,3 15,3 15,8"/></svg> },
    ],
  },
  {
    label: "Channels",
    tools: [
      { name:"priceChannelLine",      label:"Price Channel",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="5" x2="16" y2="5"/><line x1="2" y1="13" x2="16" y2="13"/></svg> },
      { name:"parallelStraightLine",  label:"Parallel Lines",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="4" x2="16" y2="4"/><line x1="2" y1="9" x2="16" y2="9"/><line x1="2" y1="14" x2="16" y2="14"/></svg> },
      { name:"fibonacciLine",         label:"Fibonacci Retracement",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="3" x2="16" y2="3"/><line x1="2" y1="7" x2="16" y2="7"/><line x1="2" y1="11" x2="16" y2="11"/><line x1="2" y1="15" x2="16" y2="15"/><text x="13" y="6" fontSize="5" fill="currentColor" stroke="none">61</text><text x="13" y="10" fontSize="5" fill="currentColor" stroke="none">38</text></svg> },
    ],
  },
  {
    label: "Shapes",
    tools: [
      { name:"rect",  label:"Rectangle",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="4" width="14" height="10" rx="1"/></svg> },
      { name:"circle",label:"Circle",
        icon:<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="7"/></svg> },
      { name:"text",  label:"Text Note",
        icon:<svg viewBox="0 0 18 18" fill="currentColor"><text x="3" y="14" fontSize="14" fontWeight="700">T</text></svg> },
    ],
  },
];
const ALL_DRAW_TOOLS = DRAW_GROUPS.flatMap(g => g.tools);

function pip(digits: number) { return Math.pow(10, -(digits - 1)); }

let _kc: Promise<any>|null = null;
const loadKc = () => (_kc || (_kc = import("klinecharts")));

let _ovReady = false;
async function ensureOverlays() {
  if (_ovReady) return; _ovReady = true;
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
          { type: "line", attrs: { coordinates: [{x:0,y:c.y},{x:bounding.width,y:c.y}] },
            styles: { color, style: "dashed", size: 1, dashedValue: [5,3] } },
          { type: "text", ignoreEvent: true,
            attrs: { x: bounding.width - 4, y: c.y, text, align: "right", baseline: "middle" },
            styles: { color:"#fff", backgroundColor: color, borderColor: color, borderSize:1,
              paddingLeft:6, paddingRight:6, paddingTop:3, paddingBottom:3, borderRadius:3, size:11, weight:"600" } },
        ];
      },
    });
  } catch {}
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
type OhlcInfo = { time: string; open: number; high: number; low: number; close: number; volume: number; up: boolean } | null;

export default function KLineChart({
  symbol, tf, theme, digits = 5, symbols, positions, onSymbolChange, spreadPips, showToolbar = true,
}: {
  symbol: string; tf: string; theme: "dark"|"light";
  digits?: number; symbols?: Sym[];
  positions?: ChartPosition[];
  onSymbolChange?: (s: string) => void;
  spreadPips?: number;
  showToolbar?: boolean;
}) {
  const elRef         = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<any>(null);
  const sockRef       = useRef<Socket|null>(null);
  const lastBarRef    = useRef<Record<string,any>>({});
  const overlayIdsRef = useRef<string[]>([]);
  const bidAskIdsRef  = useRef<{bid:string|null;ask:string|null}>({bid:null,ask:null});
  const posRef    = useRef(positions);      posRef.current    = positions;
  const symRef    = useRef(symbol);         symRef.current    = symbol;
  const digRef    = useRef(digits);         digRef.current    = digits;
  const tfRef     = useRef(tf);             tfRef.current     = tf;
  const spRef     = useRef(spreadPips??0);  spRef.current     = spreadPips??0;
  const onSymRef  = useRef(onSymbolChange); onSymRef.current  = onSymbolChange;
  const activeToolRef = useRef<string|null>(null);

  const [activeTf,       setActiveTf]       = useState(() => normTf(tf));
  const [chartType,      setChartType]       = useState("candle_solid");
  const [activeTool,     setActiveTool]      = useState<string|null>(null);
  const [activeInds,     setActiveInds]      = useState<Set<string>>(new Set());
  const [showIndPanel,   setShowIndPanel]    = useState(false);
  const [showTypePanel,  setShowTypePanel]   = useState(false);
  const [ohlc,           setOhlc]            = useState<OhlcInfo>(null);
  const [drawSidebar,    setDrawSidebar]     = useState(true);

  activeToolRef.current = activeTool;

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let disposed = false;
    ensureOverlays();

    loadKc().then((kc) => {
      if (disposed || !el) return;

      // touch-action:none BEFORE init — mobile fix
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;inset:0;touch-action:none;overflow:hidden;";
      el.appendChild(wrap);

      const dark = theme === "dark";
      const text = dark ? "#d1d4dc" : "#131722";
      const grid = dark ? "#1e222d" : "#e0e3eb";
      const bg   = dark ? "#131722" : "#ffffff";

      const chart = kc.init(wrap, {
        styles: {
          candle: {
            type: "candle_solid",
            bar: { upColor:"#26a69a", downColor:"#ef5350", upBorderColor:"#26a69a", downBorderColor:"#ef5350", upWickColor:"#26a69a", downWickColor:"#ef5350" },
            tooltip: {
              showType: "rect", showRule: "follow_cross",
              rect: { position:"pointer", offsetLeft:8, offsetTop:8, offsetRight:8, offsetBottom:8,
                borderRadius:4, borderSize:1, borderColor: dark?"#2a2e39":"#e0e3eb",
                color: dark?"#1e222d":"#ffffff" },
              text: { size:12, family:"'Trebuchet MS',system-ui,sans-serif", weight:"normal", color: text },
              labels: ["T","O","H","L","C","V"],
            },
          },
          indicator: { tooltip: { text: { size:11, family:"'Trebuchet MS',system-ui,sans-serif" } } },
          xAxis: {
            show: true,
            axisLine: { show:true, color: grid },
            tickLine: { show:true, color: grid },
            tickText: { color: dark?"#787b86":"#787b86", size:11, family:"'Trebuchet MS',system-ui,sans-serif" },
          },
          yAxis: {
            show: true,
            axisLine: { show:true, color: grid },
            tickLine: { show:true, color: grid },
            tickText: { color: dark?"#787b86":"#787b86", size:11, family:"'Trebuchet MS',system-ui,sans-serif" },
          },
          grid: {
            horizontal: { show:true, color: grid, style:"solid", size:1 },
            vertical:   { show:false },
          },
          crosshair: {
            show: true,
            horizontal: { show:true, line: { show:true, color: dark?"#363a45":"#9598a1", style:"dashed", dashedValue:[4,2] },
              text: { show:true, color:"#ffffff", size:11, family:"'Trebuchet MS',system-ui,sans-serif",
                backgroundColor: dark?"#363a45":"#787b86", borderColor: dark?"#363a45":"#787b86", paddingLeft:4, paddingRight:4, paddingTop:3, paddingBottom:3, borderRadius:2 } },
            vertical: { show:true, line: { show:true, color: dark?"#363a45":"#9598a1", style:"dashed", dashedValue:[4,2] },
              text: { show:true, color:"#ffffff", size:11, family:"'Trebuchet MS',system-ui,sans-serif",
                backgroundColor: dark?"#363a45":"#787b86", borderColor: dark?"#363a45":"#787b86", paddingLeft:4, paddingRight:4, paddingTop:3, paddingBottom:3, borderRadius:2 } },
          },
          overlay: { point: { color:"#1e88e5", borderColor:"#ffffff", borderSize:2, radius:5 }, line: { color:"#1e88e5", size:1 } },
        } as any,
        timezone: "Etc/UTC",
        locale: "en-US",
        layout: [
          { type: "candle", options: { id: "candle_pane", height: 1, minHeight: 150 } },
        ],
      });
      if (!chart) return;
      chartRef.current = chart;
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
      chart.setOffsetRightDistance(60);
      chart.setBarSpace(9);

      // OHLCV legend via crosshair subscription
      try {
        chart.subscribeAction("onCrosshairChange", (data: any) => {
          const b = data?.kLineData;
          if (!b) { setOhlc(null); return; }
          const d = new Date(b.timestamp);
          const pad = (n: number) => String(n).padStart(2,"0");
          setOhlc({
            time: `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
            open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume??0,
            up: b.close >= b.open,
          });
        });
      } catch {}

      // Keyboard: Escape exits drawing
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { setActiveTool(null); activeToolRef.current = null; }
      };
      window.addEventListener("keydown", onKey);

      // ── DataLoader ─────────────────────────────────────────────────────
      const socks: Record<string, Socket> = {};

      chart.setDataLoader({
        getBars: async ({ type, symbol: sym, period, timestamp, callback }: any) => {
          const tfKey = TF_LIST.find(t => t.type===period.type && t.span===period.span)?.label ?? "1H";
          const apiTf = TF_API[tfKey] ?? "1H";
          const sec   = TF_SEC[tfKey] ?? 3600;
          const lbKey = sym.ticker + ":" + tfKey;
          void sec;
          try {
            const url = type==="forward" && timestamp
              ? `/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${apiTf}&before=${Math.floor(timestamp/1000)}`
              : `/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${apiTf}`;
            const r = await fetch(url, { cache:"no-store" }).then(x => x.json());
            if (r?.ok && r.candles?.length) {
              const bars = r.candles.map((b: any) => ({ timestamp:b.time*1000, open:b.open, high:b.high, low:b.low, close:b.close, volume:b.volume??0 }));
              lastBarRef.current[lbKey] = bars[bars.length-1];
              callback(bars, { forward: bars.length>=200, backward: false });
            } else { callback([], false); }
          } catch { callback([], false); }
        },
        subscribeBar: ({ symbol: sym, period, callback }: any) => {
          const tfKey = TF_LIST.find(t => t.type===period.type && t.span===period.span)?.label ?? "1H";
          const sec   = TF_SEC[tfKey] ?? 3600;
          const lbKey = sym.ticker + ":" + tfKey;
          socks[lbKey]?.disconnect();
          const sock = io({ path:"/socket.io" });
          socks[lbKey] = sock; sockRef.current = sock;
          sock.on("tick", (msg: any) => {
            if (msg.symbol !== sym.ticker) return;
            const price = msg.price; if (price==null) return;
            const real  = msg.real ?? price;
            const t = Math.floor(Date.now()/1000/sec)*sec*1000;
            let last = lastBarRef.current[lbKey];
            if (last && last.timestamp===t) {
              last.high=Math.max(last.high,price,real); last.low=Math.min(last.low,price,real); last.close=price;
            } else {
              const open = last?last.close:price;
              last = { timestamp:t, open, high:Math.max(open,price,real), low:Math.min(open,price,real), close:price, volume:0 };
              lastBarRef.current[lbKey] = last;
            }
            callback({ ...last });
          });
        },
        unsubscribeBar: ({ symbol: sym, period }: any) => {
          const tfKey = TF_LIST.find(t => t.type===period.type && t.span===period.span)?.label ?? "1H";
          const lbKey = sym.ticker + ":" + tfKey;
          socks[lbKey]?.disconnect(); delete socks[lbKey];
        },
      });

      // Use refs here — the async import may resolve AFTER symbol/tf props changed
      const initTf = normTf(tfRef.current ?? tf);
      chart.setSymbol({ ticker: symRef.current || symbol, pricePrecision: digRef.current ?? digits, volumePrecision: 0 });
      chart.setPeriod(TF_MAP[initTf] ?? { type:"hour", span:1 });

      return () => {
        Object.values(socks).forEach(s => { try { s.disconnect(); } catch {} });
        window.removeEventListener("keydown", onKey);
      };
    });

    return () => {
      disposed = true;
      try { chartRef.current && loadKc().then(kc => { try { kc.dispose(elRef.current?.querySelector("div") as any); } catch {} }); } catch {}
      chartRef.current = null; sockRef.current?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    const dark = theme==="dark";
    const text = dark?"#d1d4dc":"#131722";
    const grid = dark?"#1e222d":"#e0e3eb";
    try {
      chart.setStyles({
        candle: { bar:{ upColor:"#26a69a",downColor:"#ef5350",upBorderColor:"#26a69a",downBorderColor:"#ef5350",upWickColor:"#26a69a",downWickColor:"#ef5350" },
          tooltip:{ rect:{ borderColor:dark?"#2a2e39":"#e0e3eb", color:dark?"#1e222d":"#ffffff" }, text:{ color:text } } },
        xAxis:{ axisLine:{color:grid}, tickLine:{color:grid}, tickText:{color:"#787b86"} },
        yAxis:{ axisLine:{color:grid}, tickLine:{color:grid}, tickText:{color:"#787b86"} },
        grid:{ horizontal:{color:grid}, vertical:{show:false} },
        crosshair:{
          horizontal:{ line:{color:dark?"#363a45":"#9598a1"}, text:{color:"#fff", backgroundColor:dark?"#363a45":"#787b86", borderColor:dark?"#363a45":"#787b86"} },
          vertical:{   line:{color:dark?"#363a45":"#9598a1"}, text:{color:"#fff", backgroundColor:dark?"#363a45":"#787b86", borderColor:dark?"#363a45":"#787b86"} },
        },
      } as any);
    } catch {}
  }, [theme]);

  // ── Symbol — retry if chart not ready yet (async import may still be in flight)
  useEffect(() => {
    if (!symbol) return;
    const apply = () => {
      const chart = chartRef.current;
      if (!chart) return false;
      try { chart.setSymbol({ ticker: symbol, pricePrecision: digits, volumePrecision: 0 }); } catch {}
      return true;
    };
    if (!apply()) {
      // Chart init is still loading — retry once it's ready
      const id = setInterval(() => { if (apply()) clearInterval(id); }, 50);
      return () => clearInterval(id);
    }
  }, [symbol, digits]);

  // ── Timeframe ─────────────────────────────────────────────────────────────
  const changeTf = useCallback((label: string) => {
    const chart = chartRef.current; if (!chart) return;
    setActiveTf(label);
    try { chart.setPeriod(TF_MAP[label] ?? { type:"hour", span:1 }); } catch {}
  }, []);

  // ── Chart type ────────────────────────────────────────────────────────────
  const changeType = useCallback((id: string) => {
    const chart = chartRef.current; if (!chart) return;
    setChartType(id); setShowTypePanel(false);
    try { chart.setStyles({ candle: { type: id } } as any); } catch {}
  }, []);

  // ── Indicators ────────────────────────────────────────────────────────────
  const toggleInd = useCallback((name: string, isMain: boolean) => {
    const chart = chartRef.current; if (!chart) return;
    setActiveInds(prev => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); try { chart.removeIndicator({ name }); } catch {} }
      else {
        next.add(name);
        try {
          if (isMain) chart.createIndicator(name, { paneOptions:{ id:"candle_pane" } });
          else        chart.createIndicator(name, { paneOptions:{ height:80 } });
        } catch {}
      }
      return next;
    });
  }, []);

  // ── Drawing tools ─────────────────────────────────────────────────────────
  const pickTool = useCallback((name: string) => {
    const chart = chartRef.current; if (!chart) return;
    if (activeToolRef.current === name) {
      // clicking same tool again = deselect + cancel in-progress
      setActiveTool(null);
      try { chart.removeOverlay({}); } catch {}
      return;
    }
    setActiveTool(name);
    try { chart.createOverlay({ name, lock: false }); } catch {}
  }, []);

  // After drawing completes, auto-start next overlay of same tool
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !activeTool) return;
    let active = true;
    const onEnd = () => {
      if (!active || !activeToolRef.current) return;
      setTimeout(() => {
        if (!active || !activeToolRef.current) return;
        try { chart.createOverlay({ name: activeToolRef.current!, lock: false }); } catch {}
      }, 50);
    };
    try { chart.subscribeAction("onOverlayDrawEnd", onEnd); } catch {}
    return () => {
      active = false;
      try { chart.unsubscribeAction("onOverlayDrawEnd", onEnd); } catch {}
    };
  }, [activeTool]);

  const exitDrawing = useCallback(() => {
    setActiveTool(null);
  }, []);

  const clearDrawings = useCallback(() => {
    const chart = chartRef.current; if (!chart) return;
    ALL_DRAW_TOOLS.forEach(t => { try { chart.removeOverlay({ name: t.name }); } catch {} });
    setActiveTool(null);
  }, []);

  // ── Trade overlays ────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      for (const id of overlayIdsRef.current) { try { chart.removeOverlay({ id }); } catch {} }
      overlayIdsRef.current = [];
      try { chart.removeOverlay({ id: bidAskIdsRef.current.bid??""   }); } catch {}
      try { chart.removeOverlay({ id: bidAskIdsRef.current.ask??""   }); } catch {}
      bidAskIdsRef.current = { bid:null, ask:null };

      const pos = posRef.current ?? [];
      const dg  = digRef.current;
      const sp  = spRef.current;
      const p   = pip(dg);

      const mk = (price: number, color: string, text: string) => {
        try {
          const id = chart.createOverlay({ name:"cubexLevel", lock:true, needDefaultPointFigure:false,
            needDefaultYAxisFigure:true, points:[{ timestamp:Date.now(), value:price }],
            extendData:{ color, text } } as any) as string;
          if (typeof id==="string") overlayIdsRef.current.push(id);
        } catch {}
      };

      for (const o of pos) {
        if (o.kind) {
          mk(o.openPrice,"#9b59b6",`${o.type} ${Number(o.lots).toFixed(2)} @ ${o.openPrice.toFixed(dg)}`);
        } else {
          const col = o.type==="BUY" ? "#26a69a" : "#ef5350";
          mk(o.openPrice, col, `${o.type} ${Number(o.lots).toFixed(2)} @ ${o.openPrice.toFixed(dg)}`);
          if (o.sl) mk(o.sl, "#ef5350", `SL  ${o.sl.toFixed(dg)}`);
          if (o.tp) mk(o.tp, "#26a69a", `TP  ${o.tp.toFixed(dg)}`);
        }
      }

      // Spread lines — only when spreadPips > 0
      if (sp > 0) {
        const latestKey = Object.keys(lastBarRef.current).find(k => k.startsWith(symRef.current+":"));
        const ask = latestKey ? lastBarRef.current[latestKey]?.close : null;
        if (ask != null) {
          const bid = Math.max(0, ask - sp*p);
          try {
            const askId = chart.createOverlay({ name:"priceLine", lock:true, points:[{timestamp:Date.now(),value:ask}],
              styles:{line:{color:"#1e88e5",size:1}}, extendData:{text:`Ask ${ask.toFixed(dg)}`} } as any) as string;
            const bidId = chart.createOverlay({ name:"priceLine", lock:true, points:[{timestamp:Date.now(),value:bid}],
              styles:{line:{color:"#ef5350",size:1}}, extendData:{text:`Bid ${bid.toFixed(dg)}`} } as any) as string;
            bidAskIdsRef.current = { bid:typeof bidId==="string"?bidId:null, ask:typeof askId==="string"?askId:null };
          } catch {}
        }
      }
    };
    const t = setTimeout(draw, 300);
    return () => { cancelled=true; clearTimeout(t); };
  }, [positions, spreadPips]);

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { try { chartRef.current?.resize(); } catch {} });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Colours ───────────────────────────────────────────────────────────────
  const dark  = theme==="dark";
  const BG    = dark ? "#131722" : "#ffffff";
  const TOPBG = dark ? "#1e222d" : "#f0f3fa";
  const BDR   = dark ? "#2a2e39" : "#e0e3eb";
  const TXT   = dark ? "#d1d4dc" : "#131722";
  const MUT   = dark ? "#787b86" : "#787b86";
  const BLUE  = "#2962ff";
  const SIDE  = dark ? "#1a1e2d" : "#f8f9fd";
  const UP    = "#26a69a", DN = "#ef5350";

  const activeChartType = CHART_TYPES.find(t => t.id===chartType)!;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", background:dark?"#131722":"#f0f3fa", overflow:"hidden", fontFamily:"'Trebuchet MS',system-ui,sans-serif" }}>

      {/* ━━ TOP TOOLBAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showToolbar && (
        <div style={{ display:"flex", alignItems:"center", height:38, background:TOPBG, borderBottom:`1px solid ${BDR}`, flexShrink:0, paddingLeft:4, paddingRight:4, gap:0, userSelect:"none" }}>

          {/* Hamburger */}
          <button onClick={() => setDrawSidebar(p=>!p)} title="Toggle drawing panel"
            style={{ width:34, height:38, display:"flex", alignItems:"center", justifyContent:"center", border:"none", background:"transparent", color:drawSidebar?BLUE:MUT, cursor:"pointer", flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="2.5" width="16" height="1.8" rx="0.9"/><rect y="7.1" width="16" height="1.8" rx="0.9"/><rect y="11.7" width="16" height="1.8" rx="0.9"/></svg>
          </button>

          <div style={{ width:1, height:20, background:BDR, margin:"0 2px" }} />

          {/* Symbol */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"0 10px", borderRight:`1px solid ${BDR}`, height:"100%", flexShrink:0 }}>
            <div style={{ width:22, height:22, borderRadius:"50%", background:BLUE, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff" }}>
              {symbol.charAt(0)}
            </div>
            <span style={{ fontSize:13, fontWeight:700, color:TXT, letterSpacing:0.2 }}>{symbol}</span>
          </div>

          {/* Chart type picker */}
          <div style={{ position:"relative", height:"100%", display:"flex", alignItems:"center" }}>
            <button onClick={() => { setShowTypePanel(p=>!p); setShowIndPanel(false); }}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"0 10px", height:"100%", border:"none", cursor:"pointer",
                background: showTypePanel?"rgba(41,98,255,0.1)":"transparent", color:showTypePanel?BLUE:MUT,
                borderRight:`1px solid ${BDR}` }}>
              {activeChartType.icon(showTypePanel?BLUE:MUT)}
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{opacity:0.5}}><path d="M1 2l3 3 3-3z"/></svg>
            </button>
            {showTypePanel && (
              <>
                <div style={{ position:"fixed", inset:0, zIndex:98 }} onClick={() => setShowTypePanel(false)} />
                <div style={{ position:"absolute", top:"100%", left:0, marginTop:2, zIndex:99, background:BG,
                  border:`1px solid ${BDR}`, borderRadius:6, padding:4, minWidth:180, boxShadow:"0 8px 24px rgba(0,0,0,0.2)" }}>
                  {CHART_TYPES.map(t => (
                    <button key={t.id} onClick={() => changeType(t.id)}
                      style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"7px 10px", border:"none", cursor:"pointer",
                        borderRadius:4, fontSize:12, background:chartType===t.id?"rgba(41,98,255,0.1)":"transparent", color:chartType===t.id?BLUE:TXT }}>
                      {t.icon(chartType===t.id?BLUE:MUT)}
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Timeframes */}
          <div style={{ display:"flex", alignItems:"center", height:"100%", paddingLeft:2, paddingRight:2, borderRight:`1px solid ${BDR}`, overflowX:"auto", flexShrink:0, scrollbarWidth:"none" }}>
            {TF_LIST.map(t => (
              <button key={t.label} onClick={() => changeTf(t.label)}
                style={{ padding:"0 8px", height:"100%", fontSize:12, fontWeight:600, cursor:"pointer", border:"none", whiteSpace:"nowrap",
                  background: activeTf===t.label ? (dark?"rgba(41,98,255,0.15)":"rgba(41,98,255,0.1)") : "transparent",
                  color: activeTf===t.label ? BLUE : MUT,
                  borderBottom: activeTf===t.label ? `2px solid ${BLUE}` : "2px solid transparent" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Indicators */}
          <div style={{ position:"relative", height:"100%", display:"flex", alignItems:"center" }}>
            <button onClick={() => { setShowIndPanel(p=>!p); setShowTypePanel(false); }}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"0 12px", height:"100%", border:"none", cursor:"pointer", fontSize:12, fontWeight:500,
                background: showIndPanel?"rgba(41,98,255,0.1)":"transparent", color:showIndPanel?BLUE:TXT,
                borderRight:`1px solid ${BDR}` }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="1,10 4,5 7,8 10,3 13,6"/></svg>
              Indicators
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{opacity:0.5}}><path d="M1 2l3 3 3-3z"/></svg>
            </button>
            {showIndPanel && (
              <>
                <div style={{ position:"fixed", inset:0, zIndex:98 }} onClick={() => setShowIndPanel(false)} />
                <div style={{ position:"absolute", top:"100%", left:0, marginTop:2, zIndex:99, background:BG,
                  border:`1px solid ${BDR}`, borderRadius:6, padding:6, minWidth:240, boxShadow:"0 8px 24px rgba(0,0,0,0.2)" }}>
                  <div style={{ fontSize:10, fontWeight:700, color:MUT, textTransform:"uppercase", letterSpacing:1, padding:"4px 8px 6px" }}>OVERLAYS</div>
                  {MAIN_INDS.map(ind => <IndBtn key={ind.name} ind={ind} active={activeInds.has(ind.name)} onClick={() => toggleInd(ind.name,true)} blue={BLUE} bdr={BDR} txt={TXT} />)}
                  <div style={{ height:1, background:BDR, margin:"6px 0" }} />
                  <div style={{ fontSize:10, fontWeight:700, color:MUT, textTransform:"uppercase", letterSpacing:1, padding:"4px 8px 6px" }}>SUB-CHART</div>
                  {SUB_INDS.map(ind => <IndBtn key={ind.name} ind={ind} active={activeInds.has(ind.name)} onClick={() => toggleInd(ind.name,false)} blue={BLUE} bdr={BDR} txt={TXT} />)}
                </div>
              </>
            )}
          </div>

          {/* Right utility buttons */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", height:"100%", flexShrink:0 }}>
            <ToolBtn label="screenshot" onClick={() => {
              try {
                const url = chartRef.current?.getConvertPictureUrl?.(true,"png",dark?"#131722":"#ffffff");
                if (url) { const a=document.createElement("a"); a.href=url; a.download=`chart-${symbol}.png`; a.click(); }
              } catch {}
            }} bdr={BDR} mut={MUT}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="3" width="12" height="9" rx="1.5"/><circle cx="7" cy="7.5" r="2.2"/><path d="M5 3l.8-1.5h2.4L9 3"/></svg>
            </ToolBtn>
            <ToolBtn label="full screen" onClick={() => {
              try {
                if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
                else document.exitFullscreen?.();
              } catch {}
            }} bdr={BDR} mut={MUT}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>
            </ToolBtn>
          </div>
        </div>
      )}

      {/* ━━ BODY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden", position:"relative" }}>

        {/* Left drawing sidebar */}
        {showToolbar && drawSidebar && (
          <div style={{ width:40, display:"flex", flexDirection:"column", alignItems:"center", paddingTop:6, paddingBottom:6, gap:1,
            background:SIDE, borderRight:`1px solid ${BDR}`, flexShrink:0, overflowY:"auto", scrollbarWidth:"none" }}>

            {/* Pointer / exit drawing */}
            <SideBtn title="Pointer (Esc)" active={!activeTool} onClick={exitDrawing} blue={BLUE} mut={MUT} dark={dark}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3.5 2L13 7.5l-5 1.2-2 5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            </SideBtn>

            <Divider bdr={BDR} />

            {DRAW_GROUPS.map(group => (
              <div key={group.label} style={{ display:"contents" }}>
                {group.tools.map(tool => (
                  <SideBtn key={tool.name} title={tool.label} active={activeTool===tool.name} onClick={() => pickTool(tool.name)} blue={BLUE} mut={MUT} dark={dark}>
                    <span style={{ width:16, height:16, display:"flex" }}>{tool.icon}</span>
                  </SideBtn>
                ))}
                <Divider bdr={BDR} />
              </div>
            ))}

            {/* Lock drawings */}
            <SideBtn title="Lock all drawings" active={false} onClick={() => { try { chartRef.current?.overrideOverlay?.({lock:true}); } catch {} }} blue={BLUE} mut={MUT} dark={dark}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="8" width="10" height="7" rx="1.5"/><path d="M5 8V5.5a3 3 0 016 0V8"/></svg>
            </SideBtn>
            {/* Hide drawings */}
            <SideBtn title="Hide all drawings" active={false} onClick={() => { try { chartRef.current?.overrideOverlay?.({visible:false}); } catch {} }} blue={BLUE} mut={MUT} dark={dark}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="14" x2="14" y2="2"/></svg>
            </SideBtn>

            <Divider bdr={BDR} />

            {/* Delete all drawings */}
            <SideBtn title="Clear all drawings" active={false} onClick={clearDrawings} blue={BLUE} mut="#ef5350" dark={dark}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3,4 13,4"/><path d="M6 4V3h4v1M5 4l1 9h4l1-9"/></svg>
            </SideBtn>
          </div>
        )}

        {/* Chart canvas */}
        <div style={{ position:"relative", flex:1, minWidth:0, minHeight:0, overflow:"hidden" }}>
          <div ref={elRef} style={{ position:"absolute", inset:0 }} />

          {/* OHLCV legend — top left, TradingView style */}
          {ohlc && (
            <div style={{ position:"absolute", top:6, left:8, zIndex:10, display:"flex", alignItems:"baseline", gap:8, fontSize:12, fontWeight:500, fontFamily:"'Trebuchet MS',system-ui,sans-serif", pointerEvents:"none", flexWrap:"wrap" }}>
              <span style={{ color:MUT, fontSize:11 }}>{ohlc.time}</span>
              <OhlcVal label="O" val={ohlc.open.toFixed(digits)} color={ohlc.up?UP:DN} />
              <OhlcVal label="H" val={ohlc.high.toFixed(digits)} color={ohlc.up?UP:DN} />
              <OhlcVal label="L" val={ohlc.low.toFixed(digits)}  color={ohlc.up?UP:DN} />
              <OhlcVal label="C" val={ohlc.close.toFixed(digits)} color={ohlc.up?UP:DN} />
              <OhlcVal label="V" val={ohlc.volume>=1000?`${(ohlc.volume/1000).toFixed(1)}K`:ohlc.volume.toFixed(0)} color={MUT} />
            </div>
          )}

          {/* Active tool hint */}
          {activeTool && (
            <div style={{ position:"absolute", bottom:8, left:"50%", transform:"translateX(-50%)", zIndex:10, pointerEvents:"none",
              background:BLUE, color:"#fff", fontSize:11, fontWeight:600, padding:"4px 12px", borderRadius:12,
              boxShadow:"0 2px 8px rgba(41,98,255,0.4)" }}>
              {ALL_DRAW_TOOLS.find(t=>t.name===activeTool)?.label} — click to draw · Esc to exit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small reusable components ─────────────────────────────────────────────────
function OhlcVal({ label, val, color }: { label:string; val:string; color:string }) {
  return (
    <span style={{ color, fontSize:12 }}>
      <span style={{ opacity:0.65, marginRight:2 }}>{label}</span>{val}
    </span>
  );
}

function SideBtn({ title, active, onClick, blue, mut, dark, children }:
  { title:string; active:boolean; onClick:()=>void; blue:string; mut:string; dark:boolean; children:React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center",
        borderRadius:5, border:"none", cursor:"pointer",
        color: active ? blue : mut,
        background: active ? (dark?"rgba(41,98,255,0.15)":"rgba(41,98,255,0.12)") : "transparent" }}>
      {children}
    </button>
  );
}

function Divider({ bdr }: { bdr:string }) {
  return <div style={{ width:24, height:1, background:bdr, margin:"3px 0", flexShrink:0 }} />;
}

function IndBtn({ ind, active, onClick, blue, bdr, txt }:
  { ind:{name:string;label:string}; active:boolean; onClick:()=>void; blue:string; bdr:string; txt:string }) {
  return (
    <button onClick={onClick}
      style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"6px 8px",
        borderRadius:4, border:"none", cursor:"pointer", fontSize:12, textAlign:"left",
        background: active?"rgba(41,98,255,0.1)":"transparent", color: active?blue:txt }}>
      <span style={{ width:14, height:14, borderRadius:3, flexShrink:0,
        border:`1.5px solid ${active?blue:bdr}`, background:active?blue:"transparent",
        display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
        {active && <svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" strokeWidth="1.8" stroke="#fff" fill="none"/></svg>}
      </span>
      {ind.label}
    </button>
  );
}

function ToolBtn({ label, onClick, bdr, mut, children }:
  { label:string; onClick:()=>void; bdr:string; mut:string; children:React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ display:"flex", alignItems:"center", gap:5, padding:"0 10px", height:"100%",
        border:"none", cursor:"pointer", fontSize:12, background:"transparent", color:mut, borderLeft:`1px solid ${bdr}` }}>
      {children}{label}
    </button>
  );
}
