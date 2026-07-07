"use client";
import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type ChartPosition = {
  id: string;
  type: "BUY" | "SELL";
  lots: number | string;
  openPrice: number;
  sl?: number;
  tp?: number;
  pnl?: number;
  kind?: string; // pending order type
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
  const shapeIdsRef    = useRef<(string | null)[]>([]);
  const symbolsRef     = useRef(symbols); symbolsRef.current = symbols;
  const onSymRef       = useRef(onSymbolChange); onSymRef.current = onSymbolChange;
  const spreadRef      = useRef(spreadPips ?? 0); spreadRef.current = spreadPips ?? 0;

  // ── Build and mount the widget (once per mount) ──────────────────────────────
  const buildWidget = useCallback(() => {
    if (!containerRef.current || widgetRef.current) return;

    const allSymbols = () => symbolsRef.current || [];

    const datafeed = {
      onReady(cb: (cfg: any) => void) {
        setTimeout(() => cb({
          supported_resolutions: ["1", "5", "15", "30", "60", "240", "1D", "1W"],
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: false,
        }), 0);
      },

      searchSymbols(query: string, _ex: string, _type: string, onResult: (r: any[]) => void) {
        const q = query.toLowerCase();
        const res = allSymbols()
          .filter((s) => !q || s.symbol.toLowerCase().includes(q) || (s.display || "").toLowerCase().includes(q))
          .slice(0, 30)
          .map((s) => ({
            symbol: s.symbol, full_name: s.symbol, ticker: s.symbol,
            description: s.display || s.symbol, exchange: "", type: s.category || "forex",
          }));
        onResult(res);
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
        const limit = firstDataRequest ? 500 : 2000;
        const beforeParam = firstDataRequest ? "" : `&before=${to}`;
        try {
          const d = await fetch(
            `/api/candles?symbol=${encodeURIComponent(symbolInfo.name)}&tf=${tf}&limit=${limit}${beforeParam}`,
            { cache: "no-store" }
          ).then((r) => r.json());
          if (!d.ok || !Array.isArray(d.candles) || !d.candles.length) {
            onHistory([], { noData: true }); return;
          }
          // candles API returns time in seconds → TradingView expects milliseconds
          const bars: Bar[] = d.candles
            .filter((c: any) => c.time >= from && c.time <= to)
            .map((c: any) => ({ time: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
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
      // Remove TradingView branding, external links, and outbound calls
      "show_logo_on_all_charts",
      "caption_buttons_text_if_possible",
      // Disable screenshot — removes tradingview.com/snapshot/ call
      // (already in list above but kept for clarity)
      // Disable emoji tool — prevents twemoji.maxcdn.com + cdnjs CDN requests
      "drawing_templates",
      "pine_script_editor_aspect_ratio",
      // Disable "Share on Twitter" and "Publish idea" buttons
      "publish_study",
      "share_study_templates",
      // Disable "Go to TradingView" link in header
      "tradingview_logo",
    ];
    if (bare) {
      disabledFeatures.push(
        "left_toolbar", "header_toolbar", "header_indicators",
        "header_chart_type", "header_resolutions", "timeframes_toolbar",
        "header_symbol_search",
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
      enabled_features:  ["side_toolbar_in_fullscreen_mode"],
    });

    widgetRef.current = widget;

    // Notify parent when user picks a symbol from the search bar
    widget.onChartReady(() => {
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
      realtimeCbRef.current = null;
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
    try { w.onChartReady(apply); } catch { apply(); }
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

  // ── Position / SL / TP shapes ────────────────────────────────────────────────
  useEffect(() => {
    const w = widgetRef.current; if (!w) return;
    const draw = () => {
      try {
        const chart = w.activeChart();
        for (const id of shapeIdsRef.current) { try { if (id) chart.removeEntity(id); } catch {} }
        shapeIdsRef.current = [];
        const nowSec = Math.floor(Date.now() / 1000);

        for (const p of positions || []) {
          const color = p.type === "BUY" ? "#3b82f6" : "#ef4444";
          const label = `${p.kind ? p.kind + " " : ""}${p.type} ${p.lots}${p.pnl !== undefined ? ` · ${p.pnl >= 0 ? "+" : ""}${Number(p.pnl).toFixed(2)}` : ""}`;

          const eId = chart.createShape(
            { time: nowSec, price: p.openPrice },
            {
              shape: "horizontal_line", lock: true,
              disableSelection: false, disableSave: true, disableUndo: true,
              showInObjectsTree: false,
              overrides: { linecolor: color, linewidth: 2, linestyle: 0, showLabel: true, text: label, textColor: "#ffffff", bold: true, fillBackground: false },
            }
          );
          shapeIdsRef.current.push(eId);

          if (p.sl && p.sl > 0) {
            const sId = chart.createShape(
              { time: nowSec, price: p.sl },
              { shape: "horizontal_line", lock: true, disableSelection: false, disableSave: true, disableUndo: true, showInObjectsTree: false, overrides: { linecolor: "#f43f5e", linewidth: 1, linestyle: 2, showLabel: true, text: "SL", textColor: "#fff", fillBackground: false } }
            );
            shapeIdsRef.current.push(sId);
          }
          if (p.tp && p.tp > 0) {
            const tId = chart.createShape(
              { time: nowSec, price: p.tp },
              { shape: "horizontal_line", lock: true, disableSelection: false, disableSave: true, disableUndo: true, showInObjectsTree: false, overrides: { linecolor: "#10b981", linewidth: 1, linestyle: 2, showLabel: true, text: "TP", textColor: "#fff", fillBackground: false } }
            );
            shapeIdsRef.current.push(tId);
          }
        }
      } catch {}
    };
    try { w.onChartReady(draw); } catch { draw(); }
  }, [positions, symbol]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />
  );
}
