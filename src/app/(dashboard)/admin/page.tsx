"use client";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";
import PasswordInput from "@/components/ui/PasswordInput";

interface Client {
  id: string; login: string; name: string; type: string; leverage: number; currency: string;
  locked: boolean; deposit: string; withdrawal: string; credit: string; bonus: string; pnl: string;
  managerId: string | null; user: { email: string } | null; manager: { id: string; name: string } | null;
}
interface Manager { id: string; name: string; }

const bal = (c: Client) => Number(c.deposit) - Number(c.withdrawal) + Number(c.credit) + Number(c.bonus) + Number(c.pnl);
const emptyForm = { name: "", email: "", password: "", type: "LIVE", leverage: 100, currency: "USD", managerId: "" };

export default function AdminClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [manage, setManage] = useState<any>(null);
  const { confirm, node } = useDialog();

  async function load() {
    setLoading(true);
    const [c, m] = await Promise.all([
      fetch("/api/admin/clients").then((r) => r.json()),
      fetch("/api/admin/managers").then((r) => r.json()),
    ]);
    setLoading(false);
    if (c.ok) setClients(c.clients); else setErr(c.error || "Failed");
    if (m.ok) setManagers(m.managers);
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/admin/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, leverage: Number(form.leverage), managerId: form.managerId || null }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setForm({ ...emptyForm }); setShowCreate(false); load();
  }

  async function openManage(c: Client) {
    const d = await fetch("/api/admin/clients/" + c.id).then((r) => r.json());
    if (d.ok) setManage({ ...d.client, _bal: { type: "DEPOSIT", amount: 0, description: "" }, _pnl: { amount: 0, note: "" }, _pw: "" });
  }
  async function saveSettings() {
    const r = await fetch("/api/admin/clients/" + manage.id, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leverage: Number(manage.leverage), mcLevel: Number(manage.mcLevel), doNotLiquidate: manage.doNotLiquidate, currency: manage.currency, managerId: manage.managerId || null }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error); return; } setManage(null); load();
  }
  async function applyBalance() {
    const r = await fetch("/api/admin/clients/" + manage.id + "/balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...manage._bal, amount: Number(manage._bal.amount) }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error); return; } openManage(manage); load();
  }
  async function applyPnl() {
    const r = await fetch("/api/admin/clients/" + manage.id + "/manual-pnl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(manage._pnl.amount), note: manage._pnl.note }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error); return; } openManage(manage); load();
  }
  async function applyPassword() {
    const r = await fetch("/api/admin/clients/" + manage.id + "/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: manage._pw }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error); return; } setManage({ ...manage, _pw: "" }); setMsg("Password reset"); setTimeout(() => setMsg(""), 2000);
  }
  async function remove(c: Client) {
    if (!(await confirm({ title: "Delete client", message: c.login + " — " + c.name + " will be removed.", danger: true }))) return;
    await fetch("/api/admin/clients/" + c.id, { method: "DELETE" }); load();
  }

  const input = "w-full rounded-md border px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      {node}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <button onClick={() => setShowCreate((v) => !v)} style={{ backgroundColor: "var(--brand-primary)" }} className="rounded-md px-4 py-2 text-sm font-medium text-white">{showCreate ? "Close" : "New client"}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {showCreate && (
        <form onSubmit={create} className="grid grid-cols-3 gap-3 rounded-lg border bg-white p-4">
          <input className={input} placeholder="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={input} type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <PasswordInput className={input} placeholder="Password (min 6)" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="LIVE">LIVE</option><option value="DEMO">DEMO</option></select>
          <input className={input} type="number" placeholder="Leverage" value={form.leverage} onChange={(e) => setForm({ ...form, leverage: Number(e.target.value) })} />
          <select className={input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>USD</option><option>EUR</option><option>GBP</option></select>
          <select className={input} value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}><option value="">No manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <button type="submit" className="col-span-3 rounded-md bg-green-600 py-2 text-sm font-medium text-white">Create client</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600"><tr>
            <th className="px-3 py-2">Login</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Lev</th><th className="px-3 py-2">Balance</th><th className="px-3 py-2">Manager</th>
            <th className="px-3 py-2">State</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td className="px-3 py-4" colSpan={8}>Loading...</td></tr> : clients.length === 0 ? <tr><td className="px-3 py-4" colSpan={8}>No clients.</td></tr> : clients.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono">{c.login}</td>
                <td className="px-3 py-2">{c.name}<div className="text-xs text-gray-500">{c.user?.email}</div></td>
                <td className="px-3 py-2">{c.type}</td><td className="px-3 py-2">1:{c.leverage}</td>
                <td className="px-3 py-2">{bal(c).toFixed(2)} {c.currency}</td>
                <td className="px-3 py-2">{c.manager?.name || "-"}</td>
                <td className="px-3 py-2"><span className={"rounded px-2 py-0.5 text-xs " + (c.locked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>{c.locked ? "LOCKED" : "ACTIVE"}</span></td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button className="text-blue-600" onClick={() => openManage(c)}>Manage</button>
                  <button className="text-red-600" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manage && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/30 p-4">
          <div className="w-full max-w-2xl space-y-4 rounded-lg bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Manage {manage.login} - {manage.name}</h2>
              <button className="text-gray-500" onClick={() => setManage(null)}>Close</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-semibold">Settings</div>
                <label className="block text-xs text-gray-500">Leverage<input className={input} type="number" value={manage.leverage} onChange={(e) => setManage({ ...manage, leverage: e.target.value })} /></label>
                <label className="block text-xs text-gray-500">Stop-out / MC level %<input className={input} type="number" value={manage.mcLevel} onChange={(e) => setManage({ ...manage, mcLevel: e.target.value })} /></label>
                <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={manage.doNotLiquidate} onChange={(e) => setManage({ ...manage, doNotLiquidate: e.target.checked })} />Do not liquidate</label>
                <label className="block text-xs text-gray-500">Currency<select className={input} value={manage.currency} onChange={(e) => setManage({ ...manage, currency: e.target.value })}><option>USD</option><option>EUR</option><option>GBP</option></select></label>
                <label className="block text-xs text-gray-500">Manager<select className={input} value={manage.managerId || ""} onChange={(e) => setManage({ ...manage, managerId: e.target.value })}><option value="">None</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={saveSettings}>Save settings</button>
              </div>

              <div className="space-y-3">
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-semibold">Balance</div>
                  <select className={input} value={manage._bal.type} onChange={(e) => setManage({ ...manage, _bal: { ...manage._bal, type: e.target.value } })}>
                    <option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option><option value="CREDIT_IN">Credit In</option><option value="CREDIT_OUT">Credit Out</option><option value="BONUS">Bonus</option><option value="INSURANCE">Insurance</option>
                  </select>
                  <input className={input} type="number" placeholder="Amount" value={manage._bal.amount} onChange={(e) => setManage({ ...manage, _bal: { ...manage._bal, amount: e.target.value } })} />
                  <button className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white" onClick={applyBalance}>Apply</button>
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-semibold">Manual P&L</div>
                  <input className={input} type="number" placeholder="Amount (+/-)" value={manage._pnl.amount} onChange={(e) => setManage({ ...manage, _pnl: { ...manage._pnl, amount: e.target.value } })} />
                  <button className="rounded-md bg-purple-600 px-3 py-1.5 text-sm text-white" onClick={applyPnl}>Apply P&L</button>
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-semibold">Reset password</div>
                  <input className={input} type="text" placeholder="New password" value={manage._pw} onChange={(e) => setManage({ ...manage, _pw: e.target.value })} />
                  <button className="rounded-md bg-gray-700 px-3 py-1.5 text-sm text-white" onClick={applyPassword}>Reset</button>
                </div>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold">Financial history</div>
              <div className="max-h-40 overflow-auto text-sm">
                {manage.financials?.length ? manage.financials.map((f: any) => (
                  <div key={f.id} className="flex justify-between border-b py-1 last:border-0">
                    <span>{f.type} {f.amount.toFixed(2)} <span className="text-gray-400">{f.description}</span></span>
                    <span className="text-xs text-gray-400">{new Date(f.appliedAt).toLocaleString()}</span>
                  </div>
                )) : <div className="text-gray-500">No transactions.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
