"use client";
import { memo, useEffect, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import PriceCell from "./PriceCell";
import { gnum } from "@/lib/format";
import { SymIcon } from "@/lib/symIcon";

type Sym = { symbol: string; display?: string; category?: string; digits?: number };

const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];

// Self-contained market watch with its OWN socket + price state, so it ticks
// pip-by-pip independently of the (heavy) desk re-render — as smooth as the client.
function DeskMarketWatch({ symbols, selSym, onPick, onToggleSym, disabledSyms, onSymbolEdit, onCategoryEdit, symbolSpreads, groupSpread }: {
  symbols: Sym[];
  selSym?: string;
  onPick: (sym: string) => void;
  onToggleSym?: (sym: string, disabled: boolean) => void;
  disabledSyms?: string[];
  onSymbolEdit?: (sym: string) => void;
  onCategoryEdit?: (cat: string, syms: string[]) => void;
  symbolSpreads?: Record<string, { min: number; max: number; type: string } | number>;
  groupSpread?: number;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [ctx, setCtx] = useState<{ x: number; y: number; sym: string } | null>(null);
  const [catCtx, setCatCtx] = useState<{ x: number; y: number; cat: string; syms: string[] } | null>(null);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {}; const pD: Record<string, number> = {}; const prev: Record<string, number> = {};
    const flush = () => {
      const pk = Object.keys(pP), dk = Object.keys(pD);
      if (!pk.length && !dk.length) return;
      const px = { ...pP }; const dr = { ...pD };
      for (const k in pP) delete pP[k]; for (const k in pD) delete pD[k];
      startTransition(() => {
        if (pk.length) setPrices((pp) => ({ ...pp, ...px }));
        if (dk.length) setDirs((dd) => ({ ...dd, ...dr }));
      });
    };
    socket.on("prices", (snap: Record<string, number>) => { startTransition(() => setPrices((pp) => ({ ...pp, ...snap }))); for (const k in snap) prev[k] = snap[k]; });
    socket.on("tick", ({ symbol, price }: any) => {
      const pv = prev[symbol];
      if (pv != null && pv !== price) pD[symbol] = price > pv ? 1 : -1;
      prev[symbol] = price; pP[symbol] = price;
    });
    const fv = setInterval(flush, 120);
    const clr = setInterval(() => setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; }), 650);
    return () => { socket.disconnect(); clearInterval(clr); clearInterval(fv); };
  }, []);

  const q = search.trim().toLowerCase();
  const groups: Record<string, Sym[]> = {};
  symbols.filter((s) => !q || (s.symbol + " " + (s.display || "")).toLowerCase().includes(q))
    .forEach((s) => { const cat = s.category || "other"; (groups[cat] || (groups[cat] = [])).push(s); });
  const ordered = Object.entries(groups).sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a[0]); const ib = CAT_ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const dgFor = (s: Sym) => (s.digits != null ? s.digits : 2);
  const vw = typeof window !== "undefined" ? window.innerWidth : 9999;

  return (
    <>
      <div className="border-b border-[var(--border)] px-1.5 py-1">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol…" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-1 pl-6 pr-6 text-[10px] text-[var(--text)]" />
          {search && <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]" aria-label="clear">{"×"}</button>}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-1 pb-2 text-[10px]">
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_64px_64px_36px] bg-[var(--panel)] px-2 py-1 text-[10px] font-bold text-[var(--text)]">
          <span>Symbol</span><span className="text-right pr-1">Bid</span><span className="text-right pr-1">Ask</span><span className="text-right pr-1" style={{ color: "var(--muted)" }}>Sprd</span>
        </div>
        {ordered.map(([cat, list]) => (
          <div key={cat}>
            <div
              onClick={() => setCollapsed((o) => ({ ...o, [cat]: !o[cat] }))}
              onContextMenu={(e) => { if (!onCategoryEdit) return; e.preventDefault(); setCatCtx({ x: e.clientX, y: e.clientY, cat, syms: list.map((s) => s.symbol) }); }}
              className={"mt-1 rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)] flex items-center justify-between " + (onCategoryEdit ? "cursor-context-menu" : "cursor-pointer")}
            >
              <span>{collapsed[cat] ? "▸" : "▾"} {cat.toUpperCase()}</span>
              {onCategoryEdit && <i className="fa-solid fa-sliders text-[8px] opacity-40 hover:opacity-100" title="Right-click to set category spread" />}
            </div>
            {!collapsed[cat] && list.map((s) => {
              const p = prices[s.symbol]; const d = dgFor(s);
              const rawSp = symbolSpreads && symbolSpreads[s.symbol];
              const spPips = (typeof rawSp === "object" && rawSp !== null ? (rawSp as any).min : (rawSp as number) || 0) + (groupSpread || 0);
              const spPx = spPips * Math.pow(10, -(d - 1));
              const ask = p != null ? gnum(p, d) : "—"; const bid = p != null ? gnum(p - spPx, d) : "—"; const dir = dirs[s.symbol] || 0;
              const isOff = !!(disabledSyms && disabledSyms.includes(s.symbol));
              return (
                <div key={s.symbol} onClick={() => onPick(s.symbol)} onDoubleClick={() => onPick(s.symbol)}
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }}
                  className={"grid cursor-pointer grid-cols-[1fr_64px_64px_36px] items-stretch py-1 hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}
                  style={{ borderRadius: 3, minHeight: 22, opacity: isOff ? 0.45 : 1 }}>
                  <span className="flex min-w-0 items-center gap-2 pl-2 text-left"><SymIcon symbol={s.symbol} /><span className="truncate">{s.symbol}</span>{isOff && <span className="text-[8px] rounded px-1" style={{ background: "rgba(224,82,96,0.18)", color: "#ef5350" }}>OFF</span>}</span>
                  <PriceCell value={bid} dir={dir} />
                  <PriceCell value={ask} dir={dir} />
                  <span className="flex items-center justify-end pr-1 tabular-nums" style={{ color: "var(--muted)", fontSize: 9 }}>{spPips > 0 ? Math.round(spPips * 10) : "—"}</span>
                </div>);
            })}
          </div>
        ))}
        {ordered.length === 0 && <div className="px-2 py-3 text-center text-[var(--muted)]">No symbols match &ldquo;{search}&rdquo;.</div>}
      </div>

      {/* Symbol right-click context menu */}
      {ctx && (<>
        <div className="fixed inset-0 z-[120]" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
        <div className="fixed z-[121] min-w-[180px] overflow-hidden rounded-lg border py-1 text-[11px] shadow-2xl" style={{ left: Math.min(ctx.x, vw - 200), top: ctx.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{ctx.sym}</div>
          {onSymbolEdit && (
            <button onClick={() => { onSymbolEdit(ctx.sym); setCtx(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--soft)]">
              <i className="fa-solid fa-sliders text-[10px]" style={{ color: "var(--accent)" }} /> Spread settings
            </button>
          )}
          {onToggleSym && (() => {
            const isOff = !!(disabledSyms && disabledSyms.includes(ctx.sym));
            return (
              <button onClick={() => { onToggleSym(ctx.sym, !isOff); setCtx(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--soft)]" style={{ color: isOff ? "#22c55e" : "#ef5350" }}>
                <i className={"fa-solid text-[10px] " + (isOff ? "fa-eye" : "fa-eye-slash")} /> {isOff ? "Enable symbol (global)" : "Disable symbol (global)"}
              </button>
            );
          })()}
        </div>
      </>)}

      {/* Category right-click context menu */}
      {catCtx && onCategoryEdit && (<>
        <div className="fixed inset-0 z-[120]" onClick={() => setCatCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCatCtx(null); }} />
        <div className="fixed z-[121] min-w-[180px] overflow-hidden rounded-lg border py-1 text-[11px] shadow-2xl" style={{ left: Math.min(catCtx.x, vw - 220), top: catCtx.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{catCtx.cat.toUpperCase()} · {catCtx.syms.length} symbols</div>
          <button onClick={() => { onCategoryEdit(catCtx.cat, catCtx.syms); setCatCtx(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--soft)]">
            <i className="fa-solid fa-sliders text-[10px]" style={{ color: "var(--accent)" }} /> Set spread for all {catCtx.cat}
          </button>
        </div>
      </>)}
    </>
  );
}
export default memo(DeskMarketWatch);
