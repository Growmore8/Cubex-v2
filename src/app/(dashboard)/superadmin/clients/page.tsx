"use client";
import { useEffect, useState } from "react";

export default function SAClients() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState(""); const [type, setType] = useState("All"); const [status, setStatus] = useState("All"); const [kyc, setKyc] = useState("All");
  const [err, setErr] = useState("");
  const [money, setMoney] = useState<any>(null);
  async function load() { try { const d = await fetch("/api/superadmin/clients").then((r) => r.json()); if (d.ok) setRows(d.clients); } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function act(id: string, action: string, extra: any) { setErr(""); const r = await fetch("/api/superadmin/clients/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } load(); }
  async function applyMoney() {
    setErr("");
    const amt = Number(money.amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    const r = await fetch("/api/superadmin/clients/" + money.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "balance", type: money.type, amount: amt, description: money.description || "" }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMoney(null); load();
  }
  const filtered = rows.filter((r: any) => {
    if (type !== "All" && r.type !== type) return false;
    if (status === "Active" && r.locked) return false;
    if (status === "Locked" && !r.locked) return false;
    if (kyc !== "All" && (r.kyc || "NONE") !== kyc) return false;
    if (q) { const s = q.toLowerCase(); if (!((r.login || "").toLowerCase().includes(s) || (r.name || "").toLowerCase().includes(s) || (r.email || "").toLowerCase().includes(s))) return false; }
    return true;
  });
  const m = (v: number) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inp = "rounded-md border px-2 py-1.5 text-sm";
  return (<div className="space-y-4">
    <div><h1 className="text-2xl font-bold">All Clients</h1><p className="text-sm text-gray-500">View all accounts across the platform</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}
    <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={inp + " min-w-[200px] flex-1"} placeholder="Search name / email / login" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inp} value={type} onChange={(e) => setType(e.target.value)}><option>All</option><option value="LIVE">Live</option><option value="DEMO">Demo</option></select>
        <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}><option>All</option><option>Active</option><option>Locked</option></select>
        <select className={inp} value={kyc} onChange={(e) => setKyc(e.target.value)}><option>All</option><option value="APPROVED">KYC Approved</option><option value="PENDING">KYC Pending</option><option value="REJECTED">KYC Rejected</option><option value="NONE">No KYC</option></select>
        <span className="text-sm text-gray-500">{filtered.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500"><tr><th className="px-2 py-1 font-normal">ID</th><th className="px-2 py-1 font-normal">Name / Email</th><th className="px-2 py-1 font-normal">Company / Manager</th><th className="px-2 py-1 font-normal">Type</th><th className="px-2 py-1 font-normal text-right">Balance</th><th className="px-2 py-1 font-normal">KYC</th><th className="px-2 py-1 font-normal">Status</th><th className="px-2 py-1 font-normal">Joined</th><th className="px-2 py-1 font-normal text-right">Actions</th></tr></thead>
          <tbody>
            {filtered.map((r: any) => (<tr key={r.id} className="border-t" style={{ borderColor: "#eef2f7" }}>
              <td className="px-2 py-2 font-medium">{r.login}</td>
              <td className="px-2 py-2">{r.name}<div className="text-xs text-gray-400">{r.email}</div></td>
              <td className="px-2 py-2">{r.company}<div className="text-xs text-gray-400">{r.manager || "—"}</div></td>
              <td className="px-2 py-2">{r.type}</td>
              <td className="px-2 py-2 text-right">{m(r.balance)}</td>
              <td className="px-2 py-2">{r.kyc ? <span className={"sab " + (r.kyc === "APPROVED" ? "sab-green" : r.kyc === "PENDING" ? "sab-amber" : "sab-red")}>{r.kyc}</span> : <span className="text-xs text-gray-400">—</span>}</td>
              <td className="px-2 py-2"><span className={"sab " + (r.deactivated ? "sab-amber" : r.locked ? "sab-red" : "sab-green")}>{r.deactivated ? "Deactivated" : r.locked ? "Locked" : "Active"}</span></td>
              <td className="px-2 py-2 text-xs text-gray-500">{new Date(r.joined).toLocaleDateString()}</td>
              <td className="px-2 py-2 space-x-1 text-right">
                <button title="Money" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--green) 16%, transparent)", color: "#15803d" }} onClick={() => setMoney({ id: r.id, login: r.login, type: "DEPOSIT", amount: "", description: "" })}><i className="fa-solid fa-coins"></i></button>
                <button title={r.locked ? "Unlock" : "Lock"} className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent2)" }} onClick={() => act(r.id, r.locked ? "unlock" : "lock", {})}><i className={"fa-solid " + (r.locked ? "fa-lock-open" : "fa-lock")}></i></button><button title={r.deactivated ? "Activate" : "Deactivate"} className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)", color: "#b45309" }} onClick={() => act(r.id, r.deactivated ? "activate" : "deactivate", {})}><i className={"fa-solid " + (r.deactivated ? "fa-circle-check" : "fa-ban")}></i></button>
                <button title="Reset password" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)", color: "#b45309" }} onClick={() => { const p = prompt("New password for " + r.login); if (p) act(r.id, "resetPassword", { password: p }); }}><i className="fa-solid fa-key"></i></button>
                <button title="Delete" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }} onClick={() => { if (confirm("Delete " + r.login + " and all its data?")) act(r.id, "delete", {}); }}><i className="fa-solid fa-trash"></i></button>
              </td>
            </tr>))}
            {filtered.length === 0 && <tr><td className="px-2 py-4 text-gray-400" colSpan={9}>No clients.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  {money && (
    <div style={{ position: "fixed", inset: 0, zIndex: 9995, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={() => setMoney(null)}>
      <div className="card" style={{ width: 340, margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-title">Adjust Balance &mdash; {money.login}</div>
        <div style={{ display: "grid", gap: 8 }}>
          <select className={inp} value={money.type} onChange={(e) => setMoney({ ...money, type: e.target.value })}><option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option><option value="CREDIT_IN">Credit In</option><option value="CREDIT_OUT">Credit Out</option><option value="BONUS">Bonus</option></select>
          <input className={inp} type="number" placeholder="Amount" value={money.amount} onChange={(e) => setMoney({ ...money, amount: e.target.value })} />
          <input className={inp} placeholder="Description (optional)" value={money.description || ""} onChange={(e) => setMoney({ ...money, description: e.target.value })} />
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div style={{ display: "flex", gap: 8 }}><button className="btn" style={{ flex: 1, border: "1px solid var(--border)" }} onClick={() => setMoney(null)}>Cancel</button><button className="btn btn-primary" style={{ flex: 1 }} onClick={applyMoney}>Apply</button></div>
        </div>
      </div>
    </div>
  )}
  </div>);
}