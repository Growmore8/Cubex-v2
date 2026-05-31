"use client";
import { useEffect, useState } from "react";

export default function AdminSymbolsPage() {
  const [symbols, setSymbols] = useState<any[]>([]);
  const [cat, setCat] = useState("forex");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [added, setAdded] = useState<Record<string, boolean>>({});

  async function loadMine() { const d = await fetch("/api/admin/symbols").then((r) => r.json()); if (d.ok) setSymbols(d.symbols); }
  useEffect(() => { loadMine(); }, []);

  async function search() {
    setLoading(true); setMsg(""); setResults([]);
    const d = await fetch("/api/admin/finnhub?category=" + cat + "&q=" + encodeURIComponent(q)).then((r) => r.json());
    setLoading(false);
    if (!d.ok) { setMsg(d.error || "Finnhub error"); return; }
    setResults(d.symbols);
    if (!d.symbols.length) setMsg("No matches.");
  }
  async function add(s: any) {
    const r = await fetch("/api/admin/symbols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, enabled: true }) });
    const d = await r.json();
    if (d.ok || d.error === "Already added") { setAdded((a) => ({ ...a, [s.feed]: true })); loadMine(); }
    else setMsg(d.error || "Add failed");
  }
  async function toggle(s: any) { await fetch("/api/admin/symbols/" + s.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) }); loadMine(); }
  async function remove(id: string) { if (!confirm("Delete symbol?")) return; await fetch("/api/admin/symbols/" + id, { method: "DELETE" }); loadMine(); }

  const input = "rounded-md border px-3 py-2 text-sm";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Symbols</h1>

      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-semibold">Import from Finnhub (live market list)</div>
        <div className="flex flex-wrap gap-2">
          <select className={input} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="forex">Forex</option><option value="metals">Metals</option><option value="crypto">Crypto</option><option value="stocks">Stocks (US)</option>
          </select>
          <input className={input} placeholder="Search e.g. EUR, BTC, AAPL" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button onClick={search} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white">{loading ? "Loading..." : "Load"}</button>
          {msg && <span className="self-center text-sm text-gray-600">{msg}</span>}
        </div>
        {results.length > 0 && (
          <div className="mt-3 max-h-72 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Feed</th><th className="px-3 py-2">Cat</th><th className="px-3 py-2 text-right">Add</th></tr></thead>
              <tbody>
                {results.map((s) => (
                  <tr key={s.feed} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono">{s.symbol}</td><td className="px-3 py-1.5">{s.display}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-400">{s.feed}</td><td className="px-3 py-1.5">{s.category}</td>
                    <td className="px-3 py-1.5 text-right">{added[s.feed] ? <span className="text-green-600">Added</span> : <button onClick={() => add(s)} className="rounded bg-green-600 px-3 py-1 text-xs text-white">Add</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white">
        <div className="border-b px-3 py-2 text-sm font-semibold">Tenant symbols ({symbols.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Display</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Feed</th><th className="px-3 py-2">Digits</th><th className="px-3 py-2">Enabled</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
            <tbody>
              {symbols.length === 0 ? <tr><td className="px-3 py-4" colSpan={7}>No symbols yet - import some above.</td></tr> : symbols.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono">{s.symbol}</td><td className="px-3 py-2">{s.display}</td><td className="px-3 py-2">{s.category}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{s.feed || "-"}</td><td className="px-3 py-2">{s.digits}</td>
                  <td className="px-3 py-2"><button onClick={() => toggle(s)} className={"rounded px-2 py-0.5 text-xs " + (s.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{s.enabled ? "ON" : "OFF"}</button></td>
                  <td className="px-3 py-2 text-right"><button className="text-red-600" onClick={() => remove(s.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
