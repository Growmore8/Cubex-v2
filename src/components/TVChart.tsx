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
  positions, symbols, bare, onSymbolChange, spreadPips,
}: {
  symbol: string;
  tf: string;
  theme: "dark" | "light";
  digits?: number;
  positions?: ChartPosition[];
  symbols?: Sym[];
  bare?: boolean;
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

  // Defined every render so it always captures latest refs — stored in drawRef for stable access
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const w = widgetRef.current; if (!w) return;
    try {
      const chart = w.activeChart();

      // Cleanup: position/order line objects have .remove(); shape fallbacks have .id
      for (const l of linesRef.current) {
        try {
          if (typeof l?.remove === "function") l.remove();
          else if (l?.id != null) chart.removeEntity(l.id);
        } catch {}
      }
      linesRef.current = [];

      const dg     = digitsRef.current;
      const fmt    = (v: number) => v.toFixed(dg);
      const nowSec = Math.floor(Date.now() / 1000);

      // Detect which APIs are available in this TV library version
      const hasPositionLine = typeof chart.createPositionLine === "function";
      const hasOrderLine    = typeof chart.createOrderLine    === "function";

      // Entry / position line (solid)
      const addPosition = (price: number, color: string, lots: string, label: string) => {
        try {
          if (hasPositionLine) {
            linesRef.current.push(
              chart.createPositionLine()
                .setPrice(price).setLineColor(color).setLineStyle(0).setLineWidth(2)
                .setBodyTextColor("#fff").setBodyBorderColor(color).setBodyBackgroundColor(color)
                .setText(label)
                .setQuantity(lots).setQuantityTextColor("#fff")
                .setQuantityBorderColor(color).setQuantityBackgroundColor(color)
            );
          } else {
            // Fallback: horizontal_line shape with label text
            const id = chart.createShape(
              { time: nowSec, price },
              { shape: "horizontal_line", lock: true, disableSave: true, disableUndo: true, showInObjectsTree: false,
                overrides: { linecolor: color, linewidth: 2, linestyle: 0, showLabel: true,
                  text: `${lots} ${label}`, textColor: "#fff", bold: true,
                  fillBackground: true, backgroundColor: color, backgroundTransparency: 40 } }
            );
            linesRef.current.push({ id });
          }
        } catch {}
      };

      // SL / TP / pending order line (dashed)
      const addOrder = (price: number, color: string, lots: string, label: string) => {
        try {
          if (hasOrderLine) {
            linesRef.current.push(
              chart.createOrderLine()
                .setPrice(price).setLineColor(color).setLineStyle(2).setLineWidth(1)
                .setEditable(false)
                .setBodyTextColor("#fff").setBodyBorderColor(color).setBodyBackgroundColor(color)
                .setText(label)
                .setQuantity(lots).setQuantityTextColor("#fff")
                .setQuantityBorderColor(color).setQuantityBackgroundColor(color)
            );
          } else {
            const id = chart.createShape(
              { time: nowSec, price },
              { shape: "horizontal_line", lock: true, disableSave: true, disableUndo: true, showInObjectsTree: false,
                overrides: { linecolor: color, linewidth: 1, linestyle: 2, showLabel: true,
                  text: `${lots} ${label}`, textColor: color, bold: false, fillBackground: false } }
            );
            linesRef.current.push({ id });
          }
        } catch {}
      };

      for (const p of positionsRef.current || []) {
        const isBuy  = p.type === "BUY";
        const isPend = !!p.kind;
        const color  = isBuy ? "#2962ff" : "#f23645";
        const lots   = String(p.lots);
        const tkt    = p.ticket ? ` #${p.ticket}` : "";
        const pnlStr = p.pnl !== undefined
          ? ` ${p.pnl >= 0 ? "+" : ""}${Number(p.pnl).toFixed(2)}`
          : "";

        if (isPend) {
          addOrder(p.openPrice, color, lots, `${p.kind} ${p.type}${tkt}  ${fmt(p.openPrice)}`);
        } else {
          addPosition(p.openPrice, color, lots, `${p.type}${tkt}${pnlStr}  ${fmt(p.openPrice)}`);
        }
        if (p.sl && p.sl > 0) addOrder(p.sl,  "#f43f5e", lots, `SL${tkt}  ${fmt(p.sl)}`);
        if (p.tp && p.tp > 0) addOrder(p.tp,  "#10b981", lots, `TP${tkt}  ${fmt(p.tp)}`);
      }

      // Spread ask line
      if (spreadRef.current > 0 && lastBarRef.current) {
        const pip      = Math.pow(10, -dg);
        const askPrice = lastBarRef.current.close + spreadRef.current * pip;
        try {
          if (hasOrderLine) {
            linesRef.current.push(
              chart.createOrderLine()
                .setPrice(askPrice).setLineColor("#6b7280").setLineStyle(1).setLineWidth(1)
                .setEditable(false)
                .setBodyTextColor("#d1d5db").setBodyBorderColor("#4b5563").setBodyBackgroundColor("#374151")
                .setText(`Ask  ${fmt(askPrice)}`)
                .setQuantity(`+${spreadRef.current}p`).setQuantityTextColor("#9ca3af")
                .setQuantityBorderColor("#374151").setQuantityBackgroundColor("#1f2937")
            );
          } else {
            const id = chart.createShape(
              { time: nowSec, price: askPrice },
              { shape: "horizontal_line", lock: true, disableSave: true, disableUndo: true, showInObjectsTree: false,
                overrides: { linecolor: "#6b7280", linewidth: 1, linestyle: 1, showLabel: true,
                  text: `Ask +${spreadRef.current}p  ${fmt(askPrice)}`, textColor: "#9ca3af", fillBackground: false } }
            );
            linesRef.current.push({ id });
          }
        } catch {}
      }
    } catch {}
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
          ? (["1D","1W"].includes(tf) ? 500 : ["4H","1H"].includes(tf) ? 2000 : 1000)
          : 3000;
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
      // NOTE: tradingview_logo intentionally NOT disabled — Section 3.2 of the
      // Free Advanced Charts Agreement requires TradingView branding to remain visible.
    ];
    if (bare) {
      disabledFeatures.push(
        "left_toolbar", "header_toolbar", "header_indicators",
        "header_chart_type", "header_resolutions",
      );
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

    const onReady = (cb: () => void) => widget.chartReady ? widget.chartReady(cb) : widget.onChartReady(cb);
    onReady(() => {
      isReadyRef.current = true;

      // Remove any Volume sub-pane left over from previous chart state
      try {
        const chart = widget.activeChart();
        for (const s of chart.getAllStudies()) {
          if (s.name === "Volume") chart.removeEntity(s.id);
        }
      } catch {}

      // Redraw position lines every time TV finishes loading data.
      // TV clears createShape overlays when a symbol change completes, so
      // onDataLoaded is the only reliable hook to recreate them afterwards.
      try {
        widget.activeChart().onDataLoaded().subscribe(null, () => {
          drawRef.current();
        });
      } catch {}

      // Initial draw
      drawRef.current();

      try {
        widget.activeChart().onSymbolChanged().subscribe(null, () => {
          try { onSymRef.current?.(widget.activeChart().symbol()); } catch {}
        });
      } catch {}
    });
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
    try { w.chartReady ? w.chartReady(apply) : w.onChartReady(apply); } catch { apply(); }
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
