"use client";
import { useEffect, useState } from "react";

const PERM_GROUPS: { sec: string; items: [string, string][] }[] = [
  { sec: "Users", items: [["createClients", "Create Clients"], ["deleteClients", "Delete Clients"], ["manageManagers", "Manage Managers"]] },
  { sec: "Funds", items: [["processDeposits", "Process Deposits"], ["processWithdrawals", "Process Withdrawals"], ["creditBonus", "Credit / Bonus / Insurance"], ["transferFunds", "Transfer Funds"], ["editFinancial", "Edit Financial History"], ["deleteFinancial", "Delete Financial History"]] },
  { sec: "Trades", items: [["manualTrade", "Manual Trade Entry"], ["closeTrades", "Close Trades"], ["editTrades", "Edit Trade Records"], ["deleteTrades", "Delete Trades"]] },
  { sec: "Reports", items: [["viewAudit", "View Audit Log"], ["exportPdf", "Export PDF Reports"]] },
  { sec: "Communication", items: [["sendNotifications", "Send Notifications"]] },
];

export default function SAOutsource() {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ plan: "STARTER", seats: 5, primaryColor: "#2563eb", accentColor: "#22c55e" });
  const [permFor, setPermFor] = useState<any>(null); const [perms, setPerms] = useState<any>({});

  async function load() { try { const d = await fetch("/api/superadmin/outsource").then((r) => r.json()); if (d.ok) setRows(d.outsources); } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function act(id: string, action: string, extra: any) { setErr(""); const r = await fetch("/api/superadmin/outsource/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } load(); }
  async function create() { setErr(""); const r = await fetch("/api/platform/tenants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, subdomain: (form.subdomain || "").toLowerCase(), seats: Number(form.seats) }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Create failed"); return; } setCreateOpen(false); setForm({ plan: "STARTER", seats: 5, primaryColor: "#2563eb", accentColor: "#22c55e" }); load(); }
  function openPerms(t: any) { setPermFor(t); setPerms(t.permissions || {}); }
  async function savePerms() { if (!permFor) return; await act(permFor.id, "perms", { perms }); setPermFor(null); }

  const inp = "rounded-md border px-2 py-1.5 text-sm";
  return (<div className="space-y-4">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Outsource Management</h1><p className="text-sm text-gray-500">Manage outsource accounts and platform permissions</p></div>
      <button onClick={() => setCreateOpen(true)} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white">+ New Outsource</button></div>
    {err && <div className="text-sm text-red-600">{err}</div>}
    <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <table className="w-full text-sm"><thead className="text-left text-gray-500"><tr><th className="px-2 py-1 font-normal">Name / Company</th><th className="px-2 py-1 font-normal">Subdomain</th><th className="px-2 py-1 font-normal">Status</th><th className="px-2 py-1 font-normal text-right">Users</th><th className="px-2 py-1 font-normal text-right">Accounts</th><th className="px-2 py-1 font-normal text-right">Actions</th></tr></thead>
      <tbody>
        {rows.map((t: any) => (<tr key={t.id} className="border-t" style={{ borderColor: "#eef2f7" }}>
          <td className="px-2 py-2 font-medium">{t.brandName || t.name}<div className="text-xs text-gray-400">{t.name}</div></td>
          <td className="px-2 py-2 text-blue-600">{t.subdomain}</td>
          <td className="px-2 py-2"><span className={"sab " + (t.status === "ACTIVE" ? "sab-green" : "sab-red")}>{t.status}</span></td>
          <td className="px-2 py-2 text-right">{t.users}</td>
          <td className="px-2 py-2 text-right">{t.accounts}</td>
          <td className="px-2 py-2 space-x-1 text-right">
            <button className="rounded border px-2 py-1 text-xs" onClick={() => openPerms(t)}><i className="fa-solid fa-user-shield" style={{ marginRight: 4 }}></i>Permissions</button>
            <button title={t.status === "ACTIVE" ? "Lock" : "Open"} className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent2)" }} onClick={() => act(t.id, t.status === "ACTIVE" ? "lock" : "open", {})}><i className={"fa-solid " + (t.status === "ACTIVE" ? "fa-lock" : "fa-lock-open")}></i></button>
            <button title="Reset password" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)", color: "#b45309" }} onClick={() => { const p = prompt("New password for " + t.name + " admin"); if (p) act(t.id, "resetPassword", { password: p }); }}><i className="fa-solid fa-key"></i></button>
            <button title="Delete" className="mx-0.5 rounded px-2 py-1" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }} onClick={() => { if (confirm("Delete outsource " + t.name + " and ALL its data?")) act(t.id, "delete", {}); }}><i className="fa-solid fa-trash"></i></button>
          </td>
        </tr>))}
        {rows.length === 0 && <tr><td className="px-2 py-4 text-gray-400" colSpan={6}>No outsources.</td></tr>}
      </tbody></table>
    </div>

    {createOpen && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setCreateOpen(false)}>
      <div className="w-[420px] rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-semibold">New Outsource</div>
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="Company name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inp} placeholder="subdomain" value={form.subdomain || ""} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
          <input className={inp + " col-span-2"} placeholder="Brand name (optional)" value={form.brandName || ""} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
          <input className={inp} placeholder="Admin name" value={form.adminName || ""} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
          <input className={inp} placeholder="Admin email" value={form.adminEmail || ""} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          <input className={inp + " col-span-2"} type="password" placeholder="Admin password (min 6)" value={form.adminPassword || ""} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end gap-2"><button className="rounded border px-3 py-1.5 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button><button className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white" onClick={create}>Create</button></div>
      </div>
    </div>)}

    {permFor && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setPermFor(null)}>
      <div className="max-h-[80vh] w-[520px] overflow-auto rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold">Outsource Permissions &mdash; {permFor.brandName || permFor.name}</div>
        <div className="mb-3 text-xs text-gray-500">If a permission is OFF, no one under this outsource can use it regardless of personal settings.</div>
        {PERM_GROUPS.map((g) => (<div key={g.sec} className="mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{g.sec}</div>
          <div className="grid grid-cols-2 gap-1">{g.items.map(([k, lbl]) => (<label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={perms[k] !== false} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />{lbl}</label>))}</div>
        </div>))}
        <div className="mt-3 flex justify-end gap-2"><button className="rounded border px-3 py-1.5 text-sm" onClick={() => setPermFor(null)}>Cancel</button><button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={savePerms}>Save Permissions</button></div>
      </div>
    </div>)}
  </div>);
}