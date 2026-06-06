"use client";
import { useEffect, useState } from "react";

export default function AdminPaymentsPage() {
  const [reqs, setReqs] = useState<any[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [own, setOwn] = useState<any[]>([]);
  const [globals, setGlobals] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [err, setErr] = useState("");

  async function load() {
    const [d, m] = await Promise.all([
      fetch("/api/admin/payments").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/payment-methods").then((r) => r.json()).catch(() => ({})),
    ]);
    if (d.ok) setReqs(d.requests);
    if (m.ok) { setAllowed(!!m.allowed); setOwn(m.own || []); setGlobals(m.globals || []); }
  }
  useEffect(() => { load(); }, []);

  async function review(id: string, action: "approve" | "reject") {
    setErr("");
    const r = await fetch("/api/admin/payments/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }
  async function postMethod(body: any, after?: () => void) {
    setErr("");
    const r = await fetch("/api/admin/payment-methods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    if (after) after();
    load();
  }
  function saveMethod() {
    const e = edit; if (!e) return;
    if (e.type === "CRYPTO" && !e.address) { setErr("Address required"); return; }
    if (e.type === "UPI" && !e.address) { setErr("UPI id required"); return; }
    if (e.type === "LINK" && !e.url) { setErr("Link URL required"); return; }
    const payload = { type: e.type, network: e.network, asset: e.asset, address: e.address, label: e.label, url: e.url, active: e.active !== false };
    postMethod(e.id ? { ...payload, action: "update", id: e.id } : { ...payload, action: "add" }, () => setEdit(null));
  }
  function newMethod(type: string) {
    setEdit(type === "CRYPTO" ? { type, network: "BEP20", asset: "USDT", address: "", active: true }
      : type === "UPI" ? { type, asset: "UPI", address: "", label: "", active: true }
        : { type, label: "Local Payment", url: "", active: true });
  }

  const badge = (s: string) => "rounded px-2 py-0.5 text-xs " + (s === "APPROVED" ? "bg-green-100 text-green-700" : s === "REJECTED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700");
  const inp = "ui-input px-2 py-1.5 text-sm"; const NETS = ["BEP20", "ERC20", "TRC20"];
  const typeBadge = (t: string) => t === "UPI" ? { bg: "#ecfeff", c: "#0e7490" } : t === "LINK" ? { bg: "#fef3c7", c: "#b45309" } : { bg: "#eef2f7", c: "#475569" };

  function MethodRow({ w, readOnly }: { w: any; readOnly?: boolean }) {
    const tb = typeBadge(w.type);
    return (<div className="ui-card flex items-center gap-2 p-2">
      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: tb.bg, color: tb.c }}>{w.type === "CRYPTO" ? w.network : w.type}</span>
      <div className="flex-1 min-w-0"><div className="text-sm font-medium">{w.label || w.asset}</div><div className="break-all text-xs text-gray-400">{w.type === "LINK" ? w.url : w.address}</div></div>
      {readOnly ? <span className="text-xs text-gray-400">Global</span> : (<>
        <span className="text-xs" style={{ color: w.active ? "#16a34a" : "#94a3b8" }}>{w.active ? "Active" : "Off"}</span>
        <button title="Edit" className="ui-btn ui-btn-ghost mx-0.5 px-2 py-1" style={{ color: "var(--accent2)" }} onClick={() => setEdit({ ...w })}><i className="fa-solid fa-pen"></i></button>
        <button title="Delete" className="ui-btn ui-btn-ghost mx-0.5 px-2 py-1" style={{ color: "#b91c1c" }} onClick={() => setConfirmDel(w)}><i className="fa-solid fa-trash"></i></button>
      </>)}
    </div>);
  }

  return (
    <div className="space-y-4 ui-fade-up">
      <div><h1 className="text-2xl font-bold">Deposits / Withdrawals</h1></div>
      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="ui-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600">
            <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Slip</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr>
          </thead>
          <tbody>
            {reqs.length === 0 ? <tr><td className="px-3 py-4" colSpan={7}>No requests.</td></tr> : reqs.map((p) => (
              <tr key={p.id} className="ui-row border-b last:border-0">
                <td className="px-3 py-2">{p.account.login} <span className="text-gray-500">{p.account.name}</span></td>
                <td className="px-3 py-2">{p.kind}</td>
                <td className="px-3 py-2">{Number(p.amount).toFixed(2)}</td>
                <td className="px-3 py-2">{p.method || "-"}</td>
                <td className="px-3 py-2">{p.slipUrl ? <a className="text-blue-600 underline transition-colors duration-200" href={"/api/files/slip/" + p.id} target="_blank" rel="noreferrer">View</a> : "-"}</td>
                <td className="px-3 py-2"><span className={badge(p.status)}>{p.status}</span></td>
                <td className="px-3 py-2 text-right space-x-2">
                  {p.status === "PENDING" ? (<>
                    <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-green-600" onClick={() => review(p.id, "approve")}>Approve</button>
                    <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => review(p.id, "reject")}>Reject</button>
                  </>) : <span className="text-gray-400">{p.reviewedBy}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* My payment methods (only when SuperAdmin granted the permission) */}
      {allowed && (
        <div className="ui-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div><div className="font-semibold">My Payment Methods</div><div className="text-xs text-gray-400">Shown to your clients on the deposit page, alongside platform defaults.</div></div>
            <div className="flex gap-1">
              <button className="ui-btn ui-btn-primary px-2.5 py-1.5 text-xs" onClick={() => newMethod("CRYPTO")}>+ Crypto</button>
              <button className="ui-btn px-2.5 py-1.5 text-xs" onClick={() => newMethod("UPI")}>+ UPI</button>
              <button className="ui-btn px-2.5 py-1.5 text-xs" onClick={() => newMethod("LINK")}>+ Local Link</button>
            </div>
          </div>
          <div className="space-y-2">
            {own.map((w) => <MethodRow key={w.id} w={w} />)}
            {own.length === 0 && <div className="text-sm text-gray-400">No methods added yet.</div>}
          </div>
          {globals.length > 0 && (<div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Platform defaults (read-only)</div>
            <div className="space-y-2">{globals.map((w) => <MethodRow key={w.id} w={w} readOnly />)}</div>
          </div>)}
        </div>
      )}

      {/* Edit modal */}
      {edit && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
        <div className="ui-card ui-pop w-[420px] p-4" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 text-sm font-semibold">{edit.id ? "Edit" : "Add"} {edit.type === "CRYPTO" ? "Crypto Wallet" : edit.type === "UPI" ? "UPI" : "Local Link"}</div>
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
            <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm" onClick={saveMethod}>Save</button></div>
        </div>
      </div>)}

      {/* Delete confirm */}
      {confirmDel && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
        <div className="ui-card ui-pop w-[360px] p-4" onClick={(e) => e.stopPropagation()}>
          <div className="mb-1 text-sm font-semibold">Delete method?</div>
          <div className="mb-3 text-xs text-gray-500">{confirmDel.label || confirmDel.address || confirmDel.url}</div>
          <div className="flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
            <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#dc2626", borderColor: "#dc2626" }} onClick={() => { postMethod({ action: "delete", id: confirmDel.id }); setConfirmDel(null); }}>Delete</button></div>
        </div>
      </div>)}
    </div>
  );
}
