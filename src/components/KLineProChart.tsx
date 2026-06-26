"use client";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChartPosition } from "./LWChart";
import "@klinecharts/pro/dist/klinecharts-pro.css";

// Full KLineChart Pro widget (MIT) — the packaged pro UI from the reference:
// left drawing-tools rail, indicator manager, time zone, settings, screenshot,
// full screen, VOL + MACD sub-panes. Driven by a Datafeed adapter wired to our
// own /api/candles history + Socket.IO "tick" stream. Locale forced to en-US.

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

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
let _kcMod: Promise<any> | null = null;
const loadKc = () => (_kcMod || (_kcMod = import("klinecharts")));
let _proMod: Promise<any> | null = null;
const loadPro = () => (_proMod || (_proMod = import("@klinecharts/pro")));

let _ovReg: Promise<void> | null = null;
function ensureLevelOverlay() {
  if (!_ovReg) _ovReg = loadKc().then((kc: any) => {
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
            { type: "line", attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] }, styles: { color, style: "dashed", size: 1, dashedValue: [4, 3] } },
            { type: "text", ignoreEvent: true, attrs: { x: bounding.width - 6, y: c.y, text, align: "right", baseline: "middle" }, styles: { color: "#ffffff", backgroundColor: color, borderColor: color, borderSize: 1, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, size: 11, weight: "bold" } },
          ];
        },
      });
    } catch {}
  });
  return _ovReg;
}

export default function KLineProChart({ symbol, tf, theme, digits = 2, symbols, positions, bare, onSymbolChange, spreadPips }: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  symbols?: Sym[];
  positions?: ChartPosition[];
  bare?: boolean; // hide the period-bar + drawing-rail (preview); chart only
  onSymbolChange?: (sym: string) => void; // user picked a symbol in the chart dropdown
  spreadPips?: number; // total spread in pips for bid/ask overlay lines
}) {
  const onSymRef = useRef(onSymbolChange); onSymRef.current = onSymbolChange;
  const symbolsRef = useRef(symbols); symbolsRef.current = symbols; // always the current full list
  const elRef = useRef<HTMLDivElement | null>(null);
  const proRef = useRef<any>(null);
  const dfRef = useRef<any>(null);
  const overlayIds = useRef<string[]>([]);
  const coreRef = useRef<any>(null); // the REAL core klinecharts chart (reached via re-init)
  const bidAskIds = useRef<{ bid: string | null; ask: string | null }>({ bid: null, ask: null });
  const spreadPipsRef = useRef(spreadPips ?? 0); spreadPipsRef.current = spreadPips ?? 0;

  // build once
  useEffect(() => {
    let disposed = false;
    const list = symbols && symbols.length ? symbols : [{ symbol }];
    const subs: Record<string, Socket> = {};
    const lastBar: Record<string, any> = {};

    // Datafeed: history from /api/candles, realtime from Socket.IO ticks.
    const datafeed = {
      searchSymbols: async (search?: string) => {
        const q = (search || "").trim().toUpperCase();
        // Read the CURRENT full symbol list (not the mount-time snapshot), so
        // every symbol is searchable regardless of which one the chart opened on.
        const all = (symbolsRef.current && symbolsRef.current.length) ? symbolsRef.current : list;
        // Incremental filter: matches the typed characters anywhere in the symbol
        // OR its display name. Narrows further with each character.
        const hit = all.filter((s) => !q || s.symbol.toUpperCase().includes(q) || String(s.display || "").toUpperCase().includes(q));
        // Prefix matches first, then alphabetical — so "e" -> EURUSD before XAUEUR.
        hit.sort((a, b) => { const ap = a.symbol.toUpperCase().startsWith(q) ? 0 : 1, bp = b.symbol.toUpperCase().startsWith(q) ? 0 : 1; return ap !== bp ? ap - bp : a.symbol.localeCompare(b.symbol); });
        return hit.map((s) => ({ ticker: s.symbol, shortName: s.symbol, exchange: (s.category || "").toLowerCase(), pricePrecision: (typeof s.digits === "number" ? s.digits : digits), volumePrecision: 0, type: (s.category || "forex").toLowerCase() }));
      },
      getHistoryKLineData: async (sym: any, period: any, from: number, to: number) => {
        const key = sym.ticker + "_" + period.text;
        const ck = "cubex-kl:" + key;
        const toBar = (b: any) => ({ timestamp: b.time * 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });

        // Read localStorage cache (5-minute TTL)
        let cached: any[] | null = null;
        try {
          const c = JSON.parse(localStorage.getItem(ck) || "null");
          if (c && c.d?.length && Date.now() - c.t < 300000) cached = c.d;
        } catch {}

        // Fetch fresh if no cache
        if (!cached) {
          try {
            const r = await fetch(`/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${periodTf(period)}`, { cache: "no-store" }).then((x) => x.json());
            if (r?.ok && r.candles?.length) {
              const fresh: any[] = r.candles.map(toBar);
              cached = fresh;
              lastBar[key] = fresh[fresh.length - 1];
              try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: fresh })); } catch {}
            }
          } catch {}
        }
        if (!cached) return [];

        // Load more: user scrolled before our oldest candle — fetch an earlier batch
        const oldest = cached[0]?.timestamp;
        if (oldest && from < oldest) {
          try {
            const beforeSec = Math.floor(oldest / 1000);
            const r = await fetch(`/api/candles?symbol=${encodeURIComponent(sym.ticker)}&tf=${periodTf(period)}&before=${beforeSec}`, { cache: "no-store" }).then((x) => x.json());
            if (r?.ok && r.candles?.length) {
              const earlier = r.candles.map(toBar);
              // Merge and deduplicate by timestamp
              const seen = new Set<number>();
              const merged = [...earlier, ...cached].filter((d) => !seen.has(d.timestamp) && seen.add(d.timestamp));
              merged.sort((a, b) => a.timestamp - b.timestamp);
              cached = merged;
              lastBar[key] = cached[cached.length - 1];
              try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: cached })); } catch {}
            }
          } catch {}
        }

        lastBar[key] = cached[cached.length - 1];
        return cached.filter((d: any) => d.timestamp >= from && d.timestamp <= to);
      },
      subscribe: (sym: any, period: any, callback: (d: any) => void) => {
        try { onSymRef.current?.(sym.ticker); } catch {} // sync app when the user picks a symbol in the chart
        const key = sym.ticker + "_" + period.text;
        const sec = periodSec(period);
        const seed = lastBar[key];
        let last: any = seed && typeof seed.timestamp === "number" ? { ...seed } : null;
        const sock: Socket = io({ path: "/socket.io" });
        sock.on("tick", (msg: any) => {
          if (msg.symbol !== sym.ticker) return;
          // `price` = smooth display value (so the close / price-line crawls in
          // lock-step with Market Watch). `real` = the true feed price, folded into
          // the candle's high/low so the WICKS reflect the real market range.
          const price = msg.price;
          if (price == null) return;
          const real = msg.real != null ? msg.real : price;
          const t = Math.floor(Date.now() / 1000 / sec) * sec * 1000;
          if (last && last.timestamp === t) { last.high = Math.max(last.high, price, real); last.low = Math.min(last.low, price, real); last.close = price; }
          else {
            // Gap-fill any skipped buckets (e.g. the seam between delayed history
            // and live, or a brief stall) with flat bars so the chart never has
            // missing minutes / merged tall candles. Capped to avoid huge loops.
            if (last && t > last.timestamp + sec * 1000) {
              let ft = last.timestamp + sec * 1000; const c = last.close; let n = 0;
              while (ft < t && n < 400) { const flat = { timestamp: ft, open: c, high: c, low: c, close: c, volume: 0 }; callback(flat); last = flat; ft += sec * 1000; n++; }
            }
            // Continuous candles (forex/MT5/TradingView style): a new bar opens at
            // the previous bar's close, so colour reflects the real move, not the
            // gap to the first tick.
            const open = last ? last.close : price;
            last = { timestamp: t, open, high: Math.max(open, price, real), low: Math.min(open, price, real), close: price, volume: 0 };
          }
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

    loadPro().then(({ KLineChartPro }) => {
      if (disposed || !elRef.current) return;
      const first = list.find((s) => s.symbol === symbol) || list[0];
      proRef.current = new KLineChartPro({
        container: elRef.current,
        locale: "en-US",
        timezone: "Etc/UTC",
        theme,
        drawingBarVisible: !bare,
        styles: {
          candle: { tooltip: { showType: "rect", showRule: "follow_cross", rect: { position: "pointer" } } },
          // TradingView-style: right-side price axis is draggable for price zoom
          yAxis: { type: "normal", inside: false, position: "right" },
          crosshair: { show: true },
          grid: { horizontal: { show: true, style: "dashed" }, vertical: { show: false } },
        } as any,
        symbol: { ticker: first.symbol, shortName: first.symbol, pricePrecision: digits, volumePrecision: 0, type: "forex" },
        period: tfToPeriod(tf),
        periods: PERIODS,
        mainIndicators: [],
        subIndicators: [],
        datafeed: datafeed as any,
      });
      // Get the core klinecharts instance from Pro's getChart() — the proper API,
      const applyTouchAction = () => {
        try {
          const container = elRef.current;
          if (!container) return;
          // Set touch-action:none on every element so the browser never intercepts
          // single-finger scroll or pinch-zoom before klinecharts handles it.
          container.querySelectorAll("*").forEach((el) => {
            const h = el as HTMLElement;
            if (h.style) h.style.touchAction = "none";
          });
        } catch {}
      };

      const enableInteraction = (attempt = 0) => {
        if (disposed) return;
        // Try Pro's getChart() (v0.2+) then fall back to kc.init(host) which is
        // idempotent in klinecharts v9 — returns the existing instance, not a new one.
        let core: any = null;
        try { core = proRef.current?.getChart?.() ?? proRef.current?.chart; } catch {}
        if (!core) {
          loadKc().then((kc: any) => {
            const host = elRef.current?.querySelector("[k-line-chart-id]") as HTMLElement | null;
            if (host) {
              // klinecharts stores instances by html id (not by element ref);
              // it sets k-line-chart-id attr but never sets html id — so we must.
              const klineId = host.getAttribute("k-line-chart-id");
              if (klineId) host.id = klineId;
              try { core = kc.init(host); } catch {}
            }
            if (core) {
              coreRef.current = core;
              try { core.setScrollEnabled(true); core.setZoomEnabled(true); core.setBarSpace(8); core.setOffsetRightDistance(50); core.resize(); } catch {}
              applyTouchAction();
            } else if (attempt < 20) {
              setTimeout(() => enableInteraction(attempt + 1), 200);
            } else {
              // Even without core, at least force touch-action so canvas responds
              applyTouchAction();
            }
          });
          return;
        }
        coreRef.current = core;
        try { core.setScrollEnabled(true); core.setZoomEnabled(true); core.setBarSpace(8); core.setOffsetRightDistance(50); core.resize(); } catch {}
        applyTouchAction();
      };
      setTimeout(() => enableInteraction(), 500);
    });

    return () => {
      disposed = true;
      for (const k of Object.keys(subs)) { try { subs[k].disconnect(); } catch {} }
      try { if (elRef.current) elRef.current.innerHTML = ""; } catch {}
      proRef.current = null;
      coreRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reach the REAL core klinecharts chart that Pro draws with — Pro tags its
  // element with `k-line-chart-id` and init() is idempotent, so re-init returns
  // the same instance (full API: createOverlay, resize, …).
  const getCore = useCallback(async () => {
    if (coreRef.current) return coreRef.current;
    // Try Pro's public API first (v0.2+), then fall back to kc.init(host).
    // kc.init is idempotent in klinecharts v9: if the element is already
    // initialised it returns the existing instance — it does NOT create a second chart.
    try {
      const c = proRef.current?.getChart?.() ?? proRef.current?.chart;
      if (c) { coreRef.current = c; return c; }
    } catch {}
    const kc: any = await loadKc();
    const host = elRef.current?.querySelector("[k-line-chart-id]") as HTMLElement | null;
    if (host) {
      const klineId = host.getAttribute("k-line-chart-id");
      if (klineId) host.id = klineId;
      try {
        const core = kc.init(host);
        if (core) { coreRef.current = core; return core; }
      } catch {}
    }
    return coreRef.current;
  }, []);

  // Mobile chart panning: the ONLY correct fix for Chrome PWA + iOS Safari is
  // touch-action:none via CSS — applied to every element klinecharts creates.
  // Do NOT call preventDefault() on touchstart: Chrome derives Pointer Events from
  // Touch Events, so preventing touchstart default suppresses pointerdown/pointermove
  // which klinecharts uses for drag/pan. CSS touch-action is evaluated before any
  // JS fires and tells the browser to hand ALL touch gestures to JS instead of
  // scrolling the page.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // Set touch-action:none as inline style on every element including canvases
    // created dynamically by klinecharts after init.
    const patch = (node: Element) => {
      if ((node as HTMLElement).style) (node as HTMLElement).style.touchAction = "none";
      node.querySelectorAll<HTMLElement>("*").forEach((h) => { if (h.style) h.style.touchAction = "none"; });
    };
    patch(el);
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) m.addedNodes.forEach((n) => { if (n.nodeType === 1) patch(n as Element); });
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // Force the core chart to resize whenever our container box changes (panels /
  // toolbox dragged) — Pro's internal observer doesn't always fire.
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { getCore().then((c) => { if (c && typeof c.resize === "function") { try { c.resize(); } catch {} } }); });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [getCore]);

  // Pre-warm: after the current chart paints, quietly fetch a few other symbols'
  // candles for this timeframe so switching to them is instant (warms the 20s
  // server cache + browser cache). Throttled + delayed to spare the data quota.
  useEffect(() => {
    const t = setTimeout(() => {
      const others = (symbolsRef.current || []).map((s) => s.symbol).filter((s) => s && s !== symbol).slice(0, 8);
      for (const sym of others) { fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&tf=${tf}`).catch(() => {}); }
    }, 2000);
    return () => clearTimeout(t);
  }, [tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // theme sync (no rebuild)
  useEffect(() => { try { proRef.current?.setTheme(theme); } catch {} }, [theme]);
  // follow the app's symbol selection (skip if the chart already shows it, so a
  // dropdown pick in the chart doesn't bounce back)
  useEffect(() => {
    try {
      const cur = proRef.current?.getSymbol?.()?.ticker;
      if (proRef.current && symbol && cur !== symbol) proRef.current.setSymbol({ ticker: symbol, shortName: symbol, pricePrecision: digits, volumePrecision: 0, type: "forex" });
    } catch {}
  }, [symbol, digits]);

  // Trade overlays (entry / SL / TP / pending) drawn on the REAL core chart.
  // Pro doesn't expose its chart, but klinecharts tags the chart element with a
  // `k-line-chart-id` attribute and init() is idempotent — so re-init on that
  // element returns the existing core instance (full access: createOverlay etc.).
  useEffect(() => {
    let tries = 0, cancelled = false;
    const draw = async () => {
      if (cancelled) return;
      const core = await getCore();
      if (!core || typeof core.createOverlay !== "function") { if (tries++ < 80) setTimeout(draw, 150); return; }
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
  }, [positions, symbol, getCore]);

  // Bid/Ask price lines — live socket listener updates them on every tick.
  useEffect(() => {
    // Clean up any overlays from a previous effect run before resetting IDs
    (async () => {
      const core = await getCore();
      if (core) {
        if (bidAskIds.current.bid) try { core.removeOverlay(bidAskIds.current.bid); } catch {}
        if (bidAskIds.current.ask) try { core.removeOverlay(bidAskIds.current.ask); } catch {}
      }
    })();
    bidAskIds.current = { bid: null, ask: null };

    const sock: any = io({ path: "/socket.io" });
    const symRef = { current: symbol };
    let lastRealBid: number | null = null;
    const updateLines = async (ask: number, tickBid?: number | null) => {
      const core = await getCore();
      if (!core || typeof core.createOverlay !== "function") return;
      // Prefer: real bid from LP (Binance/Kraken), then admin-spread calc, then no gap
      if (tickBid != null && tickBid > 0 && tickBid < ask) lastRealBid = tickBid;
      const spPips = spreadPipsRef.current;
      const spPx = spPips * Math.pow(10, -(digits - 1));
      const bid = lastRealBid != null && spPips === 0 ? lastRealBid : ask - spPx;
      let ts: number | undefined;
      try { const dl = core.getDataList?.() || []; if (dl.length) ts = dl[dl.length - 1].timestamp; } catch {}
      const upsert = (ref: "bid" | "ask", price: number, color: string, label: string) => {
        const id = bidAskIds.current[ref];
        if (id) {
          try {
            core.overrideOverlay({ id, points: [{ timestamp: ts, value: price }], extendData: { color, text: label } });
            return; // updated in place — done
          } catch {
            // stale ID — remove the ghost overlay then fall through to create fresh
            try { core.removeOverlay(id); } catch {}
            bidAskIds.current[ref] = null;
          }
        }
        try {
          const newId = core.createOverlay({ name: "cubexLevel", points: [{ timestamp: ts, value: price }], lock: true, extendData: { color, text: label } });
          if (typeof newId === "string") bidAskIds.current[ref] = newId;
        } catch {}
      };
      upsert("ask", ask, "#26a69a", `Ask ${ask.toFixed(digits)}`);
      upsert("bid", bid, "#ef5350", `Bid ${bid.toFixed(digits)}`);
    };
    sock.on("tick", ({ symbol: sym, price, bid }: any) => { if (sym === symRef.current && price != null) updateLines(price, bid); });
    return () => { sock.disconnect(); };
  }, [symbol, digits, getCore]);

  // Absolutely fill the (relative) parent so the widget always matches the
  // container box and shrinks/grows when panels are dragged — core klinecharts
  // has its own ResizeObserver, so it re-renders once the box changes.
  return (
    <>
      {/* Force touch-action:none on every element klinecharts-pro renders inside
          our container (canvas, overlay divs, axis areas). Without this, the
          browser intercepts pinch-zoom and single-finger swipe on the chart's
          inner canvas before klinecharts sees the touch events. */}
      <style>{`
        /* klinecharts-pro hardcodes height:80vh — override so the chart fills our container */
        .kline-chart-pro-wrap .klinecharts-pro { height: 100% !important; }
        /* In bare mode hide the period bar and expand content area to full height */
        .kline-bare .klinecharts-pro-period-bar { display: none !important; }
        .kline-bare .klinecharts-pro-content { height: 100% !important; }
        /* Prevent browser from claiming touch events before klinecharts handles them */
        .kline-chart-pro-wrap, .kline-chart-pro-wrap *,
        .klinecharts-pro, .klinecharts-pro *,
        [k-line-chart-id], [k-line-chart-id] * { touch-action: none !important; }
      `}</style>
      <div ref={elRef} className={`kline-chart-pro-wrap${bare ? " kline-bare" : ""}`} style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none" }} />
    </>
  );
}
