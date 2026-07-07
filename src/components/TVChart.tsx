"use client";
import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

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
  positions, symbols, bare, showDrawingTools, onSymbolChange, spreadPips,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  positions?: ChartPosition[];
  symbols?: Sym[];
  bare?: boolean;
  showDrawingTools?: boolean;
  onSymbolChange?: (sym: string) => void;
  spreadPips?: number;
}) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const widgetRef      = useRef<any>(null);
  const socketRef      = useRef<Socket | null>(null);
  const lastBarRef     = useRef<Bar | null>(null);
  const realtimeCbRef  = useRef<((bar: Bar) => void) | null>(null);
  const linesRef       = useRef<any[]>([]);
  const isReadyRef     = useRef(false);
  const symbolsRef     = useRef(symbols); symbolsRef.current = symbols;
  const onSymRef       = useRef(onSymbolChange); onSymRef.current = onSymbolChange;
  const spreadRef      = useRef(spreadPips ?? 0); spreadRef.current = spreadPips ?? 0;
  const digitsRef      = useRef(digits); digitsRef.current = digits;
  const positionsRef   = useRef(positions); positionsRef.current = positions;

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
        // Anchor shapes at the last loaded bar so they fall within the chart's
        // data range. Using Date.now() can place the anchor in the empty
        // "future" zone past the last bar, making lines invisible in some TV builds.
        const anchorSec = lastBarRef.current
          ? Math.floor(lastBarRef.current.time / 1000)  // lastBarRef stores ms
          : Math.floor(Date.now() / 1000);

        // createShape — always available in Free Advanced Charts (horizontal line + label)
        const addShape = async (price: number, ovr: Record<string, any>) => {
          try {
            const raw = chart.createShape({ time: anchorSec, price }, {
              shape: "horizontal_line", lock: true, disableSave: true,
              showInObjectsTree: false, overrides: ovr,
            });
            // TV v32 bundles its own code — the returned Promise may not pass
            // `instanceof Promise`, so check for thenable instead.
            const id: any = (raw && typeof (raw as any).then === "function") ? await raw : raw;
            if (id == null) return;
            if (drawSeqRef.current === seq) linesRef.current.push({ id });
            else try { chart.removeEntity(id); } catch {}
          } catch {}
        };

        // createPositionLine — MT5-style colored Y-axis box; v32 returns Promise.
        // Falls back to createShape if unavailable in this library build.
        const addPosLine = async (
          price: number, qty: string, body: string,
          lineColor: string, bg: string, lineStyle: number,
        ) => {
          try {
            const raw = (chart as any).createPositionLine?.();
            if (raw == null) throw new Error();
            const pl: any = (raw && typeof (raw as any).then === "function") ? await raw : raw;
            if (!pl || typeof pl.setPrice !== "function") throw new Error();
            if (drawSeqRef.current !== seq) { try { pl.remove(); } catch {}; return; }
            pl.setPrice(price).setText(body).setQuantity(qty)
              .setLineColor(lineColor)
              .setBodyBackgroundColor(bg).setBodyTextColor("#fff")
              .setQuantityBackgroundColor(bg).setQuantityTextColor("#fff")
              .setLineStyle(lineStyle);
            linesRef.current.push({ remove: () => { try { pl.remove(); } catch {} } });
          } catch {
            await addShape(price, {
              linecolor: lineColor, linewidth: lineStyle === 0 ? 2 : 1,
              linestyle: lineStyle,
              showLabel: true, text: qty + (body ? "  " + body : ""),
              textcolor: "#fff",
              fillBackground: lineStyle === 0, backgroundColor: bg, backgroundTransparency: 30,
            });
          }
        };

        for (const p of positionsRef.current || []) {
          if (drawSeqRef.current !== seq) return;
          const isBuy  = p.type === "BUY";
          const isPend = !!p.kind;
          const color  = isBuy ? "#2962ff" : "#f23645";
          const tkt    = p.ticket ? `#${p.ticket}` : "";
          const pnlStr = (!isPend && p.pnl !== undefined)
            ? ` ${p.pnl >= 0 ? "+" : ""}${Number(p.pnl).toFixed(2)}`
            : "";

          if (isPend) {
            await addPosLine(p.openPrice, `${p.kind} ${p.type}`, `${tkt}  ${fmt(p.openPrice)}`, color, color, 2);
          } else {
            await addPosLine(p.openPrice, p.type, `${tkt}${pnlStr}  ${fmt(p.openPrice)}`, color, color, 0);
          }
          if (p.sl && p.sl > 0) await addShape(p.sl, {
            linecolor: "#f43f5e", linewidth: 1, linestyle: 2,
            showLabel: true, text: `SL ${tkt}  ${fmt(p.sl)}`, textcolor: "#f43f5e", fillBackground: false,
          });
          if (p.tp && p.tp > 0) await addShape(p.tp, {
            linecolor: "#10b981", linewidth: 1, linestyle: 2,
            showLabel: true, text: `TP ${tkt}  ${fmt(p.tp)}`, textcolor: "#10b981", fillBackground: false,
          });
        }

        // Ask spread line — round pips to avoid float garbage (e.g. 7.000000000000360 → 7)
        if (spreadRef.current > 0 && lastBarRef.current && drawSeqRef.current === seq) {
          const spPips   = Math.round(spreadRef.current * 100) / 100;
          const askPrice = lastBarRef.current.close + spPips * Math.pow(10, -dg);
          await addShape(askPrice, {
            linecolor: "#6b7280", linewidth: 1, linestyle: 1,
            showLabel: true, text: `Ask +${spPips}p  ${fmt(askPrice)}`,
            textcolor: "#9ca3af", fillBackground: false,
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
          description: sym?.display || name,
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
          ? (["1D","1W"].includes(tf) ? 500 : ["4H","1H"].includes(tf) ? 1000 : 500)
          : 1500;
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
          if (bars.length) lastBarRef.current = bars[bars.length - 1];
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
          }
        });
      },

      unsubscribeBars(_uid: string) {
        realtimeCbRef.current = null;
        if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      },
    };

    const disabledFeatures: string[] = [
      "use_localstorage_for_settings",
      "header_compare",
      "header_undo_redo",
      "header_screenshot",
      "header_saveload",
      "go_to_date",
      "show_logo_on_all_charts",
      "caption_buttons_text_if_possible",
      "drawing_templates",
      "pine_script_editor_aspect_ratio",
      "publish_study",
      "share_study_templates",
      // header_symbol_search re-enabled — TV search uses our datafeed (platform symbols only)
      "symbol_search_hot_key",
      "timeframes_toolbar",
      "legend_widget",
      "show_chart_property_page",  // hide settings gear — use Indicators for all options
      "display_market_status",
      "create_volume_indicator_by_default", // prevent Volume sub-pane from auto-adding
      // NOTE: tradingview_logo intentionally NOT disabled — Section 3.2 of the
      // Free Advanced Charts Agreement requires TradingView branding to remain visible.
    ];
    if (bare) {
      // Always suppress TV's own header bar — we render a custom header above the chart
      disabledFeatures.push("header_toolbar", "header_indicators", "header_chart_type", "header_resolutions");
      // Left drawing toolbar: hide unless caller explicitly requests it (fullscreen only)
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
      overrides: theme === "dark" ? {
        "paneProperties.background":     "#0f1117",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.04)",
        "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.04)",
      } : {
        "paneProperties.vertGridProperties.color": "rgba(0,0,0,0.04)",
        "paneProperties.horzGridProperties.color": "rgba(0,0,0,0.04)",
      },
      disabled_features: disabledFeatures,
      enabled_features:  ["side_toolbar_in_fullscreen_mode", "items_favoriting"],
    });

    widgetRef.current = widget;

    // TV v32 changed chartReady() from accepting a callback to returning a Promise.
    // Calling widget.chartReady(cb) in v32 silently ignores cb — must use .then().
    const readyCb = () => {
      isReadyRef.current = true;

      // Remove any Volume sub-pane (belt-and-suspenders alongside the disabled_feature)
      try {
        const chart = widget.activeChart();
        for (const s of chart.getAllStudies()) {
          if (s.name?.toLowerCase().includes("volume")) chart.removeEntity(s.id);
        }
      } catch {}

      // Redraw position lines every time TV finishes loading data (symbol changes clear shapes).
      try {
        widget.activeChart().onDataLoaded().subscribe(null, () => { drawRef.current(); });
      } catch {}

      drawRef.current(); // initial draw

      try {
        widget.activeChart().onSymbolChanged().subscribe(null, () => {
          try { onSymRef.current?.(widget.activeChart().symbol()); } catch {}
        });
      } catch {}
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
    try { w.changeTheme(theme === "dark" ? "Dark" : "Light"); } catch {}
  }, [theme]);

  // ── Position / SL / TP / spread lines (MT5 style) ───────────────────────────
  useEffect(() => {
    if (isReadyRef.current) drawRef.current();
  }, [positions, symbol, digits, spreadPips]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />
  );
}
