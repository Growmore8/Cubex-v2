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
  const [tdKey,       setTdKey]       = useState("");
  const [finnhubKey,  setFinnhubKey]  = useState("");
  const [massiveKey,  setMassiveKey]  = useState("");
  const [primary,     setPrimary]     = useState<Primary>("TD");
  const [err,         setErr]         = useState("");
  const [msg,         setMsg]         = useState("");
  const [loading,     setLoading]     = useState(true);
  const [failoverLog, setFailoverLog] = useState<{ from: string; to: string; ts: number; reason?: string }[]>([]);

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

    fetch("/api/superadmin/feeds/log").then((r) => r.json()).then((d) => {
      if (d.ok && d.logs) setFailoverLog(d.logs.map((l: any) => ({ from: l.fromFeed, to: l.toFeed, ts: new Date(l.ts).getTime(), reason: l.reason })));
    }).catch(() => {});

    const sock = io({ path: "/socket.io" });
    sock.on("feed-failover", (data: any) => {
      setPrimary(data.to as Primary);
      setFailoverLog((prev) => [data, ...prev].slice(0, 50));
    });
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
  const hasEvents = failoverLog.length > 0;

  return (
    <div className="ui-fade-up">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Market Data Feeds</h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Real-time prices &amp; candles. Primary feed drives the market; others are automatic fallback when primary goes quiet.
        </p>
      </div>

      {err && <div className="rounded-lg px-4 py-2 text-sm mb-4" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{err}</div>}
      {msg && <div className="rounded-lg px-4 py-2 text-sm mb-4" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{msg}</div>}

      {/* Two-column layout */}
      <div className="flex gap-4 items-start">

        {/* LEFT — config */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Priority cards */}
          <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="mb-3">
              <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Priority <span className="font-normal text-xs ml-1" style={{ color: "#94a3b8" }}>— click a card to set as primary</span>
              </span>
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
                          : { background: "rgba(100,116,139,0.25)", color: "#94a3b8" }}>
                        {isPrimary ? "PRIMARY" : "FALLBACK"}
                      </span>
                    </div>
                    <div className="text-[11px] mb-2" style={{ color: "#94a3b8" }}>{f.info}</div>
                    <div className="flex items-center gap-1 text-[11px]" style={{ color: hasKey ? "#22c55e" : "#ef4444" }}>
                      <i className={hasKey ? "fa-solid fa-circle-check" : "fa-solid fa-circle-xmark"} />
                      {hasKey ? "key set" : "no key"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* API Keys */}
          <div className="space-y-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {[
              { label: "Twelve Data API key",      hint: "Needs real-time + WebSocket plan. Powers forex, metals, crypto and stocks.", value: tdKey,       set: setTdKey,       ph: "twelvedata.com key" },
              { label: "Finnhub API key",           hint: "Fallback feed. Free tier available at finnhub.io.",                          value: finnhubKey,  set: setFinnhubKey,  ph: "finnhub.io key" },
              { label: "Massive.com Access Key ID", hint: "Ex-Polygon.io. Provides real forex bid/ask via WebSocket.",                  value: massiveKey,  set: setMassiveKey,  ph: "massive.com access key ID" },
            ].map(({ label, hint, value, set, ph }) => (
              <div key={label}>
                <div className="mb-1 text-xs font-medium" style={{ color: "var(--text)" }}>{label}</div>
                <PasswordInput className={inp} placeholder={ph} value={value} onChange={(e: any) => set(e.target.value)} />
                <div className="mt-1 text-[11px]" style={{ color: "#94a3b8" }}>{hint}</div>
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
          <div className="rounded-xl border p-4 text-[12px]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="font-semibold mb-1" style={{ color: "var(--text)" }}>Auto-failover</div>
            <div style={{ color: "#94a3b8" }}>If the primary feed fails 5 consecutive times, the server automatically switches to the next available feed. Events are recorded in the log on the right.</div>
            <div className="mt-1" style={{ color: "#94a3b8" }}>Saving applies instantly — no server restart needed. Keys are stored in your database, never in code.</div>
          </div>
        </div>

        {/* RIGHT — failover log */}
        <div className="w-80 shrink-0 rounded-xl border overflow-hidden sticky top-4"
          style={{
            borderColor: hasEvents ? "#f97316" : "var(--border)",
            background: "var(--card)",
          }}>
          <div className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: hasEvents ? "rgba(249,115,22,0.3)" : "var(--border)" }}>
            <span className="text-sm font-semibold flex items-center gap-2"
              style={{ color: hasEvents ? "#f97316" : "var(--text)" }}>
              <i className={hasEvents ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-clock-rotate-left"} />
              Failover log
              {hasEvents && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "rgba(249,115,22,0.2)", color: "#f97316" }}>
                  {failoverLog.length}
                </span>
              )}
            </span>
            {hasEvents && (
              <button
                onClick={() => { fetch("/api/superadmin/feeds/log", { method: "DELETE" }); setFailoverLog([]); }}
                className="text-[11px] opacity-60 hover:opacity-100"
                style={{ color: "#f97316" }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="divide-y overflow-y-auto" style={{ borderColor: "rgba(100,116,139,0.1)", maxHeight: "480px" }}>
            {failoverLog.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px]" style={{ color: "#94a3b8" }}>
                <i className="fa-solid fa-circle-check block text-2xl mb-2" style={{ color: "#22c55e" }} />
                No failover events.<br />All feeds running normally.
              </div>
            ) : failoverLog.map((ev, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm" style={{ color: "#f97316" }}>{ev.from}</span>
                  <i className="fa-solid fa-arrow-right text-[10px]" style={{ color: "#94a3b8" }} />
                  <span className="font-semibold text-sm" style={{ color: "#22c55e" }}>{ev.to}</span>
                </div>
                <div className="text-[11px]" style={{ color: "#94a3b8" }}>{ev.reason || `switched to ${ev.to}`}</div>
                <div className="text-[10px] mt-0.5 font-mono" style={{ color: "#64748b" }}>{new Date(ev.ts).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
