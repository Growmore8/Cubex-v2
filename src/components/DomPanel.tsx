"use client";
import { useEffect, useState } from "react";

const SELL_COL = "#ef5350";
const BUY_COL  = "#26a69a";
const LEVELS   = 8;

// Synthetic volume that decays exponentially with distance from mid-price.
// Seed increments every 1.5 s so volumes shift gradually instead of jumping
// erratically on every price tick.
function synthVol(level: number, side: "ask" | "bid", seed: number): number {
  const decay = Math.exp(-0.5 * level);
  const r = Math.abs(Math.sin(seed * 31.7 + level * 17.3 + (side === "ask" ? 7.1 : 13.3)));
  return Math.max(5, Math.round((15 + r * 185) * decay));
}

interface Props {
  symbol:     string;
  bid:        number;
  ask:        number;
  spreadPips: number;
  digits:     number;
  onRowClick: (price: number, side: "ask" | "bid") => void;
}

export default function DomPanel({ symbol, bid, ask, spreadPips, digits, onRowClick }: Props) {
  const [seed, setSeed] = useState(() => Math.floor(Date.now() / 1500));
  useEffect(() => {
    const iv = setInterval(() => setSeed((s) => s + 1), 1500);
    return () => clearInterval(iv);
  }, []);

  const pipSz = Math.pow(10, -(digits - 1));
  const fmt   = (v: number) => v.toFixed(digits);

  const asks = Array.from({ length: LEVELS }, (_, i) => ({
    px:  ask + i * pipSz,
    vol: synthVol(i, "ask", seed),
  }));
  const bids = Array.from({ length: LEVELS }, (_, i) => ({
    px:  bid - i * pipSz,
    vol: synthVol(i, "bid", seed),
  }));

  const maxVol   = Math.max(...asks.map((r) => r.vol), ...bids.map((r) => r.vol));
  const totalAsk = asks.reduce((s, r) => s + r.vol, 0);
  const totalBid = bids.reduce((s, r) => s + r.vol, 0);
  const bidPct   = (totalBid / (totalAsk + totalBid)) * 100;

  const renderRow = (r: { px: number; vol: number }, side: "ask" | "bid", cum: number) => {
    const barPct = (r.vol / maxVol) * 100;
    const col    = side === "ask" ? SELL_COL : BUY_COL;
    return (
      <button
        key={fmt(r.px)}
        onClick={() => onRowClick(r.px, side)}
        className="flex w-full items-center justify-between px-2 py-[3.5px] font-mono tabular-nums transition-opacity hover:opacity-75"
        style={{
          fontSize: 10,
          background: `linear-gradient(${side === "ask" ? "to right" : "to left"}, color-mix(in srgb, ${col} 22%, transparent) ${barPct}%, transparent ${barPct}%)`,
        }}
      >
        <span style={{ color: col, fontWeight: 600 }}>{fmt(r.px)}</span>
        <span style={{ color: "var(--muted)" }}>{r.vol}</span>
        <span style={{ color: "var(--muted)", opacity: 0.6 }}>{cum}</span>
      </button>
    );
  };

  let cumAsk = 0, cumBid = 0;

  return (
    <div
      className="overflow-hidden border-b border-[var(--border)]"
      style={{ background: "var(--panel)" }}
    >
      {/* Header */}
      <div className="border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          <i className="fa-solid fa-table-list mr-1" />DOM — {symbol}
        </span>
      </div>

      {/* Column headers */}
      <div
        className="grid grid-cols-3 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}
      >
        <span>Price</span>
        <span className="text-center">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks — flex-col-reverse so best ask (index 0) appears at bottom */}
      <div className="flex flex-col-reverse">
        {asks.map((r) => { cumAsk += r.vol; return renderRow(r, "ask", cumAsk); })}
      </div>

      {/* Spread / mid row */}
      <div
        className="flex items-center justify-between border-y border-[var(--border)] px-2.5 py-[5px]"
        style={{ background: "var(--soft)" }}
      >
        <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: SELL_COL }}>{fmt(ask)}</span>
        <span className="text-[8px] font-semibold" style={{ color: "var(--muted)" }}>
          Sprd {Math.round(spreadPips * 10) / 10}
        </span>
        <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: BUY_COL }}>{fmt(bid)}</span>
      </div>

      {/* Bids */}
      <div>
        {bids.map((r) => { cumBid += r.vol; return renderRow(r, "bid", cumBid); })}
      </div>

      {/* Bid/ask imbalance footer */}
      <div className="border-t border-[var(--border)] px-2.5 py-1.5" style={{ background: "var(--soft)" }}>
        <div className="mb-1 flex items-center justify-between text-[8px]">
          <span style={{ color: SELL_COL }}>Ask {totalAsk}</span>
          <span className="font-semibold" style={{ color: "var(--muted)" }}>Volume</span>
          <span style={{ color: BUY_COL }}>Bid {totalBid}</span>
        </div>
        <div
          className="h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${SELL_COL} 28%, transparent)` }}
        >
          <div
            style={{
              width: `${bidPct}%`,
              height: "100%",
              background: BUY_COL,
              borderRadius: "999px",
              transition: "width 0.8s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}
