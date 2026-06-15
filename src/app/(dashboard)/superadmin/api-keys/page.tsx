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

  async function load() {
    try {
      const d = await fetch("/api/superadmin/api-keys").then((r) => r.json());
      if (d.ok) { setKeys(d.keys || []); setTenants(d.tenants || []); if (!tenantId && d.tenants?.[0]) setTenantId(d.tenants[0].id); }
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

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-cubex-domain";
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm";

  return (<div className="max-w-5xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">API Keys</h1><p className="text-sm text-gray-500">Server-to-server keys that let a tenant&apos;s website pull account data (closed P&amp;L) from Cubex.</p></div>
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
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-2 font-semibold">How a tenant uses it</div>
      <p className="mb-2 text-xs text-gray-500">Call this from <b>their server</b> (keep the key secret). Pass the account/pool login number as <code>accountId</code>.</p>
      <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"><code>{`GET ${origin}/api/external/v1/account-pnl?accountId=900050
Header:  x-api-key: ck_live_xxxxxxxxxxxx

Response:
{ "ok": true, "accountId": "900050", "pnl": 1261.48, "currency": "USD" }`}</code></pre>
      <p className="mt-2 text-xs text-gray-400">Returns the account&apos;s <b>closed P&amp;L</b>. A key only reads its own tenant&apos;s accounts. Limit: 120 requests/min per key. Errors: 401 (bad key), 404 (no such account), 429 (rate limit).</p>
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
