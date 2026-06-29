"use client";
import { useEffect, useState, useMemo } from "react";

type Ticker = { symbol: string; display: string; name: string; category: string; digits: number };

const CAT_COLOR: Record<string, string> = {
  forex: "#3b82f6", crypto: "#f59e0b", commodities: "#8b5cf6",
  metals: "#8b5cf6", indices: "#22c55e", energy: "#ef4444", stocks: "#64748b",
};

export default function SuperadminSymbolsPage() {
  const [tab, setTab] = useState<"catalog" | "import">("catalog");

  // ── Catalog tab ──
  const [symbols, setSymbols] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/symbols").then((r) => r.json()).then((d) => { if (d.ok) setSymbols(d.symbols); });
  }, []);
  const byCat = (c: string) => symbols.filter((s) => s.category === c);
  const cats = [...new Set(symbols.map((s) => s.category))].sort();

  // ── Import tab ──
  const [loading, setLoading] = useState(false);
  const [mvTickers, setMvTickers] = useState<Ticker[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [mvError, setMvError] = useState("");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);

  function loadMassiveTickers() {
    setLoading(true); setMvError(""); setMvTickers([]);
    fetch("/api/superadmin/massive-tickers")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setMvError(d.error || "Failed"); return; }
        setMvTickers(d.tickers || []);
        setExisting(new Set(d.existing || []));
      })
      .catch((e) => setMvError(e.message))
      .finally(() => setLoading(false));
  }

  const filtered = useMemo(() => {
    let t = mvTickers;
    if (catFilter !== "all") t = t.filter((x) => x.category === catFilter);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      t = t.filter((x) => x.symbol.includes(q) || x.name.toUpperCase().includes(q) || x.display.includes(q));
    }
    return t;
  }, [mvTickers, catFilter, search]);

  const newTickers = filtered.filter((t) => !existing.has(t.symbol));
  const mvCats = [...new Set(mvTickers.map((t) => t.category))].sort();

  function toggleSelect(sym: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  }
  function selectAll() { setSelected(new Set(newTickers.map((t) => t.symbol))); }
  function clearAll() { setSelected(new Set()); }

  async function addSelected() {
    if (!selected.size) return;
    setAdding(true); setAddResult(null);
    const toAdd = mvTickers.filter((t) => selected.has(t.symbol));
    const r = await fetch("/api/superadmin/massive-tickers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: toAdd }),
    }).then((r) => r.json());
    setAdding(false);
    if (r.ok) {
      setAddResult({ added: r.added, skipped: r.skipped });
      setSelected(new Set());
      // Refresh existing set
      setExisting((prev) => { const n = new Set(prev); toAdd.forEach((t) => n.add(t.symbol)); return n; });
      // Refresh catalog tab
      fetch("/api/symbols").then((r) => r.json()).then((d) => { if (d.ok) setSymbols(d.symbols); });
    }
  }

  return (
    <div className="space-y-4 ui-fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>Global Symbols</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>One catalog for all terminals. Import new symbols from Massive's 1,750+ tickers.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["catalog", "import"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); if (t === "import" && !mvTickers.length) loadMassiveTickers(); }}
              style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: tab === t ? "#3b82f6" : "rgba(255,255,255,0.06)", color: tab === t ? "#fff" : "#94a3b8" }}>
              {t === "catalog" ? `Catalog (${symbols.length})` : "Import from Massive"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Catalog tab ── */}
      {tab === "catalog" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cats.map((cat) => (
            <div key={cat} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 14, border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: CAT_COLOR[cat] || "#94a3b8", marginBottom: 8, textTransform: "capitalize" }}>
                {cat} <span style={{ fontWeight: 400, color: "#64748b" }}>({byCat(cat).length})</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {byCat(cat).map((s) => (
                  <span key={s.symbol} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontFamily: "monospace", color: "#e2e8f0" }}>
                    {s.symbol}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Import tab ── */}
      {tab === "import" && (
        <div>
          {loading && (
            <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>
              <div style={{ fontSize: 15 }}>Fetching Massive ticker list…</div>
            </div>
          )}
          {mvError && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 16, color: "#ef4444" }}>
              {mvError}
              <button onClick={loadMassiveTickers} style={{ marginLeft: 12, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
            </div>
          )}
          {!loading && !mvError && mvTickers.length > 0 && (
            <>
              {/* Toolbar */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or name…"
                  style={{ flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 13 }} />
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                  style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#1e293b", color: "#e2e8f0", fontSize: 13 }}>
                  <option value="all">All categories</option>
                  {mvCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={selectAll} style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(59,130,246,0.15)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)", cursor: "pointer", fontSize: 13 }}>
                  Select all new ({newTickers.length})
                </button>
                {selected.size > 0 && (
                  <button onClick={clearAll} style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 13 }}>
                    Clear
                  </button>
                )}
                <button onClick={addSelected} disabled={!selected.size || adding}
                  style={{ padding: "7px 16px", borderRadius: 8, background: selected.size ? "#3b82f6" : "rgba(59,130,246,0.3)", color: "#fff", border: "none", cursor: selected.size ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
                  {adding ? "Adding…" : `Add ${selected.size} symbol${selected.size !== 1 ? "s" : ""}`}
                </button>
                <button onClick={loadMassiveTickers} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 13 }}>
                  ↻ Refresh
                </button>
              </div>

              {addResult && (
                <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "10px 14px", color: "#22c55e", fontSize: 13, marginBottom: 10 }}>
                  ✓ Added {addResult.added} symbol{addResult.added !== 1 ? "s" : ""} to catalog. {addResult.skipped > 0 ? `${addResult.skipped} already existed.` : ""}
                </div>
              )}

              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                Showing {filtered.length} of {mvTickers.length} tickers · {existing.size} already in catalog
              </div>

              {/* Ticker grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {filtered.map((t) => {
                  const inCatalog = existing.has(t.symbol);
                  const isSel = selected.has(t.symbol);
                  return (
                    <div key={t.symbol} onClick={() => !inCatalog && toggleSelect(t.symbol)}
                      style={{ background: inCatalog ? "rgba(255,255,255,0.02)" : isSel ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${inCatalog ? "rgba(255,255,255,0.05)" : isSel ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.09)"}`,
                        borderRadius: 8, padding: "9px 12px", cursor: inCatalog ? "default" : "pointer",
                        opacity: inCatalog ? 0.45 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: inCatalog ? "#22c55e" : isSel ? "#3b82f6" : "rgba(255,255,255,0.15)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "#e2e8f0" }}>{t.display}</div>
                        <div style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                      </div>
                      <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 4, background: `${CAT_COLOR[t.category] || "#64748b"}22`, color: CAT_COLOR[t.category] || "#94a3b8", flexShrink: 0, textTransform: "capitalize" }}>
                        {t.category === "commodities" ? "metal" : t.category}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
