"use client";
import { useEffect, useState } from "react";

type Tenant = { id: string; name: string; ownPaymentMethods: boolean };

export default function SAPayments() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [scope, setScope] = useState<string>("global"); // "global" | tenantId
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);

  async function load() {
    try {
      const d = await fetch("/api/superadmin/payments?scope=" + encodeURIComponent(scope)).then((r) => r.json());
      if (d.ok) { setWallets(d.wallets || []); setTenants(d.tenants || []); }
    } catch (e) {}
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);

  async function post(body: any, after?: () => void) {
    setErr("");
    const r = await fetch("/api/superadmin/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    if (after) after();
    load();
  }
  function save() {
    const e = edit;
    if (!e) return;
    if (e.type === "CRYPTO" && !e.address) { setErr("Address required"); return; }
    if (e.type === "UPI" && !e.address) { setErr("UPI id required"); return; }
    if (e.type === "LINK" && !e.url) { setErr("Link URL required"); return; }
    const payload = { kind: "wallet", scope, type: e.type, network: e.network, asset: e.asset, address: e.address, label: e.label, url: e.url, active: e.active !== false };
    post(e.id ? { ...payload, action: "update", id: e.id } : { ...payload, action: "add" }, () => setEdit(null));
  }
  async function togglePerm(t: Tenant, allow: boolean) {
    await post({ kind: "perm", tenantId: t.id, allow });
    setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, ownPaymentMethods: allow } : x)));
  }

  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm"; const NETS = ["BEP20", "ERC20", "TRC20"];
  const scopeName = scope === "global" ? "All tenants (global default)" : (tenants.find((t) => t.id === scope)?.name || "Tenant");
  const typeBadge = (t: string) => t === "UPI" ? { bg: "#ecfeff", c: "#0e7490" } : t === "LINK" ? { bg: "#fef3c7", c: "#b45309" } : { bg: "#eef2f7", c: "#475569" };

  function newMethod(type: string) {
    setEdit(type === "CRYPTO" ? { type, network: "BEP20", asset: "USDT", address: "", active: true }
      : type === "UPI" ? { type, asset: "UPI", address: "", label: "", active: true }
        : { type, label: "Local Payment", url: "", active: true });
  }

  return (<div className="max-w-5xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">Payment Methods</h1><p className="text-sm text-gray-500">Configure deposit methods clients see — globally or per tenant</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}

    {/* Scope selector */}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Configure for</label>
      <select className={inp + " mt-1 block w-full"} value={scope} onChange={(e) => setScope(e.target.value)}>
        <option value="global">All tenants (global default)</option>
        {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <p className="mt-1 text-xs text-gray-400">Global methods show to every tenant&apos;s clients. Tenant methods show only to that tenant, in addition to globals.</p>
    </div>

    {/* Methods list */}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Methods — <span className="text-gray-500">{scopeName}</span></div>
        <div className="flex gap-1">
          <button className="ui-btn px-2.5 py-1.5 text-xs text-white" style={{ background: "#2563eb", borderColor: "transparent" }} onClick={() => newMethod("CRYPTO")}>+ Crypto</button>
          <button className="ui-btn px-2.5 py-1.5 text-xs text-white" style={{ background: "#0891b2", borderColor: "transparent" }} onClick={() => newMethod("UPI")}>+ UPI</button>
          <button className="ui-btn px-2.5 py-1.5 text-xs text-white" style={{ background: "#d97706", borderColor: "transparent" }} onClick={() => newMethod("LINK")}>+ Local Link</button>
        </div>
      </div>
      <div className="space-y-2">
        {wallets.map((w: any) => { const tb = typeBadge(w.type); return (<div key={w.id} className="ui-row flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: "#eef2f7" }}>
          <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: tb.bg, color: tb.c }}>{w.type === "CRYPTO" ? w.network : w.type}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{w.label || w.asset}</div>
            <div className="break-all text-xs text-gray-400">{w.type === "LINK" ? w.url : w.address}</div>
          </div>
          <span className="text-xs" style={{ color: w.active ? "#16a34a" : "#94a3b8" }}>{w.active ? "Active" : "Off"}</span>
          <button title="Edit" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent2)" }} onClick={() => setEdit({ ...w })}><i className="fa-solid fa-pen"></i></button>
          <button title="Delete" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }} onClick={() => setConfirmDel(w)}><i className="fa-solid fa-trash"></i></button>
        </div>); })}
        {wallets.length === 0 && <div className="text-sm text-gray-400">No methods for this scope yet.</div>}
      </div>
    </div>

    {/* Per-tenant permission */}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="font-semibold">Tenant self-service</div>
      <p className="mb-2 text-xs text-gray-500">Allow a tenant admin to add their own payment methods (in addition to your global ones).</p>
      <div className="space-y-1">
        {tenants.map((t) => (<label key={t.id} className="ui-row flex items-center justify-between rounded-xl border p-2 text-sm" style={{ borderColor: "#eef2f7" }}>
          <span>{t.name}</span>
          <span className="flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={t.ownPaymentMethods} onChange={(e) => togglePerm(t, e.target.checked)} /> Can add own methods</span>
        </label>))}
        {tenants.length === 0 && <div className="text-sm text-gray-400">No tenants.</div>}
      </div>
    </div>

    {/* Edit modal */}
    {edit && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
      <div className="ui-card ui-pop w-[420px] bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-semibold">{edit.id ? "Edit" : "Add"} {edit.type === "CRYPTO" ? "Crypto Wallet" : edit.type === "UPI" ? "UPI" : "Local Link"} — {scopeName}</div>
        <div className="space-y-2">
          {edit.type === "CRYPTO" && (<>
            <select className={inp + " w-full"} value={edit.network} onChange={(e) => setEdit({ ...edit, network: e.target.value })}>{NETS.map((n) => <option key={n}>{n}</option>)}</select>
            <input className={inp + " w-full"} placeholder="Asset (e.g. USDT)" value={edit.asset || ""} onChange={(e) => setEdit({ ...edit, asset: e.target.value })} />
            <input className={inp + " w-full"} placeholder="Wallet address" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
          </>)}
          {edit.type === "UPI" && (<>
            <input className={inp + " w-full"} placeholder="Label (e.g. GPay / PhonePe)" value={edit.label || ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
            <input className={inp + " w-full"} placeholder="UPI id (name@bank)" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
          </>)}
          {edit.type === "LINK" && (<>
            <input className={inp + " w-full"} placeholder="Label (e.g. Local Payment)" value={edit.label || ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
            <input className={inp + " w-full"} placeholder="https://payment-partner.com/..." value={edit.url || ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
          </>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setEdit(null)}>Cancel</button>
          <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm" onClick={save}>Save</button></div>
      </div>
    </div>)}

    {/* Delete confirm */}
    {confirmDel && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
      <div className="ui-card ui-pop w-[360px] bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold">Delete method?</div>
        <div className="mb-3 text-xs text-gray-500">{confirmDel.label || confirmDel.address || confirmDel.url}</div>
        <div className="flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#dc2626", borderColor: "transparent" }} onClick={() => { post({ kind: "wallet", action: "delete", id: confirmDel.id }); setConfirmDel(null); }}>Delete</button></div>
      </div>
    </div>)}
  </div>);
}
