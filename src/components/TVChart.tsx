"use client";
import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type TVChartActions = {
  openIndicators: () => void;
  setChartType: (type: number) => void;
};

export type ChartPosition = {
  id: string;
  ticket?: string | number;
  type: "BUY" | "SELL";
  lots: number | string;
  openPrice: number;
  sl?: number;
  tp?: number;
  pnl?: number;
  kind?: string;
};

type Sym = { symbol: string; category?: string; digits?: number; display?: string };

// ─── Resolution mapping ───────────────────────────────────────────────────────
const TF_TO_TV: Record<string, string> = {
  "1M": "1", "5M": "5", "15M": "15", "30M": "30",
  "1H": "60", "4H": "240", "1D": "1D", "1W": "1W",
};
const TV_TO_TF: Record<string, string> = Object.fromEntries(
  Object.entries(TF_TO_TV).map(([k, v]) => [v, k])
);
const tvRes = (tf: string) => TF_TO_TV[tf] || "1";
const resSecond = (res: string) => {
  if (res === "1D") return 86400;
  if (res === "1W") return 604800;
  return (parseInt(res) || 1) * 60;
};

// ─── Single script load ────────────────────────────────────────────────────────
let _scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if ((window as any).TradingView?.widget) return Promise.resolve();
  if (!_scriptPromise) {
    _scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/charting_library/charting_library.js";
      s.onload = () => resolve();
      s.onerror = () => { _scriptPromise = null; reject(new Error("charting_library failed to load")); };
      document.head.appendChild(s);
    });
  }
  return _scriptPromise;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TVChart({
  symbol, tf, theme, digits = 5,
  positions, symbols, bare, showDrawingTools, chartType, onSymbolChange, onCandleUpdate, onActionsReady, spreadPips, onFullscreenRequest, showBuiltinOHLC,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  positions?: ChartPosition[];
  symbols?: Sym[];
  bare?: boolean;
  showDrawingTools?: boolean;
  chartType?: number;
  onSymbolChange?: (sym: string) => void;
  onCandleUpdate?: (bar: { open: number; high: number; low: number; close: number }) => void;
  onActionsReady?: (actions: TVChartActions) => void;
  spreadPips?: number;
  /** When provided: replaces TV's native fullscreen button with a custom one that fires this callback. Use for CSS fullscreen on iOS where requestFullscreen() is unsupported. */
  onFullscreenRequest?: () => void;
  /** When false: hides TV's native OHLC legend (use when the parent renders its own OHLC overlay). Default: true. */
  showBuiltinOHLC?: boolean;
}) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const widgetRef      = useRef<any>(null);
  const socketRef      = useRef<Socket | null>(null);
  const lastBarRef     = useRef<Bar | null>(null);
  const realtimeCbRef  = useRef<((bar: Bar) => void) | null>(null);
  const linesRef       = useRef<any[]>([]);
  const isReadyRef     = useRef(false);
  const symbolsRef     = useRef(symbols); symbolsRef.current = symbols;
  const symbolRef      = useRef(symbol);   // tracks current platform symbol — used to revert TV-native searches
  const onSymRef       = useRef(onSymbolChange); onSymRef.current = onSymbolChange;
  const onCandleRef       = useRef(onCandleUpdate); onCandleRef.current = onCandleUpdate;
  const onActionsReadyRef = useRef(onActionsReady); onActionsReadyRef.current = onActionsReady;
  const onFullscreenReqRef = useRef(onFullscreenRequest); onFullscreenReqRef.current = onFullscreenRequest;
  const showBuiltinOHLCRef = useRef(showBuiltinOHLC); showBuiltinOHLCRef.current = showBuiltinOHLC;
  const chartTypeRef      = useRef(chartType);
  const spreadRef      = useRef(spreadPips ?? 0); spreadRef.current = spreadPips ?? 0;
  const digitsRef      = useRef(digits); digitsRef.current = digits;
  const positionsRef   = useRef(positions); positionsRef.current = positions;
  const allBarsRef     = useRef<Bar[]>([]);
  const ohlcOverlayRef = useRef<HTMLDivElement | null>(null);
  const mousePosRef    = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const bareRef        = useRef(bare); bareRef.current = bare;

  // Debounce coalesces rapid price-tick renders; version counter discards stale callbacks.
  const drawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawSeqRef   = useRef(0);
  const drawRef      = useRef<() => void>(() => {});
  drawRef.current = () => {
    if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
    drawTimerRef.current = setTimeout(async () => {
      drawTimerRef.current = null;
      const seq = ++drawSeqRef.current;
      const w = widgetRef.current; if (!w || !isReadyRef.current) return;
      try {
        const chart = w.activeChart();

        // Cleanup previous lines (position-line adapters have .remove(); shapes use entity id)
        const old = [...linesRef.current];
        linesRef.current = [];
        for (const l of old) {
          try {
            if (typeof l?.remove === "function") l.remove();
            else if (l?.id != null) chart.removeEntity(l.id);
          } catch {}
        }

        const dg  = digitsRef.current;
        const fmt = (v: number) => v.toFixed(dg);
        const anchorSec = lastBarRef.current
          ? Math.floor(lastBarRef.current.time / 1000)
          : Math.floor(Date.now() / 1000);

        // createShape — fallback for ask spread line and when createPositionLine fails
        const addShape = async (price: number, ovr: Record<string, any>) => {
          try {
            const raw = chart.createShape({ time: anchorSec, price }, {
              shape: "horizontal_line", lock: true, disableSave: true,
              showInObjectsTree: false, overrides: ovr,
            });
            const id: any = (raw && typeof (raw as any).then === "function") ? await raw : raw;
            if (id == null) return;
            if (drawSeqRef.current === seq) linesRef.current.push({ id });
            else try { chart.removeEntity(id); } catch {}
          } catch {}
        };

        // Colored filled label box near price axis — createPositionLine gives a native TV
        // colored body box (matching LW chart's createPriceLine style). Empty quantity hides
        // the left MT5-style box. Falls back to addShape if createPositionLine is unavailable.
        const makeLine = async (
          price: number, body: string, lineColor: string, bg: string, lineStyle: number, lineWidth: number,
        ) => {
          try {
            const raw = (chart as any).createPositionLine?.();
            if (raw == null) throw new Error("n/a");
            const pl: any = (raw && typeof (raw as any).then === "function") ? await raw : raw;
            if (!pl?.setPrice) throw new Error("invalid");
            if (drawSeqRef.current !== seq) { try { pl.remove(); } catch {}; return; }
            pl.setPrice(price)
              .setQuantity("")
              .setQuantityBackgroundColor("transparent")
              .setQuantityTextColor("transparent")
              .setQuantityBorderColor("transparent")
              .setText(body)
              .setBodyBackgroundColor(bg)
              .setBodyTextColor("#fff")
              .setBodyBorderColor(bg)
              .setLineColor(lineColor)
              .setLineStyle(lineStyle)
              .setLineWidth(lineWidth);
            try { (pl as any).setLineLength?.(0); } catch {}
            try { (pl as any).setExtendLeft?.(true); } catch {}
            linesRef.current.push({ remove: () => { try { pl.remove(); } catch {} } });
          } catch {
            await addShape(price, {
              linecolor: lineColor, linewidth: lineWidth, linestyle: lineStyle,
              showLabel: true, text: body, textcolor: "#fff",
              fillBackground: true, backgroundColor: bg, backgroundTransparency: 0,
              horzLabelsAlign: "right",
            });
          }
        };

        for (const p of positionsRef.current || []) {
          if (drawSeqRef.current !== seq) return;
          const isBuy  = p.type === "BUY";
          const isPend = !!p.kind;
          const color  = isPend ? "#f59e0b" : (isBuy ? "#2962ff" : "#f23645");
          const tkt   = p.ticket != null ? String(p.ticket) : "";
          const priceStr = fmt(p.openPrice);
          const label = !isPend && tkt
            ? `#${p.type} ${tkt}  ${priceStr}`
            : `${p.kind ? p.kind + " " : ""}${p.type} ${Number(p.lots).toFixed(2)}  ${priceStr}`;

          await makeLine(p.openPrice, label, color, color, isPend ? 2 : 0, isPend ? 1 : 2);
          if (p.sl && p.sl > 0)
            await makeLine(p.sl, `SL  ${fmt(p.sl)}`, "#f43f5e", "#f43f5e", 2, 1);
          if (p.tp && p.tp > 0)
            await makeLine(p.tp, `TP  ${fmt(p.tp)}`, "#10b981", "#10b981", 2, 1);
        }

        // Ask spread line — teal dotted, minimal label so it doesn't crowd position labels
        if (spreadRef.current > 0 && lastBarRef.current && drawSeqRef.current === seq) {
          const spPips   = Math.round(spreadRef.current * 100) / 100;
          const askPrice = lastBarRef.current.close + spPips * Math.pow(10, -dg);
          await addShape(askPrice, {
            linecolor: "#26a69a", linewidth: 1, linestyle: 1,
            showLabel: true, text: `Ask  ${fmt(askPrice)}`, textcolor: "#26a69a",
            fillBackground: false, backgroundTransparency: 100,
            horzLabelsAlign: "right",
          });
        }
      } catch {}
    }, 150);
  };

  // ── Build and mount the widget (once per mount) ──────────────────────────────
  const buildWidget = useCallback(() => {
    if (!containerRef.current || widgetRef.current) return;

    const allSymbols = () => symbolsRef.current || [];

    const datafeed = {
      onReady(cb: (cfg: any) => void) {
        setTimeout(() => cb({
          supported_resolutions: ["1", "5", "15", "30", "60", "240", "1D", "1W"],
          supports_marks: false, supports_timescale_marks: false, supports_time: false,
        }), 0);
      },

      searchSymbols(query: string, _ex: string, _type: string, onResult: (r: any[]) => void) {
        const q = query.toLowerCase();
        onResult(
          allSymbols()
            .filter((s) => !q || s.symbol.toLowerCase().includes(q) || (s.display || "").toLowerCase().includes(q))
            .slice(0, 30)
            .map((s) => ({
              symbol: s.symbol, full_name: s.symbol, ticker: s.symbol,
              description: s.display || s.symbol, exchange: "", type: s.category || "forex",
            }))
        );
      },

      resolveSymbol(name: string, onResolve: (info: any) => void, _onErr: (e: string) => void) {
        const sym = allSymbols().find((s) => s.symbol === name);
        const dg  = sym?.digits ?? digits;
        setTimeout(() => onResolve({
          name, full_name: name, ticker: name, exchange: "",
          description: "​",
          type: sym?.category || "forex",
          session: "24x7", timezone: "Etc/UTC",
          minmov: 1, pricescale: Math.pow(10, dg),
          has_intraday: true, has_daily: true, has_weekly_and_monthly: true,
          supported_resolutions: ["1", "5", "15", "30", "60", "240", "1D", "1W"],
          volume_precision: 0, data_status: "streaming",
        }), 0);
      },

      async getBars(
        symbolInfo: any, resolution: string,
        { from, to, firstDataRequest }: { from: number; to: number; firstDataRequest: boolean },
        onHistory: (bars: Bar[], meta: { noData: boolean }) => void,
        onError: (e: string) => void,
      ) {
        const tf = TV_TO_TF[resolution] || "1M";
        // Use larger limits for slower timeframes to cover ~1 year of history
        const limit = firstDataRequest
          ? (["1D","1W"].includes(tf) ? 2000 : ["4H","1H"].includes(tf) ? 2000 : 2000)
          : 2000;
        const beforeParam = firstDataRequest ? "" : `&before=${to}`;
        try {
          const d = await fetch(
            `/api/candles?symbol=${encodeURIComponent(symbolInfo.name)}&tf=${tf}&limit=${limit}${beforeParam}`,
            { cache: "no-store" }
          ).then((r) => r.json());
          if (!d.ok || !Array.isArray(d.candles) || !d.candles.length) {
            onHistory([], { noData: true }); return;
          }
          const mapped = d.candles.map((c: any) => ({
            time: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
          }));
          // On first request return everything — TV handles scroll; on page requests filter to range
          const bars: Bar[] = firstDataRequest
            ? mapped
            : mapped.filter((b: Bar) => b.time >= from * 1000 && b.time <= to * 1000);
          if (bars.length) {
            lastBarRef.current = bars[bars.length - 1];
            const lb = lastBarRef.current;
            onCandleRef.current?.({ open: lb.open, high: lb.high, low: lb.low, close: lb.close });
            // Accumulate for hover OHLC tooltip
            if (firstDataRequest) allBarsRef.current = [...bars];
            else {
              const ex = new Set(allBarsRef.current.map((b) => b.time));
              const older = bars.filter((b) => !ex.has(b.time));
              if (older.length) allBarsRef.current = [...older, ...allBarsRef.current];
            }
          }
          onHistory(bars, { noData: bars.length === 0 });
        } catch (e: any) { onError(e.message || "candles fetch failed"); }
      },

      subscribeBars(
        symbolInfo: any, resolution: string,
        onRealtimeCallback: (bar: Bar) => void,
        _uid: string, _onReset: () => void,
      ) {
        realtimeCbRef.current = onRealtimeCallback;
        if (socketRef.current) socketRef.current.disconnect();
        const sock = io({ path: "/socket.io" });
        socketRef.current = sock;
        const sec = resSecond(resolution);

        sock.on("tick", ({ symbol: sym, price, real }: any) => {
          if (sym !== symbolInfo.name || price == null) return;
          const cb = realtimeCbRef.current; if (!cb) return;
          // Spike filter: reject any tick that moves >2% from the last close.
          // Bad feed ticks (e.g. a zero or extreme outlier) permanently stretch
          // the candle's high/low, causing huge wicks. 5% catches bad data while
          // allowing legitimate sharp moves in crypto.
          if (lastBarRef.current && lastBarRef.current.close > 0) {
            if (Math.abs(price - lastBarRef.current.close) / lastBarRef.current.close > 0.02) return;
          }
          const truePrice = real ?? price;
          const barTimeMs = Math.floor(Date.now() / 1000 / sec) * sec * 1000;

          if (lastBarRef.current && lastBarRef.current.time === barTimeMs) {
            const updated: Bar = {
              ...lastBarRef.current,
              high: Math.max(lastBarRef.current.high, price, truePrice),
              low:  Math.min(lastBarRef.current.low,  price, truePrice),
              close: price,
            };
            lastBarRef.current = updated;
            cb(updated);
            onCandleRef.current?.({ open: updated.open, high: updated.high, low: updated.low, close: updated.close });
            const la = allBarsRef.current, lb = la[la.length - 1];
            if (lb && lb.time === barTimeMs) { lb.high = updated.high; lb.low = updated.low; lb.close = updated.close; }
          } else {
            const open = lastBarRef.current?.close ?? price;
            const newBar: Bar = {
              time: barTimeMs, open,
              high: Math.max(open, price, truePrice),
              low:  Math.min(open, price, truePrice),
              close: price, volume: 0,
            };
            lastBarRef.current = newBar;
            cb(newBar);
            onCandleRef.current?.({ open: newBar.open, high: newBar.high, low: newBar.low, close: newBar.close });
            allBarsRef.current.push({ ...newBar });
          }
        });
      },

      unsubscribeBars(_uid: string) {
        realtimeCbRef.current = null;
        if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      },
    };

    const disabledFeatures: string[] = [
      "display_market_status",              // forex is 24/7; "market closed" banner would be misleading
      "create_volume_indicator_by_default", // volume is meaningless for OTC forex; keep sub-pane clean
      "popup_hints",                        // suppress long-press tooltip popup on mobile
      "timeframes_toolbar",                 // hide the bottom period quick-select bar (5y 1y 3m …)
      "header_undo_redo",                   // remove just the undo/redo arrows; full header stays
      // NOTE: tradingview_logo intentionally NOT disabled — the charting library
      // license requires TradingView branding to remain visible.
    ];
    // When parent supplies onFullscreenRequest, replace TV's native fullscreen button (which
    // uses requestFullscreen() and fails silently on iOS Safari) with our own button.
    if (onFullscreenReqRef.current) disabledFeatures.push("header_fullscreen_button");
    if (bare) {
      disabledFeatures.push("header_toolbar", "header_indicators", "header_chart_type", "header_resolutions");
      if (!showDrawingTools) disabledFeatures.push("left_toolbar");
    }

    const widget = new (window as any).TradingView.widget({
      container: containerRef.current!,
      library_path: "/charting_library/",
      datafeed,
      symbol,
      interval: tvRes(tf),
      theme:    theme === "dark" ? "Dark" : "Light",
      locale:   "en",
      timezone: "Etc/UTC",
      autosize:   true,
      fullscreen: false,
      toolbar_bg: theme === "dark" ? "#0f1117" : "#f0f3fa",
      overrides: (() => {
        const ohlcOn = showBuiltinOHLCRef.current !== false;
        const base = theme === "dark"
          ? { "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.04)", "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.04)" }
          : { "paneProperties.vertGridProperties.color": "rgba(0,0,0,0.04)", "paneProperties.horzGridProperties.color": "rgba(0,0,0,0.04)" };
        return { ...base, "paneProperties.legendProperties.showSeriesTitle": false, "paneProperties.legendProperties.showSeriesOHLC": ohlcOn, "paneProperties.legendProperties.showBarChange": ohlcOn };
      })(),
      disabled_features: disabledFeatures,
      enabled_features:  ["side_toolbar_in_fullscreen_mode", "header_in_fullscreen_mode", "items_favoriting"],
    });

    widgetRef.current = widget;

    // TV v32 changed chartReady() from accepting a callback to returning a Promise.
    // Calling widget.chartReady(cb) in v32 silently ignores cb — must use .then().
    const readyCb = () => {
      isReadyRef.current = true;

      // Force-suppress TV native OHLC legend after chart is ready (creation-time overrides can be reset by TV)
      if (showBuiltinOHLCRef.current === false) {
        try {
          widget.applyOverrides({
            "paneProperties.legendProperties.showSeriesOHLC": false,
            "paneProperties.legendProperties.showBarChange": false,
            "paneProperties.legendProperties.showSeriesTitle": false,
          });
        } catch {}
      }

      // Remove any Volume sub-pane (belt-and-suspenders alongside the disabled_feature)
      try {
        const chart = widget.activeChart();
        for (const s of chart.getAllStudies()) {
          if (s.name?.toLowerCase().includes("volume")) chart.removeEntity(s.id);
        }
      } catch {}

      // Show all loaded historical candles on first data load, then redraw position lines.
      try {
        widget.activeChart().onDataLoaded().subscribe(null, () => {
          try { widget.activeChart().executeActionById("timeScaleReset"); } catch {}
          drawRef.current();
        });
      } catch {}

      drawRef.current(); // initial draw

      // Floating OHLC box shown at crosshair position on hover (TV native legend is disabled)
      try {
        widget.activeChart().crosshairMoved().subscribe(null, (param: any) => {
          const el = ohlcOverlayRef.current; if (!el) return;
          if (!param?.time) { el.style.display = "none"; return; }
          const tRaw = Number(param.time);
          // Normalize both to seconds before comparing (TV gives seconds; bars stored in ms)
          const tSec = tRaw > 1e10 ? Math.floor(tRaw / 1000) : tRaw;
          const bar = allBarsRef.current.find((b) => {
            const bSec = b.time > 1e10 ? Math.floor(b.time / 1000) : b.time;
            return bSec === tSec;
          });
          if (!bar) { el.style.display = "none"; return; }
          const dg = digitsRef.current;
          const fP = (v: number) => v.toFixed(dg);
          const ms = bar.time > 1e11 ? bar.time : bar.time * 1000;
          const dt = new Date(ms);
          const ds = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")} ${String(dt.getUTCHours()).padStart(2,"0")}:${String(dt.getUTCMinutes()).padStart(2,"0")}`;
          const isUp = bar.close >= bar.open;
          const pc = isUp ? "#26a69a" : "#ef5350";
          el.innerHTML =
            `<div style="color:${pc};font-weight:700;margin-bottom:5px;font-size:10px">${ds}</div>` +
            `<div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;font-size:10px">` +
            `<span style="opacity:.55">Open:</span><span style="color:${pc}">${fP(bar.open)}</span>` +
            `<span style="opacity:.55">High:</span><span style="color:${pc}">${fP(bar.high)}</span>` +
            `<span style="opacity:.55">Low:</span><span style="color:${pc}">${fP(bar.low)}</span>` +
            `<span style="opacity:.55">Close:</span><span style="color:${pc}">${fP(bar.close)}</span>` +
            `</div>`;
          const cont = el.parentElement;
          const cw = cont ? cont.clientWidth : 500, ch = cont ? cont.clientHeight : 500;
          const TW = 172, TH = 92;
          // Use actual DOM mouse position (tracked via onMouseMove on the wrapper) — avoids
          // the brittle header/toolbar offset calculation from param.point.
          const cx = mousePosRef.current.x, cy = mousePosRef.current.y;
          const x = cx + 14 + TW > cw ? Math.max(0, cx - TW - 8) : cx + 14;
          const y = cy + 10 + TH > ch ? Math.max(0, cy - TH - 6) : cy + 10;
          el.style.left = x + "px"; el.style.top = y + "px"; el.style.display = "block";
        });
      } catch {}

      try {
        widget.activeChart().onSymbolChanged().subscribe(null, () => {
          try {
            const tvSym = widget.activeChart().symbol();
            if (tvSym !== symbolRef.current) {
              // TV native symbol search changed the symbol — propagate to platform.
              symbolRef.current = tvSym;
              onSymRef.current?.(tvSym);
            }
          } catch {}
        });
      } catch {}

      // Apply initial chart type if provided
      if (chartTypeRef.current !== undefined) {
        try { widget.activeChart().setChartType(chartTypeRef.current); } catch {}
      }

      // Custom fullscreen button — replaces the disabled native one; works on iOS Safari.
      if (onFullscreenReqRef.current) {
        try {
          const btn = widget.createButton({ align: "right" });
          btn.setAttribute("title", "Fullscreen");
          btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:28px;height:28px;cursor:pointer;";
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
          btn.addEventListener("click", () => onFullscreenReqRef.current?.());
        } catch {}
      }

      // Expose actions to parent (admin toolbar "Indicators" button + candle type dropdown)
      onActionsReadyRef.current?.({
        openIndicators: () => {
          try { widget.executeActionById("insertIndicator"); } catch {}
        },
        setChartType: (type: number) => {
          chartTypeRef.current = type;
          try { widget.activeChart().setChartType(type); } catch {}
        },
      });
    };
    // v32+: chartReady() returns Promise and ignores arguments
    // older: onChartReady(cb) accepts a callback
    try {
      const p = widget.chartReady?.();
      if (p && typeof p.then === "function") { p.then(readyCb).catch(() => {}); }
      else { widget.onChartReady?.(readyCb); }
    } catch { widget.onChartReady?.(readyCb); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mount / unmount ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => { if (!cancelled) buildWidget(); }).catch(() => {});
    return () => {
      cancelled = true;
      isReadyRef.current = false;
      realtimeCbRef.current = null;
      for (const l of linesRef.current) { try { l.remove(); } catch {} }
      linesRef.current = [];
      if (socketRef.current)  { socketRef.current.disconnect();  socketRef.current  = null; }
      if (widgetRef.current)  { try { widgetRef.current.remove(); } catch {}; widgetRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Symbol change ────────────────────────────────────────────────────────────
  useEffect(() => {
    const w = widgetRef.current; if (!w || !symbol) return;
    symbolRef.current = symbol; // update before setSymbol so onSymbolChanged sees it as a programmatic change
    const apply = () => {
      try {
        const chart = w.activeChart();
        if (chart.symbol() !== symbol) chart.setSymbol(symbol, () => {});
      } catch {}
    };
    // Chart is already ready (isReadyRef set in readyCb) — call immediately.
    // v32: chartReady() returns a Promise and ignores any argument passed to it,
    // so we must NOT pass apply as an argument when the chart is ready.
    if (isReadyRef.current) { apply(); return; }
    try {
      const p = w.chartReady?.();
      if (p && typeof p.then === "function") { p.then(apply).catch(() => {}); }
      else { w.onChartReady?.(apply); }
    } catch { apply(); }
  }, [symbol]);

  // ── Timeframe change ─────────────────────────────────────────────────────────
  useEffect(() => {
    const w = widgetRef.current; if (!w || !tf) return;
    try { w.activeChart().setResolution(tvRes(tf), () => {}); } catch {}
  }, [tf]);

  // ── Theme change ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const w = widgetRef.current; if (!w) return;
    const tvTheme = theme === "dark" ? "Dark" : "Light";
    const gridColors = theme === "dark"
      ? { "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.04)", "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.04)" }
      : { "paneProperties.vertGridProperties.color": "rgba(0,0,0,0.04)", "paneProperties.horzGridProperties.color": "rgba(0,0,0,0.04)" };
    const applyOvr = () => { try { w.applyOverrides(gridColors); } catch {} };
    try {
      const p = (w as any).changeTheme(tvTheme);
      if (p && typeof p.then === "function") p.then(applyOvr).catch(applyOvr);
      else applyOvr();
    } catch { applyOvr(); }
  }, [theme]);

  // ── Position / SL / TP / spread lines (MT5 style) ───────────────────────────
  useEffect(() => {
    if (isReadyRef.current) drawRef.current();
  }, [positions, symbol, digits, spreadPips]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      onMouseMove={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        mousePosRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => { if (ohlcOverlayRef.current) ohlcOverlayRef.current.style.display = "none"; }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={ohlcOverlayRef} style={{
        display: "none", position: "absolute", pointerEvents: "none", zIndex: 10,
        background: "rgba(13,17,28,0.9)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6, padding: "7px 10px", fontFamily: "monospace",
        color: "#e7ecf3", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)", minWidth: 148,
      }} />
    </div>
  );
}
