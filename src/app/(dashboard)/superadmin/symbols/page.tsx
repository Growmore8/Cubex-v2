"use client";
import { useEffect, useState, useMemo } from "react";

type Sym = { symbol: string; display: string; category: string; digits: number; enabled: boolean; feed?: string };
type Ticker = { symbol: string; display: string; name: string; category: string; digits: number; exchange?: string; feed?: string };

const CAT_COLOR: Record<string, string> = {
  forex: "#3b82f6", crypto: "#f59e0b", commodities: "#8b5cf6",
  metals: "#8b5cf6", indices: "#22c55e", energy: "#ef4444", stocks: "#64748b",
};

export default function SuperadminSymbolsPage() {
  const [tab, setTab] = useState<"catalog" | "import">("catalog");

  // ── Catalog ──
  const [symbols, setSymbols] = useState<Sym[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  function loadCatalog() {
    setCatLoading(true);
    fetch("/api/superadmin/all-symbols").then((r) => r.json())
      .then((d) => { if (d.ok) setSymbols(d.symbols || []); })
      .catch(() => {}).finally(() => setCatLoading(false));
  }
  useEffect(() => { loadCatalog(); }, []);

  const cats = useMemo(() => [...new Set(symbols.map((s) => s.category).filter(Boolean))].sort() as string[], [symbols]);
  const byCat = (c: string) => symbols.filter((s) => s.category === c);

  const [bulkToggling, setBulkToggling] = useState<string | null>(null);

  async function toggleEnabled(sym: Sym) {
    setToggling(sym.symbol);
    await fetch("/api/superadmin/all-symbols", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym.symbol, enabled: !sym.enabled }),
    });
    setSymbols((prev) => prev.map((s) => s.symbol === sym.symbol ? { ...s, enabled: !s.enabled } : s));
    setToggling(null);
  }

  async function bulkToggle(syms: Sym[], enabled: boolean, key: string) {
    setBulkToggling(key);
    const symbolList = syms.map((s) => s.symbol);
    await fetch("/api/superadmin/all-symbols", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symbolList, enabled }),
    });
    setSymbols((prev) => prev.map((s) => symbolList.includes(s.symbol) ? { ...s, enabled } : s));
    setBulkToggling(null);
  }

  // Split stocks by exchange: NSE/BSE have feed like "NSE:RELIANCE"
  const isNseStock = (s: Sym) => !!s.feed && /^(NSE|BSE):/.test(s.feed);
  const nseStocks = useMemo(() => symbols.filter((s) => s.category === "stocks" && isNseStock(s)), [symbols]);
  const nyseStocks = useMemo(() => symbols.filter((s) => s.category === "stocks" && !isNseStock(s)), [symbols]);

  // ── Import ──
  const [mvLoading, setMvLoading] = useState(false);
  const [mvTickers, setMvTickers] = useState<Ticker[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [mvError, setMvError] = useState("");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);

  function loadMassiveTickers() {
    setMvLoading(true); setMvError(""); setMvTickers([]);
    fetch("/api/superadmin/massive-tickers").then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setMvError(d.error || "Failed"); return; }
        setMvTickers(d.tickers || []);
        setExisting(new Set(d.existing || []));
      })
      .catch((e) => setMvError(e.message))
      .finally(() => setMvLoading(false));
  }

  const filtered = useMemo(() => {
    let t = mvTickers;
    if (catFilter !== "all") t = t.filter((x) => x.category === catFilter);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      t = t.filter((x) => x.symbol.includes(q) || x.name.toUpperCase().includes(q) || x.display.toUpperCase().includes(q));
    }
    return t;
  }, [mvTickers, catFilter, search]);

  const [exchFilter, setExchFilter] = useState("all");

  const newTickers = filtered.filter((t) => !existing.has(t.symbol));
  const mvCats = [...new Set(mvTickers.map((t) => t.category))].sort();

  // Exchange sub-filter (only relevant when catFilter === "stocks")
  const filteredByExch = useMemo(() => {
    if (exchFilter === "all" || catFilter !== "stocks") return filtered;
    return filtered.filter((t) => t.exchange === exchFilter);
  }, [filtered, exchFilter, catFilter]);

  const newByExch = filteredByExch.filter((t) => !existing.has(t.symbol));

  // Unique exchanges within stocks
  const stockExchanges = useMemo(() =>
    [...new Set(mvTickers.filter((t) => t.category === "stocks" && t.exchange).map((t) => t.exchange!))].sort(),
    [mvTickers]
  );

  function toggleSelect(sym: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  }

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
      setExisting((prev) => { const n = new Set(prev); toAdd.forEach((t) => n.add(t.symbol)); return n; });
      loadCatalog();
    }
  }

  const enabledCount = symbols.filter((s) => s.enabled).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text)" }}>Global Symbols</h1>
          <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, marginBottom: 0 }}>
            {symbols.length} symbols total · {enabledCount} enabled · {symbols.length - enabledCount} disabled
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setTab("catalog")} style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: tab === "catalog" ? "#3b82f6" : "var(--bg2)", color: tab === "catalog" ? "#fff" : "var(--text2)" }}>
            Catalog ({symbols.length})
          </button>
          <button onClick={() => { setTab("import"); if (!mvTickers.length && !mvLoading) loadMassiveTickers(); }}
            style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: tab === "import" ? "#3b82f6" : "var(--bg2)", color: tab === "import" ? "#fff" : "var(--text2)" }}>
            + Import from Massive
          </button>
        </div>
      </div>

      {/* ── Catalog tab ── */}
      {tab === "catalog" && (
        <div>
          {catLoading && <p style={{ color: "var(--text2)", fontSize: 13 }}>Loading…</p>}
          {!catLoading && symbols.length === 0 && (
            <p style={{ color: "var(--text2)", fontSize: 13 }}>No symbols yet. Click &quot;+ Import from Massive&quot; to add from 1,750+ tickers.</p>
          )}
          {cats.map((cat) => {
            if (cat === "stocks") return null; // rendered separately below
            const items = byCat(cat);
            return (
              <div key={cat} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: CAT_COLOR[cat] || "var(--text2)", textTransform: "capitalize" }}>{cat}</span>
                  <span style={{ fontSize: 11, color: "var(--text2)" }}>{items.filter((s) => s.enabled).length}/{items.length} enabled</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {items.map((s) => (
                    <button key={s.symbol} onClick={() => toggleEnabled(s)} disabled={toggling === s.symbol}
                      title={s.enabled ? "Click to disable" : "Click to enable"}
                      style={{ fontFamily: "monospace", fontSize: 11, padding: "3px 10px", borderRadius: 6, border: `1px solid ${s.enabled ? (CAT_COLOR[cat] || "var(--border)") : "var(--border)"}`, cursor: "pointer",
                        background: s.enabled ? `${CAT_COLOR[cat] || "#3b82f6"}18` : "var(--bg2)",
                        color: s.enabled ? (CAT_COLOR[cat] || "var(--text)") : "var(--text2)",
                        opacity: toggling === s.symbol ? 0.5 : 1, transition: "all 0.15s" }}>
                      {s.display || s.symbol}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Stocks split: NYSE/NASDAQ + NSE ── */}
          {(nyseStocks.length > 0 || nseStocks.length > 0) && (() => {
            const StockGroup = ({ label, items, groupKey, color }: { label: string; items: Sym[]; groupKey: string; color: string }) => {
              const enabledCnt = items.filter((s) => s.enabled).length;
              const allEnabled = enabledCnt === items.length;
              const allDisabled = enabledCnt === 0;
              return (
                <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
                    <span style={{ fontSize: 11, color: "var(--text2)" }}>{enabledCnt}/{items.length} enabled</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                      <button onClick={() => bulkToggle(items.filter((s) => !s.enabled), true, groupKey + ":on")}
                        disabled={allEnabled || bulkToggling === groupKey + ":on"}
                        style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #22c55e", cursor: allEnabled ? "not-allowed" : "pointer",
                          background: "rgba(34,197,94,0.1)", color: "#22c55e", opacity: allEnabled ? 0.4 : 1 }}>
                        {bulkToggling === groupKey + ":on" ? "…" : "Enable all"}
                      </button>
                      <button onClick={() => bulkToggle(items.filter((s) => s.enabled), false, groupKey + ":off")}
                        disabled={allDisabled || bulkToggling === groupKey + ":off"}
                        style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #ef4444", cursor: allDisabled ? "not-allowed" : "pointer",
                          background: "rgba(239,68,68,0.1)", color: "#ef4444", opacity: allDisabled ? 0.4 : 1 }}>
                        {bulkToggling === groupKey + ":off" ? "…" : "Disable all"}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {items.map((s) => (
                      <button key={s.symbol} onClick={() => toggleEnabled(s)} disabled={toggling === s.symbol}
                        title={s.enabled ? "Click to disable (hides from market watch)" : "Click to enable"}
                        style={{ fontFamily: "monospace", fontSize: 11, padding: "3px 10px", borderRadius: 6,
                          border: `1px solid ${s.enabled ? color : "var(--border)"}`, cursor: "pointer",
                          background: s.enabled ? `${color}18` : "var(--bg2)",
                          color: s.enabled ? color : "var(--text2)",
                          opacity: toggling === s.symbol ? 0.5 : 1, transition: "all 0.15s" }}>
                        {s.display || s.symbol}
                      </button>
                    ))}
                  </div>
                  {label.includes("NSE") && (
                    <p style={{ fontSize: 10, color: "var(--text2)", marginTop: 8, marginBottom: 0 }}>
                      Disable all = hidden from traders market watch. Prices still stream to Redis for the external API.
                    </p>
                  )}
                </div>
              );
            };
            return (
              <>
                {nyseStocks.length > 0 && <StockGroup label="Stocks — NYSE / NASDAQ" items={nyseStocks} groupKey="nyse" color="#3b82f6" />}
                {nseStocks.length > 0 && <StockGroup label="Stocks — NSE / BSE (India)" items={nseStocks} groupKey="nse" color="#eab308" />}
              </>
            );
          })()}
        </div>
      )}

      {/* ── Import tab ── */}
      {tab === "import" && (
        <div>
          {mvLoading && <p style={{ color: "var(--text2)", fontSize: 13, padding: "24px 0" }}>Fetching Massive ticker list…</p>}
          {mvError && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 14, color: "#ef4444", marginBottom: 12 }}>
              {mvError}
              <button onClick={loadMassiveTickers} style={{ marginLeft: 12, color: "var(--text2)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
            </div>
          )}
          {!mvLoading && !mvError && mvTickers.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or name…"
                  style={{ flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 13 }} />
                <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setExchFilter("all"); }}
                  style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 13 }}>
                  <option value="all">All categories</option>
                  {mvCats.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
                {catFilter === "stocks" && stockExchanges.length > 0 && (
                  <select value={exchFilter} onChange={(e) => setExchFilter(e.target.value)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 13 }}>
                    <option value="all">All exchanges</option>
                    {stockExchanges.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                )}
                <button onClick={() => setSelected(new Set(newByExch.map((t) => t.symbol)))}
                  style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(59,130,246,0.15)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)", cursor: "pointer", fontSize: 13 }}>
                  Select all new ({newByExch.length})
                </button>
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())}
                    style={{ padding: "7px 12px", borderRadius: 8, background: "var(--bg2)", color: "var(--text2)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>Clear</button>
                )}
                <button onClick={addSelected} disabled={!selected.size || adding}
                  style={{ padding: "7px 16px", borderRadius: 8, background: selected.size ? "#3b82f6" : "rgba(59,130,246,0.3)", color: "#fff", border: "none", cursor: selected.size ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
                  {adding ? "Adding…" : `Add ${selected.size} symbol${selected.size !== 1 ? "s" : ""}`}
                </button>
                <button onClick={loadMassiveTickers}
                  style={{ padding: "7px 10px", borderRadius: 8, background: "var(--bg2)", color: "var(--text2)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>↻</button>
              </div>

              {/* NYSE / NSE quick-select row when viewing stocks */}
              {catFilter === "stocks" && !search && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {stockExchanges.map((exch) => {
                    const exchNew = mvTickers.filter((t) => t.category === "stocks" && t.exchange === exch && !existing.has(t.symbol));
                    return (
                      <button key={exch} onClick={() => { setExchFilter(exch); setSelected(new Set(exchNew.map((t) => t.symbol))); }}
                        style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)",
                          background: exchFilter === exch ? "#3b82f6" : "var(--bg2)", color: exchFilter === exch ? "#fff" : "var(--text2)" }}>
                        {exch} <span style={{ opacity: 0.7, fontWeight: 400 }}>({exchNew.length} new)</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {addResult && (
                <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "10px 14px", color: "#22c55e", fontSize: 13, marginBottom: 10 }}>
                  ✓ Added {addResult.added} symbol{addResult.added !== 1 ? "s" : ""} to catalog.{addResult.skipped > 0 ? ` ${addResult.skipped} already existed.` : ""}
                </div>
              )}

              <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
                Showing {filteredByExch.length} of {mvTickers.length} tickers · {existing.size} already in catalog (greyed out) · click tiles to select
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
                {filteredByExch.map((t) => {
                  const inCatalog = existing.has(t.symbol);
                  const isSel = selected.has(t.symbol);
                  return (
                    <div key={t.symbol} onClick={() => !inCatalog && toggleSelect(t.symbol)}
                      style={{ background: isSel ? "rgba(59,130,246,0.12)" : "var(--bg2)",
                        border: `1px solid ${isSel ? "#3b82f6" : "var(--border)"}`,
                        borderRadius: 8, padding: "8px 10px", cursor: inCatalog ? "default" : "pointer",
                        opacity: inCatalog ? 0.4 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                        background: inCatalog ? "#22c55e" : isSel ? "#3b82f6" : "var(--border)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "var(--text)" }}>{t.display}</div>
                        <div style={{ fontSize: 10, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                        {t.exchange && (
                          <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3,
                            background: t.exchange === "NSE" ? "rgba(234,179,8,0.2)" : t.exchange === "NYSE/NASDAQ" ? "rgba(59,130,246,0.2)" : "rgba(100,116,139,0.2)",
                            color: t.exchange === "NSE" ? "#ca8a04" : t.exchange === "NYSE/NASDAQ" ? "#3b82f6" : "var(--text2)", fontWeight: 700 }}>
                            {t.exchange}
                          </span>
                        )}
                        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3,
                          background: `${CAT_COLOR[t.category] || "#64748b"}22`, color: CAT_COLOR[t.category] || "var(--text2)", textTransform: "capitalize" }}>
                          {t.category === "commodities" ? "metal" : t.category}
                        </span>
                      </div>
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
