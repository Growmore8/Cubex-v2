"use client";
import { useEffect, useRef, useState } from "react";

// Searchable symbol dropdown for the desk (themed with the trading CSS vars).
// Drop-in for a <select> of symbols: shows the current symbol, opens a panel
// with a search box + filtered list.
export default function SymbolPicker({
  symbols, value, onChange, className = "",
}: {
  symbols: { symbol: string; display?: string }[];
  value: string;
  onChange: (sym: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const ql = q.trim().toLowerCase();
  const list = ql ? symbols.filter((s) => (s.symbol + " " + (s.display || "")).toLowerCase().includes(ql)) : symbols;

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => { setQ(""); setOpen((o) => !o); }}
        className={className + " flex items-center justify-between text-left"}>
        <span>{value || "Select symbol"}</span>
        <i className="fa-solid fa-chevron-down text-[9px] opacity-60" />
      </button>
      {open && (
        <div className="absolute z-[200] mt-1 w-full overflow-hidden rounded-lg border shadow-2xl"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
          <div className="p-1.5">
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol…"
              className="w-full rounded border px-2 py-1 text-xs outline-none"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
          </div>
          <div className="max-h-56 overflow-auto pb-1">
            {list.length === 0 ? (
              <div className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>No match</div>
            ) : list.map((s) => (
              <button key={s.symbol} type="button"
                onClick={() => { onChange(s.symbol); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--soft)]"
                style={{ color: "var(--text)", background: s.symbol === value ? "var(--soft)" : "transparent" }}>
                <span>{s.symbol}</span>
                {s.display && s.display !== s.symbol ? <span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.display}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
