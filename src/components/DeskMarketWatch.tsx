"use client";
import { memo, useEffect, useRef, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import PriceCell from "./PriceCell";
import { gnum } from "@/lib/format";
import { SymIcon } from "@/lib/symIcon";

type Sym = { symbol: string; display?: string; category?: string; digits?: number };

const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];

// Self-contained market watch with its OWN socket + price state, so it ticks
// pip-by-pip independently of the (heavy) desk re-render — as smooth as the client.
function DeskMarketWatch({ symbols, selSym, onPick, disabledSyms, onCategoryEdit, symbolSpreads, symbolTypes, groupSpread }: {
  symbols: Sym[];
  selSym?: string;
  onPick: (sym: string) => void;
  disabledSyms?: string[];
  onCategoryEdit?: (cat: string, syms: string[]) => void;
  symbolSpreads?: Record<string, { min: number; max: number; type: string } | number>;
  symbolTypes?: Record<string, string>;
  groupSpread?: number;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [realBids, setRealBids] = useState<Record<string, number>>({});
  const [liveSpreadPips, setLiveSpreadPips] = useState<Record<string, number>>({});
  const [spreadDirs, setSpreadDirs] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [catCtx, setCatCtx] = useState<{ x: number; y: number; cat: string; syms: string[] } | null>(null);

  // digits lookup built from symbols prop — used inside tick handler to compute pips
  const digitsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const map: Record<string, number> = {};
    symbols.forEach((s) => { if (s.digits != null) map[s.symbol] = s.digits; });
    digitsRef.current = map;
  }, [symbols]);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {}; const pD: Record<string, number> = {}; const pB: Record<string, number> = {}; const pS: Record<string, number> = {}; const pSD: Record<string, number> = {}; const prev: Record<string, number> = {}; const prevSp: Record<string, number> = {};
    const flush = () => {
      const pk = Object.keys(pP), dk = Object.keys(pD), bk = Object.keys(pB), sk = Object.keys(pS), sdk = Object.keys(pSD);
      if (!pk.length && !dk.length && !bk.length && !sk.length && !sdk.length) return;
      const px = { ...pP }; const dr = { ...pD }; const bd = { ...pB }; const sp = { ...pS }; const sd = { ...pSD };
      for (const k in pP) delete pP[k]; for (const k in pD) delete pD[k]; for (const k in pB) delete pB[k]; for (const k in pS) delete pS[k]; for (const k in pSD) delete pSD[k];
      // Bids + spread: urgent — must never be deferred or spread appears frozen
      if (bk.length) setRealBids((bb) => ({ ...bb, ...bd }));
      if (sk.length) setLiveSpreadPips((ss) => ({ ...ss, ...sp }));
      if (sdk.length) setSpreadDirs((sd2) => ({ ...sd2, ...sd }));
      // Price + direction: low-priority (visual smoothness only)
      startTransition(() => {
        if (pk.length) setPrices((pp) => ({ ...pp, ...px }));
        if (dk.length) setDirs((dd) => ({ ...dd, ...dr }));
      });
    };
    socket.on("prices", (snap: Record<string, number>) => { startTransition(() => setPrices((pp) => ({ ...pp, ...snap }))); for (const k in snap) prev[k] = snap[k]; });
    socket.on("bids", (snap: Record<string, number>) => { setRealBids((bb) => ({ ...bb, ...snap })); });
    socket.on("tick", ({ symbol, price, bid, real }: any) => {
      const pv = prev[symbol];
      if (pv != null && pv !== price) pD[symbol] = price > pv ? 1 : -1;
      prev[symbol] = price; pP[symbol] = price;
      if (bid != null) pB[symbol] = bid;
      // Compute spread from coherent real-ask + bid from the same tick (most accurate)
      if (bid != null && bid > 0) {
        const realAsk = (real != null && real > 0) ? real : price;
        if (realAsk > bid) {
          const d = digitsRef.current[symbol] ?? 2;
          const pip = Math.pow(10, -(d - 1));
          const sp = (realAsk - bid) / pip;
          const prev2 = prevSp[symbol];
          if (prev2 != null && sp !== prev2) pSD[symbol] = sp > prev2 ? 1 : -1;
          prevSp[symbol] = sp;
          pS[symbol] = sp;
        }
      }
    });
    const fv = setInterval(flush, 120);
    const clr = setInterval(() => {
      setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; });
      setSpreadDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; });
    }, 650);
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
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_70px_70px_38px] bg-[var(--panel)] px-2 py-1 text-[10px] font-bold text-[var(--text)]">
          <span>Symbol</span><span className="text-right pr-1">Bid</span><span className="text-right pr-1">Ask</span><span className="text-right pr-1" style={{ color: "var(--muted)" }}>Spread</span>
        </div>
        {ordered.map(([cat, list]) => (
          <div key={cat}>
            <div
              onClick={() => setCollapsed((o) => ({ ...o, [cat]: !o[cat] }))}
              onContextMenu={(e) => { if (!onCategoryEdit) return; e.preventDefault(); setCatCtx({ x: e.clientX, y: e.clientY, cat, syms: list.map((s) => s.symbol) }); }}
              className="mt-1 rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)] flex items-center justify-between cursor-pointer"
            >
              <span>{collapsed[cat] ? "▸" : "▾"} {cat.toUpperCase()}</span>
            </div>
            {!collapsed[cat] && list.map((s) => {
              const p = prices[s.symbol]; const d = dgFor(s);
              const pip = Math.pow(10, -(d - 1));
              const lpBid = realBids[s.symbol];
              // Use real exchange ask (same tick as bid) — not smoothed display price
              const liveSp2 = liveSpreadPips[s.symbol];
              const realAskPx = (lpBid != null && lpBid > 0 && liveSp2 != null && liveSp2 > 0)
                ? lpBid + liveSp2 * pip
                : p;
              const ask = realAskPx != null ? gnum(realAskPx, d) : "—";
              const liveSp = liveSp2;
              const hasLive = liveSp != null && liveSp > 0;
              // Configured spread as fallback only (FIXED or FLOATING min from admin settings)
              const rawSp = symbolSpreads && symbolSpreads[s.symbol];
              const cfgSpPips = (typeof rawSp === "object" && rawSp !== null ? (rawSp as any).min : (rawSp as number) || 0) + (groupSpread || 0);
              const realSpPips = hasLive ? liveSp : cfgSpPips;
              const spPx = realSpPips * pip;
              const safeSpPx = p != null ? Math.min(spPx, p * 0.02) : spPx;
              const validRealBid = lpBid != null && lpBid > 0 && (realAskPx == null || lpBid < realAskPx);
              const bid = validRealBid ? gnum(lpBid!, d) : (p != null ? gnum(Math.max(0, p - safeSpPx), d) : "—");
              const dir = dirs[s.symbol] || 0;
              const spDir = spreadDirs[s.symbol] || 0;
              const isOff = !!(disabledSyms && disabledSyms.includes(s.symbol));
              return (
                <div key={s.symbol} onClick={() => onPick(s.symbol)} onDoubleClick={() => onPick(s.symbol)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={"grid cursor-pointer grid-cols-[1fr_64px_64px_36px] items-stretch py-1 hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}
                  style={{ borderRadius: 3, minHeight: 22, opacity: isOff ? 0.45 : 1 }}>
                  <span className="flex min-w-0 items-center gap-2 pl-2 text-left"><SymIcon symbol={s.symbol} /><span className="truncate">{s.symbol}</span>{isOff && <span className="text-[8px] rounded px-1" style={{ background: "rgba(224,82,96,0.18)", color: "#ef5350" }}>OFF</span>}</span>
                  <PriceCell value={bid} dir={dir} />
                  <PriceCell value={ask} dir={dir} />
                  <span className="flex items-center justify-end pr-1 gap-0.5">
                    {hasLive
                      ? <span title="Live spread from exchange feed" style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
                      : null}
                    <span className="tabular-nums" title={realSpPips > 0 ? `${realSpPips.toFixed(2)} pips · ${Math.round(realSpPips * 10)} points · price spread ${spPx.toFixed(d > 2 ? 5 : 2)}` : undefined}
                      style={{
                        fontSize: 9,
                        cursor: realSpPips > 0 ? "help" : undefined,
                        color: spDir > 0 ? "#e05260" : spDir < 0 ? "#16c784" : "var(--muted)",
                        transition: "color 0.55s ease-out",
                        fontWeight: spDir !== 0 ? 700 : 400,
                      }}>
                      {realSpPips > 0 ? Math.round(realSpPips * 10) : "—"}
                    </span>
                  </span>
                </div>);
            })}
          </div>
        ))}
        {ordered.length === 0 && <div className="px-2 py-3 text-center text-[var(--muted)]">No symbols match &ldquo;{search}&rdquo;.</div>}
      </div>

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
