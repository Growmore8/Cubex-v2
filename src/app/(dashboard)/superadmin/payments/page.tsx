"use client";
import { useEffect, useState } from "react";

export default function SAPayments() {
  const [wallets, setWallets] = useState<any[]>([]); const [xy, setXy] = useState<any>({ url: "", active: true });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [edit, setEdit] = useState<any>(null);
  async function load() { try { const d = await fetch("/api/superadmin/payments").then((r) => r.json()); if (d.ok) { setWallets(d.wallets); setXy({ url: (d.xynder && d.xynder.url) || "", active: d.xynder ? d.xynder.active !== false : true }); } } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function wallet(action: string, data: any) { setErr(""); const r = await fetch("/api/superadmin/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "wallet", action, ...data }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setEdit(null); load(); }
  async function saveXy() { setErr(""); setMsg(""); const r = await fetch("/api/superadmin/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "xynder", url: xy.url, active: xy.active }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setMsg("Saved"); setTimeout(() => setMsg(""), 1500); }
  const inp = "rounded-md border px-2 py-1.5 text-sm"; const NETS = ["BEP20", "ERC20", "TRC20"];
  return (<div className="max-w-3xl space-y-4">
    <div><h1 className="text-2xl font-bold">Payment Methods</h1><p className="text-sm text-gray-500">Deposit wallets and the local payment URL shown to clients</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}
    <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Crypto Wallets</div><button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={() => setEdit({ network: "BEP20", asset: "USDT", address: "", active: true })}>+ Add Wallet</button></div>
      <div className="space-y-2">
        {wallets.map((w: any) => (<div key={w.id} className="flex items-center gap-2 rounded border p-2" style={{ borderColor: "#eef2f7" }}>
          <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: "#eef2f7" }}>{w.network}</span>
          <div className="flex-1"><div className="text-sm font-medium">{w.asset}</div><div className="break-all text-xs text-gray-400">{w.address}</div></div>
          <span className="text-xs" style={{ color: w.active ? "#16a34a" : "#94a3b8" }}>{w.active ? "Active" : "Off"}</span>
          <button title="Edit" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent2)" }} onClick={() => setEdit({ ...w })}><i className="fa-solid fa-pen"></i></button>
          <button title="Delete" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }} onClick={() => { if (confirm("Delete wallet?")) wallet("delete", { id: w.id }); }}><i className="fa-solid fa-trash"></i></button>
        </div>))}
        {wallets.length === 0 && <div className="text-sm text-gray-400">No wallets yet.</div>}
      </div>
    </div>
    <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="font-semibold">Local Payment (Xynder)</div>
      <p className="mb-2 text-xs text-gray-500">URL the client app opens for Local Payment. Leave blank to hide.</p>
      <input className={inp + " w-full"} placeholder="https://www.xynder.com/" value={xy.url} onChange={(e) => setXy({ ...xy, url: e.target.value })} />
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={xy.active} onChange={(e) => setXy({ ...xy, active: e.target.checked })} /> Active</label>
      <button className="mt-2 block rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={saveXy}>Save</button>
    </div>
    {edit && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setEdit(null)}>
      <div className="w-[400px] rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-semibold">{edit.id ? "Edit Wallet" : "Add Wallet"}</div>
        <div className="space-y-2">
          <select className={inp + " w-full"} value={edit.network} onChange={(e) => setEdit({ ...edit, network: e.target.value })}>{NETS.map((n) => <option key={n}>{n}</option>)}</select>
          <input className={inp + " w-full"} placeholder="Asset (e.g. USDT)" value={edit.asset || "USDT"} onChange={(e) => setEdit({ ...edit, asset: e.target.value })} />
          <input className={inp + " w-full"} placeholder="Wallet address" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button className="rounded border px-3 py-1.5 text-sm" onClick={() => setEdit(null)}>Cancel</button>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={() => { if (!edit.address) { setErr("Address required"); return; } if (edit.id) wallet("update", { id: edit.id, network: edit.network, asset: edit.asset || "USDT", address: edit.address, active: edit.active !== false }); else wallet("add", { network: edit.network, asset: edit.asset || "USDT", address: edit.address }); }}>Save</button></div>
      </div>
    </div>)}
  </div>);
}