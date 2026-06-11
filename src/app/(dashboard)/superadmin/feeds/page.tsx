"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

export default function SAFeeds() {
  const [tdKey, setTdKey] = useState("");
  const [finnhubKey, setFinnhubKey] = useState("");
  const [primary, setPrimary] = useState<"TD" | "FH">("TD");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/superadmin/feeds").then((r) => r.json()).then((d) => {
      if (d.ok && d.feeds) { setTdKey(d.feeds.tdKey || ""); setFinnhubKey(d.feeds.finnhubKey || ""); setPrimary(d.feeds.primary === "FH" ? "FH" : "TD"); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function save() {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/feeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tdKey, finnhubKey, primary }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMsg("Saved — the price engine reloaded the feeds.");
    setTimeout(() => setMsg(""), 2500);
  }

  const inp = "ui-input rounded-md border px-3 py-2 text-sm w-full font-mono";
  const TD = { key: "TD" as const, name: "Twelve Data", info: "forex · metals · crypto · stocks" };
  const FH = { key: "FH" as const, name: "Finnhub", info: "forex · crypto · stocks" };
  const primFeed = primary === "TD" ? TD : FH;
  const secFeed = primary === "TD" ? FH : TD;

  const Role = ({ role }: { role: "PRIMARY" | "FALLBACK" }) => (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={role === "PRIMARY" ? { background: "#dcfce7", color: "#15803d" } : { background: "#fff7ed", color: "#c2410c" }}>{role}</span>
  );

  return (
    <div className="max-w-3xl space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">Market Data Feeds</h1>
        <p className="text-sm text-gray-500">Real-time prices &amp; candles. The primary feed drives the market; the other is an automatic fallback when the primary goes quiet.</p>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {msg && <div className="text-sm text-green-600">{msg}</div>}

      {/* Primary / fallback overview + swap */}
      <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-700">Priority</div>
          <button onClick={() => setPrimary((p) => (p === "TD" ? "FH" : "TD"))} className="ui-btn px-3 py-1.5 text-xs font-semibold" title="Swap primary / fallback">
            <i className="fa-solid fa-right-left mr-1.5" />Swap primary / fallback
          </button>
        </div>
        <div className="flex items-stretch gap-3">
          {[{ f: primFeed, role: "PRIMARY" as const }, { f: secFeed, role: "FALLBACK" as const }].map(({ f, role }) => (
            <div key={f.key} className="flex-1 rounded-lg border p-3" style={{ borderColor: role === "PRIMARY" ? "#86efac" : "#e2e8f0", background: role === "PRIMARY" ? "#f0fdf4" : "#fff" }}>
              <div className="mb-1 flex items-center justify-between"><span className="font-semibold">{f.name}</span><Role role={role} /></div>
              <div className="text-[11px] text-gray-500">{f.info}</div>
              <div className="mt-1 text-[11px]" style={{ color: (f.key === "TD" ? tdKey : finnhubKey) ? "#15803d" : "#9ca3af" }}>{(f.key === "TD" ? tdKey : finnhubKey) ? "✓ key set" : "no key"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Keys */}
      <div className="space-y-3 ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
        <div>
          <div className="text-xs text-gray-500">Twelve Data API key</div>
          <PasswordInput className={inp} placeholder="twelvedata.com key" value={tdKey} onChange={(e: any) => setTdKey(e.target.value)} />
          <div className="mt-1 text-[11px] text-gray-400">Needs a plan with real-time + WebSocket. Powers forex, metals, crypto and stocks.</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Finnhub API key</div>
          <PasswordInput className={inp} placeholder="finnhub.io key" value={finnhubKey} onChange={(e: any) => setFinnhubKey(e.target.value)} />
          <div className="mt-1 text-[11px] text-gray-400">Used as the fallback feed (or set it as primary above).</div>
        </div>
        <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" onClick={save} disabled={loading}>Save &amp; Apply</button>
      </div>
      <p className="text-[11px] text-gray-400">Saving applies instantly — the price engine reconnects with the new keys/priority. Keys are stored in your database, never in the code.</p>
    </div>
  );
}
