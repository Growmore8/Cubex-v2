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
  const primFeed = FEEDS.find((f) => f.key === primary)!;
  const secFeeds = FEEDS.filter((f) => f.key !== primary);

  const roleStyle = (role: "PRIMARY" | "FALLBACK") =>
    role === "PRIMARY"
      ? { background: "rgba(34,197,94,0.15)", color: "#22c55e" }
      : { background: "rgba(249,115,22,0.15)", color: "#f97316" };

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

      {/* Priority cards */}
      <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Priority</span>
          <button
            onClick={() => setPrimary((p) => {
              const idx = FEEDS.findIndex((f) => f.key === p);
              return FEEDS[(idx + 1) % FEEDS.length].key;
            })}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--soft)]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <i className="fa-solid fa-right-left" />Swap primary / fallback
          </button>
        </div>
        <div className="flex items-stretch gap-3">
          {/* Primary */}
          <div className="flex-1 rounded-lg border p-3" style={{ borderColor: "#22c55e", background: "rgba(34,197,94,0.06)" }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>{primFeed.name}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={roleStyle("PRIMARY")}>PRIMARY</span>
            </div>
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>{primFeed.info}</div>
            <div className="mt-1 text-[11px]" style={{ color: keyOf(primFeed.key) ? "#22c55e" : "var(--muted)" }}>
              {keyOf(primFeed.key) ? "✓ key set" : "⚠ no key"}
            </div>
          </div>
          {/* Fallbacks */}
          <div className="flex flex-1 flex-col gap-2">
            {secFeeds.map((f) => (
              <div key={f.key} className="flex-1 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>{f.name}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={roleStyle("FALLBACK")}>FALLBACK</span>
                </div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>{f.info}</div>
                <div className="mt-1 text-[11px]" style={{ color: keyOf(f.key) ? "#22c55e" : "var(--muted)" }}>
                  {keyOf(f.key) ? "✓ key set" : "no key"}
                </div>
              </div>
            ))}
          </div>
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
