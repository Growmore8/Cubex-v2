"use client";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import PasswordInput from "@/components/ui/PasswordInput";

// ── Feed options per asset category ────────────────────────────────────────
const CAT_FEEDS: Record<string, { key: string; name: string; free: boolean; hasBidAsk: boolean; info: string }[]> = {
  crypto: [
    { key: "MV", name: "Massive.com",  free: false, hasBidAsk: true,  info: "Real bid/ask · $49/mo plan required" },
    { key: "TD", name: "TwelveData",   free: false, hasBidAsk: false, info: "Price only · key required" },
    { key: "FH", name: "Finnhub",      free: false, hasBidAsk: false, info: "Price only · Finnhub key required" },
  ],
  forex: [
    { key: "MV", name: "Massive.com",  free: false, hasBidAsk: true,  info: "Real bid/ask · $49/mo plan required" },
    { key: "TD", name: "TwelveData",   free: false, hasBidAsk: false, info: "Price only · key required" },
    { key: "FH", name: "Finnhub",      free: false, hasBidAsk: false, info: "Price only · key required" },
  ],
  commodities: [
    { key: "MV", name: "Massive.com",  free: false, hasBidAsk: true,  info: "Real bid/ask · metals as forex pairs" },
    { key: "TD", name: "TwelveData",   free: false, hasBidAsk: false, info: "Metals + energy · key required" },
  ],
  indices: [
    { key: "TD", name: "TwelveData",   free: false, hasBidAsk: false, info: "All major indices · key required" },
    { key: "FH", name: "Finnhub",      free: false, hasBidAsk: false, info: "Major indices · key required" },
  ],
  stocks: [
    { key: "TD", name: "TwelveData",   free: false, hasBidAsk: true,  info: "NYSE/NASDAQ + NSE/BSE · key required" },
    { key: "FH", name: "Finnhub",      free: false, hasBidAsk: false, info: "US stocks only · demo/limited" },
  ],
};

const CATEGORIES: { key: string; catName: string; label: string; icon: string; color: string }[] = [
  { key: "cryptoFeed", catName: "crypto",       label: "Crypto",      icon: "fa-brands fa-bitcoin",   color: "#f59e0b" },
  { key: "forexFeed",  catName: "forex",        label: "Forex",        icon: "fa-solid fa-coins",       color: "#3b82f6" },
  { key: "commFeed",   catName: "commodities",  label: "Commodities",  icon: "fa-solid fa-oil-well",    color: "#8b5cf6" },
  { key: "idxFeed",    catName: "indices",      label: "Indices",      icon: "fa-solid fa-chart-line",  color: "#22c55e" },
  { key: "stockFeed",  catName: "stocks",       label: "Stocks",       icon: "fa-solid fa-building-columns", color: "#64748b" },
];

type TestStatus = { status: "idle" | "checking" | "ok" | "error"; latency?: number; error?: string };

// ── Needs API key? ──────────────────────────────────────────────────────────
const CAT_KEY_MAP: Record<string, string> = { cryptoFeed: "crypto", forexFeed: "forex", commFeed: "commodities", idxFeed: "indices" };
function needsKey(catKey: string, feedKey: string, keys: Record<string, string>) {
  const opt = CAT_FEEDS[CAT_KEY_MAP[catKey] || catKey]?.find((f) => f.key === feedKey);
  if (!opt || opt.free) return false;
  if (feedKey === "TD") return !keys.tdKey;
  if (feedKey === "FH") return !keys.finnhubKey;
  if (feedKey === "MV") return !keys.massiveKey;
  return false;
}

function getApiKey(feedKey: string, keys: Record<string, string>) {
  if (feedKey === "TD") return keys.tdKey;
  if (feedKey === "FH") return keys.finnhubKey;
  if (feedKey === "MV") return keys.massiveKey;
  return "";
}

// Primary feed provider cards — Massive primary, TD + FH as fallback
const PRIMARY_CARDS = [
  { key: "MV", name: "Massive",     icon: "fa-solid fa-bolt",           color: "#ec4899", free: false, desc: "Forex real bid/ask" },
  { key: "TD", name: "TwelveData",  icon: "fa-solid fa-database",       color: "#3b82f6", free: false, desc: "Forex/crypto/indices/metals" },
  { key: "FH", name: "Finnhub",     icon: "fa-solid fa-satellite-dish", color: "#22c55e", free: false, desc: "Stocks/forex/crypto" },
];

export default function SAFeeds() {
  const [keys, setKeys] = useState({ tdKey: "", finnhubKey: "", massiveKey: "" });
  const [feeds, setFeeds] = useState({ cryptoFeed: "BN", forexFeed: "KR", commFeed: "KR", idxFeed: "TD" });
  const [primary, setPrimaryState] = useState("TD");
  const [err,  setErr]  = useState("");
  const [msg,  setMsg]  = useState("");
  const [loading, setLoading] = useState(true);
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [logTab, setLogTab] = useState<"failover" | "errors">("failover");
  const [failoverLog, setFailoverLog] = useState<{ from: string; to: string; ts: number; reason?: string }[]>([]);
  const [errorLog,    setErrorLog]    = useState<{ category: string; provider: string; errorType: string; message: string; ts: number }[]>([]);

  useEffect(() => {
    fetch("/api/superadmin/feeds").then((r) => r.json()).then((d) => {
      if (d.ok && d.feeds) {
        setKeys({ tdKey: d.feeds.tdKey || "", finnhubKey: d.feeds.finnhubKey || "", massiveKey: d.feeds.massiveKey || "" });
        setFeeds({ cryptoFeed: d.feeds.cryptoFeed || "BN", forexFeed: d.feeds.forexFeed || "TD", commFeed: d.feeds.commFeed || "TD", idxFeed: d.feeds.idxFeed || "TD" });
        if (d.feeds.currentPrimary) setPrimaryState(d.feeds.currentPrimary);
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    fetch("/api/superadmin/feeds/log?type=failover").then((r) => r.json()).then((d) => {
      if (d.ok) setFailoverLog(d.logs.map((l: any) => ({ from: l.fromFeed, to: l.toFeed, ts: new Date(l.ts).getTime(), reason: l.reason })));
    }).catch(() => {});

    fetch("/api/superadmin/feeds/log?type=errors").then((r) => r.json()).then((d) => {
      if (d.ok) setErrorLog(d.logs.map((l: any) => ({ ...l, ts: new Date(l.ts).getTime() })));
    }).catch(() => {});

    const sock = io({ path: "/socket.io" });
    sock.on("feed-failover", (data: any) => {
      setPrimaryState(data.to);
      setFailoverLog((prev) => [{ from: data.from, to: data.to, ts: data.ts }, ...prev].slice(0, 50));
    });
    sock.on("feed-error", (data: any) => {
      setErrorLog((prev) => [data, ...prev].slice(0, 100));
      setLogTab("errors");
    });
    return () => { sock.disconnect(); };
  }, []);

  async function testFeed(catKey: string, feedKey: string) {
    setTestStatus((p) => ({ ...p, [catKey]: { status: "checking" } }));
    try {
      const apiKey = getApiKey(feedKey, keys);
      const r = await fetch("/api/superadmin/feeds/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: feedKey, apiKey }),
      });
      const d = await r.json();
      setTestStatus((p) => ({
        ...p,
        [catKey]: d.ok
          ? { status: "ok", latency: d.latency }
          : { status: "error", error: d.error },
      }));
    } catch (e: any) {
      setTestStatus((p) => ({ ...p, [catKey]: { status: "error", error: e.message } }));
    }
  }

  async function save() {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...keys, ...feeds }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMsg("Saved — price engine reloaded.");
    setTimeout(() => setMsg(""), 3000);
  }

  async function setManualPrimary(feedKey: string) {
    setPrimaryState(feedKey);
    await fetch("/api/superadmin/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualPrimary: feedKey }),
    });
  }

  function changeFeed(catKey: string, feedKey: string) {
    setFeeds((p) => ({ ...p, [catKey]: feedKey }));
    setTestStatus((p) => ({ ...p, [catKey]: { status: "idle" } }));
  }

  const inp = "w-full rounded-lg border px-3 py-2 text-sm font-mono bg-[var(--bg)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <div className="ui-fade-up">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Market Data Feeds</h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Select a WebSocket provider for each asset class. Changes apply instantly — no server restart.
        </p>
      </div>

      {err && <div className="rounded-lg px-4 py-2 text-sm mb-4" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{err}</div>}
      {msg && <div className="rounded-lg px-4 py-2 text-sm mb-4" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{msg}</div>}

      <div className="flex gap-4 items-start">

        {/* ── LEFT ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Primary feed cards */}
          <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>Active Primary Feed</div>
              <div className="text-[11px]" style={{ color: "#94a3b8" }}>Click a card to switch manually</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {PRIMARY_CARDS.map((card) => {
                const isActive = primary === card.key;
                const hasKey = (card.key === "TD" && !!keys.tdKey)
                  || (card.key === "FH" && !!keys.finnhubKey)
                  || (card.key === "MV" && !!keys.massiveKey);
                return (
                  <button
                    key={card.key}
                    onClick={() => hasKey && setManualPrimary(card.key)}
                    title={!hasKey ? "API key required" : `Set ${card.name} as primary`}
                    className="flex-1 min-w-[100px] rounded-xl border p-3 text-left transition-all"
                    style={{
                      background: isActive ? `${card.color}18` : "var(--bg)",
                      borderColor: isActive ? card.color : "var(--border)",
                      opacity: hasKey ? 1 : 0.45,
                      cursor: hasKey ? "pointer" : "not-allowed",
                      boxShadow: isActive ? `0 0 0 1px ${card.color}55` : "none",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <i className={card.icon + " text-sm"} style={{ color: card.color }} />
                      <span className="text-xs font-bold" style={{ color: isActive ? card.color : "var(--text)" }}>{card.name}</span>
                      {isActive && <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: card.color, color: "#fff" }}>LIVE</span>}
                    </div>
                    <div className="text-[10px]" style={{ color: "#94a3b8" }}>{card.desc}</div>
                    {!hasKey && <div className="text-[10px] mt-0.5" style={{ color: "#f97316" }}>⚠ key needed</div>}
                    {card.key === "MV" && !keys.massiveKey && <div className="text-[10px] mt-0.5" style={{ color: "#94a3b8" }}>$49/mo plan</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category feed rows */}
          <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-3 border-b text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              WebSocket Provider per Asset Class
            </div>
            {CATEGORIES.map((cat) => {
              const options = CAT_FEEDS[cat.catName] || [];
              const selected = (feeds as any)[cat.key] as string;
              const opt = options.find((o) => o.key === selected);
              const ts = testStatus[cat.key] || { status: "idle" };
              const missingKey = needsKey(cat.key, selected, keys);
              return (
                <div key={cat.key} className="flex items-center gap-3 px-4 py-3 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  {/* Icon + label */}
                  <div className="w-32 shrink-0 flex items-center gap-2">
                    <i className={cat.icon + " text-sm"} style={{ color: cat.color }} />
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{cat.label}</span>
                  </div>

                  {/* Dropdown */}
                  <select
                    value={selected}
                    onChange={(e) => changeFeed(cat.key, e.target.value)}
                    className="rounded-lg border px-2 py-1.5 text-sm flex-1"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>{o.name}{o.free ? " (free)" : ""}{o.hasBidAsk ? " ★ bid/ask" : ""}</option>
                    ))}
                  </select>

                  {/* Info */}
                  <div className="w-48 shrink-0 text-[11px]" style={{ color: "#94a3b8" }}>
                    {opt?.info}
                    {missingKey && <span className="block text-[10px] mt-0.5" style={{ color: "#f97316" }}>⚠ API key not set</span>}
                  </div>

                  {/* Test button */}
                  <button
                    onClick={() => testFeed(cat.key, selected)}
                    disabled={ts.status === "checking" || !!missingKey}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-40"
                    style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg)" }}
                  >
                    {ts.status === "checking" ? <><i className="fa-solid fa-spinner fa-spin mr-1" />Testing…</> : "Test"}
                  </button>

                  {/* Status badge */}
                  <div className="w-24 shrink-0 text-[11px] font-semibold">
                    {ts.status === "ok"      && <span style={{ color: "#22c55e" }}>✓ {ts.latency}ms</span>}
                    {ts.status === "error"   && <span style={{ color: "#ef4444" }} title={ts.error}>✗ Failed</span>}
                    {ts.status === "idle"    && <span style={{ color: "#64748b" }}>—</span>}
                    {ts.status === "checking"&& <span style={{ color: "#94a3b8" }}>…</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* API Keys */}
          <div className="space-y-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>API Keys</div>
            {[
              { label: "TwelveData API key",      hint: "Required for TD feeds — forex, metals, indices, energy.", field: "tdKey" as const,       ph: "twelvedata.com key" },
              { label: "Finnhub API key",           hint: "Required for FH feeds — free tier at finnhub.io.",       field: "finnhubKey" as const,  ph: "finnhub.io key" },
              { label: "Massive.com Access Key ID", hint: "Required for MV feed — forex real bid/ask ($49/mo).",     field: "massiveKey" as const,  ph: "massive.com access key" },
            ].map(({ label, hint, field, ph }) => (
              <div key={field}>
                <div className="mb-1 text-xs font-medium" style={{ color: "var(--text)" }}>{label}</div>
                <PasswordInput className={inp} placeholder={ph} value={keys[field]} onChange={(e: any) => setKeys((p) => ({ ...p, [field]: e.target.value }))} />
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

          {/* Info card */}
          <div className="rounded-xl border p-4 text-[12px]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="font-semibold mb-1" style={{ color: "var(--text)" }}>How it works</div>
            <div style={{ color: "#94a3b8" }}>Each asset class streams from its own WebSocket. Feeds marked <strong style={{ color: "#22c55e" }}>★ bid/ask</strong> provide real separate bid &amp; ask prices. Others provide a single price and spread is calculated from your admin settings.</div>
            <div className="mt-1" style={{ color: "#94a3b8" }}>Auto-failover: if a feed fails 5× consecutively it switches to the next available provider automatically.</div>
          </div>
        </div>

        {/* ── RIGHT — logs ── */}
        <div className="w-80 shrink-0 rounded-xl border overflow-hidden sticky top-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
            {(["failover", "errors"] as const).map((tab) => {
              const count = tab === "failover" ? failoverLog.length : errorLog.length;
              return (
                <button
                  key={tab}
                  onClick={() => setLogTab(tab)}
                  className="flex-1 py-2.5 text-xs font-semibold transition-colors"
                  style={{
                    color: logTab === tab ? "var(--text)" : "#94a3b8",
                    borderBottom: logTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  {tab === "failover" ? "Failover" : "Errors"}
                  {count > 0 && (
                    <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                      style={{ background: tab === "errors" ? "rgba(239,68,68,0.2)" : "rgba(249,115,22,0.2)", color: tab === "errors" ? "#ef4444" : "#f97316" }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => {
                fetch(`/api/superadmin/feeds/log?type=${logTab}`, { method: "DELETE" });
                if (logTab === "failover") setFailoverLog([]);
                else setErrorLog([]);
              }}
              className="px-3 text-[11px] opacity-50 hover:opacity-100"
              style={{ color: "#94a3b8" }}
            >
              Clear
            </button>
          </div>

          {/* Log entries */}
          <div className="overflow-y-auto divide-y" style={{ maxHeight: "520px", borderColor: "rgba(100,116,139,0.1)" }}>
            {logTab === "failover" && (
              failoverLog.length === 0
                ? <div className="px-4 py-6 text-center text-[12px]" style={{ color: "#94a3b8" }}><i className="fa-solid fa-circle-check text-2xl block mb-2" style={{ color: "#22c55e" }} />No failover events</div>
                : failoverLog.map((ev, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-sm" style={{ color: "#f97316" }}>{ev.from}</span>
                      <i className="fa-solid fa-arrow-right text-[10px]" style={{ color: "#64748b" }} />
                      <span className="font-bold text-sm" style={{ color: "#22c55e" }}>{ev.to}</span>
                    </div>
                    <div className="text-[11px]" style={{ color: "#94a3b8" }}>{ev.reason}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: "#64748b" }}>{new Date(ev.ts).toLocaleString()}</div>
                  </div>
                ))
            )}
            {logTab === "errors" && (
              errorLog.length === 0
                ? <div className="px-4 py-6 text-center text-[12px]" style={{ color: "#94a3b8" }}><i className="fa-solid fa-circle-check text-2xl block mb-2" style={{ color: "#22c55e" }} />No errors logged</div>
                : errorLog.map((ev, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>{ev.provider}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(100,116,139,0.15)", color: "#94a3b8" }}>{ev.category}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(249,115,22,0.15)", color: "#f97316" }}>{ev.errorType}</span>
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: "#94a3b8" }}>{ev.message}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: "#64748b" }}>{new Date(ev.ts).toLocaleString()}</div>
                  </div>
                ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
