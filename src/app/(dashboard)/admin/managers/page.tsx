"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useDialog } from "@/components/ui/ConfirmDialog";
import PasswordInput from "@/components/ui/PasswordInput";

interface Manager {
  id: string; name: string; email: string; status: string;
  perms: Record<string, boolean>; _count: { managedAccounts: number };
}
const PERMS = ["canManageClients", "canAdjustBalance", "canViewReports", "canManageTrades"];
const empty = { name: "", email: "", password: "", perms: {} as Record<string, boolean> };

export default function AdminManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>({ ...empty });
  const { confirm, node } = useDialog();

  async function load() {
    setLoading(true);
    const d = await fetch("/api/admin/managers").then((r) => r.json());
    setLoading(false);
    if (d.ok) setManagers(d.managers); else setErr(d.error || "Failed");
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/admin/managers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setForm({ ...empty, perms: {} }); setShowCreate(false); load();
  }

  async function togglePerm(m: Manager, key: string) {
    const perms = { ...m.perms, [key]: !m.perms?.[key] };
    await fetch("/api/admin/managers/" + m.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perms }),
    });
    load();
  }

  async function toggleStatus(m: Manager) {
    await fetch("/api/admin/managers/" + m.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }),
    });
    load();
  }

  async function remove(m: Manager) {
    if (!(await confirm({ title: "Delete manager", message: m.email + " will be removed.", danger: true }))) return;
    await fetch("/api/admin/managers/" + m.id, { method: "DELETE" });
    load();
  }

  const input = "ui-input w-full px-3 py-2 text-sm";

  return (
    <div className="space-y-6 ui-fade-up">
      {node}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Managers</h1>

        </div>
        <button onClick={() => setShowCreate((v) => !v)}
          className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium">
          {showCreate ? "Close" : "New manager"}
        </button>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {showCreate && (
        <form onSubmit={create} className="ui-card space-y-3 p-4">
          <div className="grid grid-cols-3 gap-3">
            <input className={input} placeholder="Name" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={input} type="email" placeholder="Email" required value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <PasswordInput className={input} placeholder="Password (min 6)" required value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {PERMS.map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input type="checkbox" checked={!!form.perms[p]}
                  onChange={(e) => setForm({ ...form, perms: { ...form.perms, [p]: e.target.checked } })} />
                {p}
              </label>
            ))}
          </div>
          <button type="submit" className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium">Create manager</button>
        </form>
      )}

      <div className="ui-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Clients</th><th className="px-3 py-2">Permissions</th>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4" colSpan={6}>Loading...</td></tr>
            ) : managers.length === 0 ? (
              <tr><td className="px-3 py-4" colSpan={6}>No managers yet.</td></tr>
            ) : managers.map((m) => (
              <tr key={m.id} className="ui-row border-b last:border-0 align-top">
                <td className="px-3 py-2">{m.name}</td>
                <td className="px-3 py-2">{m.email}</td>
                <td className="px-3 py-2">{m._count.managedAccounts}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {PERMS.map((p) => (
                      <label key={p} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!m.perms?.[p]} onChange={() => togglePerm(m, p)} />
                        {p.replace("can", "")}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={"rounded px-2 py-0.5 text-xs " + (m.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                    {m.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-yellow-700" onClick={() => toggleStatus(m)}>
                    {m.status === "ACTIVE" ? "Suspend" : "Activate"}
                  </button>
                  <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => remove(m)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



