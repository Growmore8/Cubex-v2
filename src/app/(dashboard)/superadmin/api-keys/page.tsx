"use client";
import { useEffect, useState } from "react";

type Tenant = { id: string; name: string };
type Key = { id: string; label: string; prefix: string; active: boolean; lastUsedAt: string | null; createdAt: string; tenantId: string; tenantName: string };

export default function SAApiKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [created, setCreated] = useState(""); // raw key shown once
  const [confirmDel, setConfirmDel] = useState<Key | null>(null);
  const [publicApiUrl, setPublicApiUrl] = useState("");

  async function load() {
    try {
      const [d, cfg] = await Promise.all([
        fetch("/api/superadmin/api-keys").then((r) => r.json()),
        fetch("/api/superadmin/settings").then((r) => r.json()),
      ]);
      if (d.ok) { setKeys(d.keys || []); setTenants(d.tenants || []); if (!tenantId && d.tenants?.[0]) setTenantId(d.tenants[0].id); }
      if (cfg.ok && cfg.publicApiUrl) setPublicApiUrl(cfg.publicApiUrl);
    } catch {}
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function post(body: any, after?: () => void) {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return null; }
    if (after) after();
    load();
    return d;
  }
  async function generate() {
    if (!tenantId) { setErr("Pick a tenant"); return; }
    if (!label.trim()) { setErr("Enter a label"); return; }
    const d = await post({ action: "create", tenantId, label });
    if (d?.key) { setCreated(d.key); setLabel(""); setMsg("Key created — copy it now, it won't be shown again."); }
  }

  // Use configured public API URL (proxy domain) so CubeX internals are never exposed in docs
  const origin = publicApiUrl || (typeof window !== "undefined" ? window.location.origin : "https://your-api-domain");
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm";

  return (<div className="max-w-5xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">API Keys</h1><p className="text-sm text-gray-500">Server-to-server keys for external integrations — account P&amp;L and live market prices (NYSE, BSE/NSE, Forex, Crypto, Metals).</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}

    {/* Newly created raw key — shown once */}
    {created && (
      <div className="ui-card bg-amber-50 p-4" style={{ borderColor: "#fcd34d" }}>
        <div className="mb-1 text-sm font-semibold text-amber-800"><i className="fa-solid fa-triangle-exclamation mr-1" />Copy this key now — it will not be shown again.</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs">{created}</code>
          <button className="ui-btn ui-btn-primary px-3 py-2 text-sm" onClick={() => { navigator.clipboard.writeText(created); setMsg("Key copied"); }}><i className="fa-solid fa-copy" /></button>
          <button className="ui-btn px-3 py-2 text-sm" onClick={() => setCreated("")}>Done</button>
        </div>
      </div>
    )}

    {/* Generate */}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-2 font-semibold">Generate a key</div>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tenant</label>
          <select className={inp + " mt-1 block w-56"} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div className="flex-1 min-w-[200px]"><label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Label</label>
          <input className={inp + " mt-1 block w-full"} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. GrowthCapital mutual fund" /></div>
        <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" onClick={generate}><i className="fa-solid fa-key mr-1" />Generate</button>
      </div>
    </div>

    {/* Existing keys */}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-2 font-semibold">Existing keys</div>
      <div className="space-y-2">
        {keys.map((k) => (<div key={k.id} className="ui-row flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: "#eef2f7" }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{k.label} <span className="text-xs text-gray-400">· {k.tenantName}</span></div>
            <div className="text-xs text-gray-400">{k.prefix} · created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? "last used " + new Date(k.lastUsedAt).toLocaleString() : "never used"}</div>
          </div>
          <span className="text-xs" style={{ color: k.active ? "#16a34a" : "#94a3b8" }}>{k.active ? "Active" : "Revoked"}</span>
          {k.active && <button title="Revoke" className="mx-0.5 rounded px-2 py-1 text-xs" style={{ background: "#fef3c7", color: "#b45309" }} onClick={() => post({ action: "revoke", id: k.id })}>Revoke</button>}
          <button title="Delete" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }} onClick={() => setConfirmDel(k)}><i className="fa-solid fa-trash" /></button>
        </div>))}
        {keys.length === 0 && <div className="text-sm text-gray-400">No keys yet.</div>}
      </div>
    </div>

    {/* Usage docs */}
    <div className="ui-card bg-white p-4 space-y-5" style={{ borderColor: "#e2e8f0" }}>
      <div className="font-semibold">How a tenant uses it</div>
      <p className="text-xs text-gray-500">Call from <b>their server</b> (keep the key secret). Same <code>x-api-key</code> header for all endpoints. Key only reads its own tenant&apos;s data.</p>

      {/* Endpoint 1 — Account P&L */}
      <div>
        <div className="mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">① Account P&amp;L</div>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"><code>{`GET ${origin}/api/external/v1/account-pnl?accountId=900050
Header:  x-api-key: ck_live_xxxxxxxxxxxx

Response:
{
  "ok": true,
  "accountId": "900050",
  "closedPnl":   1261.48,   // realized (closed trades)
  "floatingPnl":   84.20,   // unrealized (open trades, live)
  "totalPnl":    1345.68,   // closedPnl + floatingPnl
  "pnl":         1261.48,   // = closedPnl (back-compat)
  "currency": "USD"
}`}</code></pre>
        <p className="mt-1 text-xs text-gray-400">Limit: 120 req/min · Errors: 401 bad key, 404 no account, 429 rate limit</p>
      </div>

      {/* Endpoint 2 — Live Prices */}
      <div>
        <div className="mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">② Live Prices (all symbols)</div>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"><code>{`GET ${origin}/api/external/v1/prices
Header:  x-api-key: ck_live_xxxxxxxxxxxx

Response:
{
  "ok": true,
  "prices": {
    "EURUSD":   { "bid": 1.08520, "ask": 1.08522, "price": 1.08520, "category": "forex" },
    "XAUUSD":   { "bid": 3245.50, "ask": 3246.00, "price": 3245.50, "category": "commodities" },
    "BTCUSD":   { "bid": 59864.01,"ask": 59864.50,"price": 59864.01,"category": "crypto" },
    "AAPL":     { "bid": 283.50,  "ask": 283.52,  "price": 283.50,  "category": "stocks" },
    "RELIANCE": { "bid": 2941.00, "ask": 2941.50, "price": 2941.00, "category": "stocks" }
  },
  "ts": 1719648000000
}`}</code></pre>
        <p className="mt-1 text-xs text-gray-400">Limit: 300 req/min · Filter: add <code>?symbols=AAPL,EURUSD,RELIANCE</code> to get specific symbols only</p>
      </div>

      {/* Endpoint 3 — Filtered prices */}
      <div>
        <div className="mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">③ Live Prices (filtered)</div>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"><code>{`GET ${origin}/api/external/v1/prices?symbols=AAPL,RELIANCE,EURUSD
Header:  x-api-key: ck_live_xxxxxxxxxxxx`}</code></pre>
        <p className="mt-1 text-xs text-gray-400">Returns only the requested symbols. Useful for spot trading pages with specific symbol lists.</p>
      </div>
    </div>

    {/* Delete confirm */}
    {confirmDel && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
      <div className="ui-card ui-pop w-[360px] bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold">Delete key?</div>
        <div className="mb-3 text-xs text-gray-500">{confirmDel.label} · {confirmDel.tenantName}. Any site using it will stop working immediately.</div>
        <div className="flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#dc2626", borderColor: "transparent" }} onClick={() => { post({ action: "delete", id: confirmDel.id }); setConfirmDel(null); }}>Delete</button></div>
      </div>
    </div>)}
  </div>);
}
