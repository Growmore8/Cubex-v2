"use client";
import { memo, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import PriceCell from "./PriceCell";

type Sym = { symbol: string; display?: string; category?: string; digits?: number };

const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];

// Self-contained market watch with its OWN socket + price state, so it ticks
// pip-by-pip independently of the (heavy) desk re-render — as smooth as the client.
function DeskMarketWatch({ symbols, selSym, onPick }: { symbols: Sym[]; selSym?: string; onPick: (sym: string) => void }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {}; const pD: Record<string, number> = {}; const prev: Record<string, number> = {};
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (Object.keys(pP).length) { setPrices((pp) => ({ ...pp, ...pP })); for (const k in pP) delete pP[k]; }
      if (Object.keys(pD).length) { setDirs((dd) => ({ ...dd, ...pD })); for (const k in pD) delete pD[k]; }
    };
    socket.on("prices", (snap: Record<string, number>) => { setPrices((pp) => ({ ...pp, ...snap })); for (const k in snap) prev[k] = snap[k]; });
    socket.on("tick", ({ symbol, price }: any) => {
      const pv = prev[symbol];
      if (pv != null && pv !== price) pD[symbol] = price > pv ? 1 : -1;
      prev[symbol] = price; pP[symbol] = price;
      if (!raf) raf = requestAnimationFrame(flush);
    });
    const clr = setInterval(() => setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; }), 650);
    return () => { socket.disconnect(); clearInterval(clr); if (raf) cancelAnimationFrame(raf); };
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
            {!collapsed[cat] && list.map((s) => { const p = prices[s.symbol]; const d = dgFor(s); const bid = p != null ? (p * 0.9999).toFixed(d) : "—"; const ask = p != null ? (p * 1.0001).toFixed(d) : "—"; const dir = dirs[s.symbol] || 0;
              return (
                <div key={s.symbol} onClick={() => onPick(s.symbol)} onDoubleClick={() => onPick(s.symbol)} className={"grid cursor-pointer grid-cols-[1fr_72px_72px] items-stretch py-1 hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")} style={{ borderRadius: 3, minHeight: 22 }}>
                  <span className="truncate pl-2 text-left">{s.symbol}</span>
                  <PriceCell value={bid} dir={dir} />
                  <PriceCell value={ask} dir={dir} />
                </div>); })}
          </div>
        ))}
        {ordered.length === 0 && <div className="px-2 py-3 text-center text-[var(--muted)]">No symbols match &ldquo;{search}&rdquo;.</div>}
      </div>
    </>
  );
}
export default memo(DeskMarketWatch);
