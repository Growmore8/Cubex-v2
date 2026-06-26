"use client";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import PasswordInput from "@/components/ui/PasswordInput";

type Primary = "TD" | "FH" | "MV";

const FEEDS: { key: Primary; name: string; info: string }[] = [
  { key: "TD", name: "Twelve Data",    info: "forex · metals · crypto · stocks" },
  { key: "FH", name: "Finnhub",        info: "forex · metals · crypto · stocks" },
  { key: "MV", name: "Massive.com",    info: "forex real bid/ask (ex-Polygon.io)" },
];

export default function SAFeeds() {
  const [tdKey,      setTdKey]      = useState("");
  const [finnhubKey, setFinnhubKey] = useState("");
  const [massiveKey, setMassiveKey] = useState("");
  const [primary,    setPrimary]    = useState<Primary>("TD");
  const [err,        setErr]        = useState("");
  const [msg,        setMsg]        = useState("");
  const [loading,    setLoading]    = useState(true);
  const [failover,   setFailover]   = useState<{ from: string; to: string; ts: number } | null>(null);

  useEffect(() => {
    fetch("/api/superadmin/feeds").then((r) => r.json()).then((d) => {
      if (d.ok && d.feeds) {
        setTdKey(d.feeds.tdKey || "");
        setFinnhubKey(d.feeds.finnhubKey || "");
        setMassiveKey(d.feeds.massiveKey || "");
        setPrimary((d.feeds.primary as Primary) || "TD");
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    // Listen for auto-failover events from server
    const sock = io({ path: "/socket.io" });
    sock.on("feed-failover", (data: any) => setFailover(data));
    return () => { sock.disconnect(); };
  }, []);

  async function save() {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tdKey, finnhubKey, massiveKey, primary }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMsg("Saved — the price engine reloaded with new keys.");
    setTimeout(() => setMsg(""), 3000);
  }

  const keyOf = (k: Primary) => k === "TD" ? tdKey : k === "FH" ? finnhubKey : massiveKey;
  const inp = "w-full rounded-lg border px-3 py-2 text-sm font-mono bg-[var(--bg)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <div className="max-w-3xl space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Market Data Feeds</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Real-time prices &amp; candles. Primary feed drives the market; others are automatic fallback when primary goes quiet.
        </p>
      </div>

      {/* Auto-failover alert */}
      {failover && (
        <div className="rounded-lg border px-4 py-3 text-sm flex items-center gap-3" style={{ borderColor: "#f97316", background: "rgba(249,115,22,0.08)", color: "#f97316" }}>
          <i className="fa-solid fa-triangle-exclamation" />
          <span><strong>Auto-failover triggered:</strong> {failover.from} → {failover.to} at {new Date(failover.ts).toLocaleTimeString()}</span>
          <button onClick={() => setFailover(null)} className="ml-auto opacity-60 hover:opacity-100"><i className="fa-solid fa-xmark" /></button>
        </div>
      )}

      {err && <div className="rounded-lg px-4 py-2 text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{err}</div>}
      {msg && <div className="rounded-lg px-4 py-2 text-sm" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{msg}</div>}

      {/* Priority cards — click any card to set as primary */}
      <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Priority <span className="font-normal text-xs ml-1" style={{ color: "var(--muted)" }}>— click a card to set as primary</span></span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {FEEDS.map((f) => {
            const isPrimary = f.key === primary;
            const hasKey = !!keyOf(f.key);
            return (
              <button
                key={f.key}
                onClick={() => setPrimary(f.key)}
                className="rounded-xl border p-3 text-left transition-all"
                style={{
                  borderColor: isPrimary ? "#22c55e" : "var(--border)",
                  background: isPrimary ? "rgba(34,197,94,0.08)" : "var(--bg)",
                  boxShadow: isPrimary ? "0 0 0 1px #22c55e" : "none",
                  cursor: "pointer",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>{f.name}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={isPrimary
                      ? { background: "rgba(34,197,94,0.2)", color: "#22c55e" }
                      : { background: "rgba(100,116,139,0.15)", color: "var(--muted)" }}>
                    {isPrimary ? "PRIMARY" : "FALLBACK"}
                  </span>
                </div>
                <div className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>{f.info}</div>
                <div className="flex items-center gap-1 text-[11px]" style={{ color: hasKey ? "#22c55e" : "#ef4444" }}>
                  <i className={hasKey ? "fa-solid fa-circle-check" : "fa-solid fa-circle-xmark"} />
                  {hasKey ? "key set" : "no key"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Keys */}
      <div className="space-y-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {[
          { label: "Twelve Data API key", hint: "Needs real-time + WebSocket plan. Powers forex, metals, crypto and stocks.", value: tdKey, set: setTdKey, ph: "twelvedata.com key" },
          { label: "Finnhub API key", hint: "Fallback feed. Free tier available at finnhub.io.", value: finnhubKey, set: setFinnhubKey, ph: "finnhub.io key" },
          { label: "Massive.com API key", hint: "Ex-Polygon.io. Provides real forex bid/ask via WebSocket. Enter your Access Key ID.", value: massiveKey, set: setMassiveKey, ph: "massive.com access key" },
        ].map(({ label, hint, value, set, ph }) => (
          <div key={label}>
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--text)" }}>{label}</div>
            <PasswordInput className={inp} placeholder={ph} value={value} onChange={(e: any) => set(e.target.value)} />
            <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>{hint}</div>
          </div>
        ))}
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--accent)" }}
          onClick={save}
          disabled={loading}
        >
          Save &amp; Apply
        </button>
      </div>

      {/* Auto-failover info */}
      <div className="rounded-xl border p-4 text-[12px] space-y-1" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted)" }}>
        <div className="font-semibold" style={{ color: "var(--text)" }}>Auto-failover</div>
        <div>If the primary feed fails 5 consecutive times, the server automatically switches to the next available feed and sends an alert here in real-time.</div>
        <div className="mt-1">Saving applies instantly — the price engine reconnects with the new keys. Keys are stored in your database, never in the code.</div>
      </div>
    </div>
  );
}
