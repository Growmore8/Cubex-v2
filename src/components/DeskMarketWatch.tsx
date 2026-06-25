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
function DeskMarketWatch({ symbols, selSym, onPick, onDisable, symbolSpreads, groupSpread }: { symbols: Sym[]; selSym?: string; onPick: (sym: string) => void; onDisable?: (sym: string) => void; symbolSpreads?: Record<string, { min: number; max: number; type: string } | number>; groupSpread?: number }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [ctx, setCtx] = useState<{ x: number; y: number; sym: string } | null>(null);
  const [symInfo, setSymInfo] = useState<{ sym: Sym; ask: number | null } | null>(null);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {}; const pD: Record<string, number> = {}; const prev: Record<string, number> = {};
    // Steady interval flush + startTransition (mirrors the client) — rAF can be
    // throttled by the browser, which made the desk watch lag. This keeps it
    // ticking pip-by-pip for every symbol.
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
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_72px_72px] bg-[var(--panel)] px-2 py-1 text-[10px] font-bold text-[var(--text)]"><span>Symbol</span><span className="text-right pr-1">Bid</span><span className="text-right pr-1">Ask</span></div>
        {ordered.map(([cat, list]) => (
          <div key={cat}>
            <div onClick={() => setCollapsed((o) => ({ ...o, [cat]: !o[cat] }))} className="mt-1 cursor-pointer rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)]">{collapsed[cat] ? "▸" : "▾"} {cat.toUpperCase()}</div>
            {!collapsed[cat] && list.map((s) => { const p = prices[s.symbol]; const d = dgFor(s); const rawSp = symbolSpreads && symbolSpreads[s.symbol]; const spPips = (typeof rawSp === "object" && rawSp !== null ? (rawSp as any).min : (rawSp as number) || 0) + (groupSpread || 0); const spPx = spPips * Math.pow(10, -(d - 1)); const ask = p != null ? gnum(p, d) : "—"; const bid = p != null ? gnum(p - spPx, d) : "—"; const dir = dirs[s.symbol] || 0;
              return (
                <div key={s.symbol} onClick={() => onPick(s.symbol)} onDoubleClick={() => onPick(s.symbol)} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }} className={"grid cursor-pointer grid-cols-[1fr_72px_72px] items-stretch py-1 hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")} style={{ borderRadius: 3, minHeight: 22 }}>
                  <span className="flex min-w-0 items-center gap-2 pl-2 text-left"><SymIcon symbol={s.symbol} /><span className="truncate">{s.symbol}</span></span>
                  <PriceCell value={bid} dir={dir} />
                  <PriceCell value={ask} dir={dir} />
                </div>); })}
          </div>
        ))}
        {ordered.length === 0 && <div className="px-2 py-3 text-center text-[var(--muted)]">No symbols match &ldquo;{search}&rdquo;.</div>}
      </div>
      {ctx && (<>
        <div className="fixed inset-0 z-[120]" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
        <div className="fixed z-[121] min-w-[180px] overflow-hidden rounded-lg border py-1 text-[11px] shadow-2xl" style={{ left: Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: ctx.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{ctx.sym}</div>
          <button onClick={() => { const s = symbols.find((x) => x.symbol === ctx.sym); setSymInfo({ sym: s || { symbol: ctx.sym }, ask: prices[ctx.sym] ?? null }); setCtx(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--soft)]">
            <i className="fa-solid fa-circle-info text-[10px]" /> Symbol properties
          </button>
          {onDisable && <button onClick={() => { onDisable(ctx.sym); setCtx(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--soft)]" style={{ color: "#dc2626" }}>
            <i className="fa-solid fa-eye-slash text-[10px]" /> Disable symbol
          </button>}
        </div>
      </>)}

      {/* Symbol Properties popup (MT5 style) */}
      {symInfo && (() => {
        const s = symInfo.sym; const d = s.digits ?? 2;
        const rawSp = symbolSpreads && symbolSpreads[s.symbol];
        const spObj = typeof rawSp === "object" && rawSp !== null ? rawSp as any : null;
        const spPips = (spObj ? spObj.min : (rawSp as number) || 0) + (groupSpread || 0);
        const spPx = spPips * Math.pow(10, -(d - 1));
        const ask = symInfo.ask ?? prices[s.symbol] ?? null;
        const bid = ask != null ? ask - spPx : null;
        return (
          <div className="fixed inset-0 z-[130] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setSymInfo(null)}>
            <div className="w-[300px] rounded-xl border p-5 text-[12px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <div><div className="text-[15px] font-bold">{s.symbol}</div><div className="text-[10px] text-[var(--muted)]">{s.display || ""} · {s.category || "forex"}</div></div>
                <button onClick={() => setSymInfo(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
              </div>
              <div className="mb-3 space-y-1.5 rounded-lg border border-[var(--border)] p-3 text-[11px]">
                <div className="flex justify-between"><span className="text-[var(--muted)]">Digits</span><span className="font-semibold">{d}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Pip size</span><span className="font-semibold tabular-nums">{Math.pow(10, -(d - 1)).toFixed(d - 1 > 0 ? d - 1 : 0)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Spread (pips)</span><span className="font-semibold tabular-nums">{spPips.toFixed(1)}</span></div>
                {spObj && <div className="flex justify-between"><span className="text-[var(--muted)]">Spread type</span><span className="font-semibold">{spObj.type || "FIXED"}</span></div>}
                {spObj?.type === "FLOATING" && <div className="flex justify-between"><span className="text-[var(--muted)]">Spread range</span><span className="font-semibold tabular-nums">{spObj.min} – {spObj.max} pips</span></div>}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg p-2.5 text-center" style={{ background: "rgba(239,83,80,0.12)", border: "1px solid rgba(239,83,80,0.3)" }}>
                  <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Bid</div>
                  <div className="text-[14px] font-bold tabular-nums" style={{ color: "#ef5350" }}>{bid != null ? bid.toFixed(d) : "—"}</div>
                </div>
                <div className="rounded-lg p-2.5 text-center" style={{ background: "rgba(38,166,154,0.12)", border: "1px solid rgba(38,166,154,0.3)" }}>
                  <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Ask</div>
                  <div className="text-[14px] font-bold tabular-nums" style={{ color: "#26a69a" }}>{ask != null ? ask.toFixed(d) : "—"}</div>
                </div>
              </div>
              <button onClick={() => setSymInfo(null)} className="w-full rounded-lg border border-[var(--border)] py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">Close</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
export default memo(DeskMarketWatch);
