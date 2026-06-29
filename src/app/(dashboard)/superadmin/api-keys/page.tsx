"use client";
import { useEffect, useState, useCallback } from "react";

type Tenant = { id: string; name: string };
type Key = { id: string; label: string; prefix: string; active: boolean; lastUsedAt: string | null; createdAt: string; tenantId: string; tenantName: string };
type UsagePt = { label: string; value: number };
type UsageData = { hourly: UsagePt[]; daily: UsagePt[]; monthly: UsagePt[] };

function MiniBarChart({ data, color = "#16c784" }: { data: UsagePt[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="flex items-center justify-center h-[80px] text-xs" style={{ color: "var(--text3)" }}>No requests yet</div>;
  return (
    <div className="flex items-end gap-[2px] h-[80px] w-full">
      {data.map((d, i) => (
        <div key={i} title={`${d.label}: ${d.value}`} className="flex-1 rounded-sm transition-all" style={{ height: `${Math.max(2, (d.value / max) * 100)}%`, background: d.value > 0 ? color : "var(--border)", opacity: d.value > 0 ? 1 : 0.3 }} />
      ))}
    </div>
  );
}

function UsagePanel({ keyId, keyLabel }: { keyId: string; keyLabel: string }) {
  const [tab, setTab] = useState<"hour" | "day" | "month">("day");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/superadmin/api-key-stats?keyId=${keyId}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [keyId]);

  const chart = data ? (tab === "hour" ? data.hourly : tab === "day" ? data.daily : data.monthly) : [];
  const total = chart.reduce((s, d) => s + d.value, 0);
  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} className="px-2 py-0.5 rounded text-[10px]"
      style={{ background: tab === t ? "var(--accent)" : "transparent", color: tab === t ? "#fff" : "var(--text2)", fontWeight: tab === t ? 700 : 400 }}>
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold truncate" style={{ color: "var(--text)" }}>{keyLabel}</div>
        <div className="flex gap-1">{tabBtn("hour", "24h")}{tabBtn("day", "30d")}{tabBtn("month", "12m")}</div>
      </div>
      {loading ? <div className="h-[80px] flex items-center justify-center text-xs" style={{ color: "var(--text2)" }}>Loading…</div>
        : <MiniBarChart data={chart} color="#16c784" />}
      <div className="flex justify-between text-[10px]" style={{ color: "var(--text3)" }}>
        <span>{tab === "hour" ? "Last 24 hours" : tab === "day" ? "Last 30 days" : "Last 12 months"}</span>
        <span className="font-semibold" style={{ color: "var(--text)" }}>{total.toLocaleString()} reqs</span>
      </div>
    </div>
  );
}

export default function SAApiKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [created, setCreated] = useState("");
  const [confirmDel, setConfirmDel] = useState<Key | null>(null);
  const [publicApiUrl, setPublicApiUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, cfg] = await Promise.all([
        fetch("/api/superadmin/api-keys").then((r) => r.json()),
        fetch("/api/superadmin/settings").then((r) => r.json()),
      ]);
      if (d.ok) { setKeys(d.keys || []); setTenants(d.tenants || []); if (!tenantId && d.tenants?.[0]) setTenantId(d.tenants[0].id); }
      if (cfg.ok && cfg.publicApiUrl) setPublicApiUrl(cfg.publicApiUrl);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(body: any) {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return null; }
    load(); return d;
  }
  async function generate() {
    if (!tenantId) { setErr("Pick a tenant"); return; }
    if (!label.trim()) { setErr("Enter a label"); return; }
    const d = await post({ action: "create", tenantId, label });
    if (d?.key) { setCreated(d.key); setLabel(""); setMsg("Key created — copy it now, it won't be shown again."); }
  }

  const origin = publicApiUrl || (typeof window !== "undefined" ? window.location.origin : "https://your-api-domain");
  const activeKeys = keys.filter((k) => k.active);

  return (
    <div className="ui-fade-up" style={{ maxWidth: 1100 }}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>API Keys</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Server-to-server keys for external integrations — account P&amp;L and live market prices (NYSE, BSE/NSE, Forex, Crypto, Metals).</p>
      </div>

      {err && <div className="mb-2 text-sm text-red-500 font-medium">{err}</div>}
      {msg && <div className="mb-2 text-sm font-medium" style={{ color: "#16c784" }}>{msg}</div>}

      {/* Raw key banner */}
      {created && (
        <div className="rounded-xl mb-4 p-4 border" style={{ borderColor: "#fcd34d", background: "rgba(253,224,71,0.06)" }}>
          <div className="mb-1 text-sm font-semibold" style={{ color: "#b45309" }}><i className="fa-solid fa-triangle-exclamation mr-1" />Copy this key now — it will not be shown again.</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg px-3 py-2 text-xs font-mono" style={{ background: "#0d1117", color: "#3fb950" }}>{created}</code>
            <button className="ui-btn ui-btn-primary px-3 py-2 text-sm" onClick={() => { navigator.clipboard.writeText(created); setMsg("Key copied"); }}><i className="fa-solid fa-copy" /></button>
            <button className="ui-btn px-3 py-2 text-sm" onClick={() => setCreated("")}>Done</button>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex gap-4 items-start">

        {/* LEFT — main content */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Generate */}
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="mb-3 font-semibold" style={{ color: "var(--text)" }}>Generate a key</div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text2)" }}>Tenant</label>
                <select className="ui-input rounded-lg border px-2 py-1.5 text-sm w-52" value={tenantId} onChange={(e) => setTenantId(e.target.value)}
                  style={{ background: "var(--bg2)", borderColor: "var(--border)", color: "var(--text)" }}>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text2)" }}>Label</label>
                <input className="ui-input rounded-lg border px-2 py-1.5 text-sm w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. GrowthCapital spot trading"
                  style={{ background: "var(--bg2)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
              <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" onClick={generate}><i className="fa-solid fa-key mr-1" />Generate</button>
            </div>
          </div>

          {/* Existing keys */}
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="mb-3 font-semibold" style={{ color: "var(--text)" }}>Existing keys</div>
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--bg2)" }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {k.label} <span className="font-normal text-xs" style={{ color: "var(--text2)" }}>· {k.tenantName}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>
                      {k.prefix} · created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? "last used " + new Date(k.lastUsedAt).toLocaleString() : "never used"}
                    </div>
                  </div>
                  <span className="text-xs font-semibold" style={{ color: k.active ? "#16a34a" : "var(--text3)" }}>{k.active ? "Active" : "Revoked"}</span>
                  {k.active && (
                    <button className="rounded-lg px-2 py-1 text-xs font-semibold border" style={{ background: "rgba(180,83,9,0.1)", borderColor: "rgba(180,83,9,0.3)", color: "#b45309" }}
                      onClick={() => post({ action: "revoke", id: k.id })}>Revoke</button>
                  )}
                  <button className="rounded-lg px-2 py-1 text-xs" style={{ background: "rgba(220,38,38,0.1)", color: "#dc2626" }}
                    onClick={() => setConfirmDel(k)}><i className="fa-solid fa-trash" /></button>
                </div>
              ))}
              {keys.length === 0 && <div className="text-sm py-2" style={{ color: "var(--text2)" }}>No keys yet.</div>}
            </div>
          </div>

          {/* API Docs */}
          <div className="rounded-xl border p-4 space-y-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="font-semibold" style={{ color: "var(--text)" }}>How a tenant uses it</div>
            <p className="text-xs" style={{ color: "var(--text2)" }}>Call from <strong style={{ color: "var(--text)" }}>their server</strong> (keep the key secret). Same <code className="rounded px-1 py-0.5 text-[11px]" style={{ background: "var(--bg2)", color: "var(--text)" }}>x-api-key</code> header for all endpoints.</p>

            {[
              {
                num: "①", title: "Account P&L",
                code: `GET ${origin}/api/external/v1/account-pnl?accountId=900050\nHeader:  x-api-key: ck_live_xxxxxxxxxxxx\n\nResponse:\n{\n  "ok": true,\n  "accountId": "900050",\n  "closedPnl":   1261.48,   // realized (closed trades)\n  "floatingPnl":   84.20,   // unrealized (open trades, live)\n  "totalPnl":    1345.68,   // closedPnl + floatingPnl\n  "currency": "USD"\n}`,
                note: `Limit: 120 req/min · 401 bad key · 404 no account · 429 rate limit`,
              },
              {
                num: "②", title: "Live Prices (all symbols)",
                code: `GET ${origin}/api/external/v1/prices\nHeader:  x-api-key: ck_live_xxxxxxxxxxxx\n\nResponse:\n{\n  "ok": true,\n  "prices": {\n    "EURUSD":   { "bid": 1.08520, "ask": 1.08522, "category": "forex" },\n    "XAUUSD":   { "bid": 3245.50, "ask": 3246.00, "category": "commodities" },\n    "AAPL":     { "bid": 283.50,  "ask": 283.52,  "category": "stocks" },\n    "RELIANCE": { "bid": 2941.00, "ask": 2941.50, "category": "stocks" }\n  },\n  "ts": 1719648000000\n}`,
                note: `Limit: 300 req/min · Filter: ?symbols=AAPL,RELIANCE,EURUSD`,
              },
              {
                num: "③", title: "Filtered prices",
                code: `GET ${origin}/api/external/v1/prices?symbols=AAPL,RELIANCE,EURUSD\nHeader:  x-api-key: ck_live_xxxxxxxxxxxx`,
                note: null,
              },
            ].map(({ num, title, code, note }) => (
              <div key={num}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-base" style={{ color: "var(--accent)" }}>{num}</span>
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>{title}</span>
                </div>
                <pre className="overflow-auto rounded-lg p-3 text-xs font-mono leading-relaxed"
                  style={{ background: "#0d1117", color: "#c9d1d9", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <code>{code}</code>
                </pre>
                {note && <p className="mt-1.5 text-xs" style={{ color: "var(--text2)" }}>{note}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — usage analytics */}
        <div className="w-64 shrink-0 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
            <i className="fa-solid fa-chart-bar mr-1" />API Usage
          </div>
          {activeKeys.length === 0 && <div className="text-xs" style={{ color: "var(--text3)" }}>No active keys.</div>}
          {activeKeys.map((k) => (
            <UsagePanel key={k.id} keyId={k.id} keyLabel={`${k.label} · ${k.tenantName}`} />
          ))}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6">
          <div className="rounded-xl border p-5 w-[360px] shadow-2xl" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold" style={{ color: "var(--text)" }}>Delete key?</div>
            <div className="mb-4 text-xs" style={{ color: "var(--text2)" }}>{confirmDel.label} · {confirmDel.tenantName}. Any site using it will stop working immediately.</div>
            <div className="flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="px-3 py-1.5 text-sm rounded-lg font-semibold text-white" style={{ background: "#dc2626" }}
                onClick={() => { post({ action: "delete", id: confirmDel.id }); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
