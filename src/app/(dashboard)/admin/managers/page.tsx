"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

interface Manager {
  id: string; name: string; email: string; status: string;
  perms: Record<string, boolean>; _count: { managedAccounts: number };
}

// Same permission keys the server enforces (perms.ts PERM_KEYS), grouped for the UI.
const PERM_GROUPS: { sec: string; items: [string, string][] }[] = [
  { sec: "Users", items: [["createClients", "Create Clients"], ["deleteClients", "Delete Clients"]] },
  { sec: "Funds", items: [["processDeposits", "Process Deposits"], ["processWithdrawals", "Process Withdrawals"], ["creditBonus", "Credit / Bonus / Insurance"], ["transferFunds", "Transfer Funds"], ["editFinancial", "Edit Financial History"], ["deleteFinancial", "Delete Financial History"]] },
  { sec: "Trades", items: [["manualTrade", "Manual Trade Entry"], ["closeTrades", "Close Trades"], ["editTrades", "Edit Trade Records"], ["deleteTrades", "Delete Trades"]] },
  { sec: "Reports", items: [["viewAudit", "View Audit Log"], ["exportPdf", "Export PDF Reports"]] },
  { sec: "Communication", items: [["sendNotifications", "Send Notifications"]] },
];

export default function AdminManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", email: "", password: "", perms: {} });

  const [editRow, setEditRow] = useState<Manager | null>(null);
  const [ef, setEf] = useState<any>({});

  const [pwRow, setPwRow] = useState<Manager | null>(null);
  const [pwVal, setPwVal] = useState("");

  const [permFor, setPermFor] = useState<Manager | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  const [delRow, setDelRow] = useState<Manager | null>(null);

  async function load() {
    setLoading(true);
    const d = await fetch("/api/admin/managers").then((r) => r.json()).catch(() => ({ ok: false }));
    setLoading(false);
    if (d.ok) setManagers(d.managers); else setErr(d.error || "Failed");
  }
  useEffect(() => { load(); }, []);

  async function patch(id: string, body: any) {
    setErr("");
    const r = await fetch("/api/admin/managers/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return false; }
    load(); return true;
  }

  async function create() {
    setErr("");
    if (!form.name || !form.email || !form.password) { setErr("All fields required"); return; }
    const r = await fetch("/api/admin/managers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setCreateOpen(false); setForm({ name: "", email: "", password: "", perms: {} }); load();
  }

  const inp = "ui-input w-full px-3 py-2 text-sm";
  const filtered = managers;

  return (
    <div className="space-y-4 ui-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Managers</h1>
          <p className="text-sm text-gray-500">Create managers, set permissions, lock / deactivate, reset credentials.</p>
        </div>
        <button onClick={() => { setErr(""); setForm({ name: "", email: "", password: "", perms: {} }); setCreateOpen(true); }} className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium">+ New Manager</button>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="ui-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left">
            <tr>
              {["Name / Email", "Clients", "Status", "Permissions", "Actions"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={5}>Loading…</td></tr>
              : filtered.length === 0 ? <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={5}>No managers yet.</td></tr>
              : filtered.map((m) => (
                <tr key={m.id} className="ui-row border-b">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-gray-400">{m.email}</div>
                  </td>
                  <td className="px-3 py-2.5">{m._count?.managedAccounts ?? 0}</td>
                  <td className="px-3 py-2.5">
                    <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + (m.status === "ACTIVE" ? "bg-green-100 text-green-700" : m.status === "LOCKED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>{m.status}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs" onClick={() => { setPermFor(m); setPerms(m.perms || {}); }}>
                      <i className="fa-solid fa-user-shield mr-1" />Permissions
                    </button>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                    <button title="Edit" onClick={() => { setErr(""); setEf({ name: m.name, email: m.email }); setEditRow(m); }} className="mr-1 rounded px-2 py-1" style={{ background: "#f1f5f9", color: "#475569" }}><i className="fa-solid fa-pen" /></button>
                    <button title="Reset password" onClick={() => { setPwVal(""); setPwRow(m); }} className="mr-1 rounded px-2 py-1" style={{ background: "#fff7ed", color: "#b45309" }}><i className="fa-solid fa-key" /></button>
                    <button title={m.status === "LOCKED" ? "Unlock" : "Lock (read-only)"} onClick={() => patch(m.id, { status: m.status === "LOCKED" ? "ACTIVE" : "LOCKED" })} className="mr-1 rounded px-2 py-1" style={{ background: m.status === "LOCKED" ? "#f0fdf4" : "#fff1f2", color: m.status === "LOCKED" ? "#15803d" : "#dc2626" }}><i className={"fa-solid " + (m.status === "LOCKED" ? "fa-lock-open" : "fa-lock")} /></button>
                    <button title={m.status === "SUSPENDED" ? "Activate" : "Deactivate (block sign-in)"} onClick={() => patch(m.id, { status: m.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" })} className="mr-1 rounded px-2 py-1" style={{ background: "#fff7ed", color: "#b45309" }}><i className={"fa-solid " + (m.status === "SUSPENDED" ? "fa-circle-check" : "fa-ban")} /></button>
                    <button title="Delete" onClick={() => setDelRow(m)} className="rounded px-2 py-1" style={{ background: "#fff1f2", color: "#dc2626" }}><i className="fa-solid fa-trash" /></button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* CREATE */}
      {createOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="ui-card ui-pop max-h-[90vh] w-[440px] overflow-y-auto p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div className="text-lg font-semibold">New Manager</div><button onClick={() => setCreateOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"><i className="fa-solid fa-xmark" /></button></div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-medium text-gray-500">FULL NAME</label><input className={inp} value={form.name} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">EMAIL</label><input className={inp} value={form.email} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">PASSWORD</label><PasswordInput className={inp} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" /></div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">PERMISSIONS</label>
                {PERM_GROUPS.map((g) => (
                  <div key={g.sec} className="mb-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{g.sec}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items.map(([k, lbl]) => (
                        <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.perms[k] !== false} onChange={(e) => setForm({ ...form, perms: { ...form.perms, [k]: e.target.checked } })} />{lbl}</label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={create}>Create Manager</button></div>
          </div>
        </div>
      )}

      {/* EDIT */}
      {editRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="ui-card ui-pop w-[400px] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div className="text-lg font-semibold">Edit Manager</div><button onClick={() => setEditRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"><i className="fa-solid fa-xmark" /></button></div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-medium text-gray-500">FULL NAME</label><input className={inp} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">EMAIL</label><input className={inp} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setEditRow(null)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={async () => { if (await patch(editRow.id, { name: ef.name, email: ef.email })) setEditRow(null); }}>Save</button></div>
          </div>
        </div>
      )}

      {/* PASSWORD */}
      {pwRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="ui-card ui-pop w-[360px] p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><div className="font-semibold">Reset Password</div><button onClick={() => setPwRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"><i className="fa-solid fa-xmark" /></button></div>
            <div className="mb-3 text-xs text-gray-500">{pwRow.name} — {pwRow.email}</div>
            <PasswordInput className={inp} value={pwVal} onChange={(e) => setPwVal(e.target.value)} placeholder="New password (min 6)" autoFocus />
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPwRow(null)}>Cancel</button><button disabled={pwVal.length < 6} className="ui-btn bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={async () => { if (await patch(pwRow.id, { password: pwVal })) { setPwRow(null); setPwVal(""); } }}>Reset</button></div>
          </div>
        </div>
      )}

      {/* PERMISSIONS */}
      {permFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="ui-card ui-pop max-h-[80vh] w-[500px] overflow-auto p-5 shadow-2xl">
            <div className="mb-0.5 flex items-center justify-between"><div className="text-lg font-semibold">Permissions — {permFor.name}</div><button onClick={() => setPermFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"><i className="fa-solid fa-xmark" /></button></div>
            <div className="mb-4 text-xs text-gray-500">Unchecked = denied. Still gated by the tenant-level permissions.</div>
            {PERM_GROUPS.map((g) => (
              <div key={g.sec} className="mb-4">
                <div className="mb-2 border-b pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400" style={{ borderColor: "var(--border)" }}>{g.sec}</div>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map(([k, lbl]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={perms[k] !== false} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />{lbl}</label>
                  ))}
                </div>
              </div>
            ))}
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPermFor(null)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={async () => { if (await patch(permFor.id, { perms })) setPermFor(null); }}>Save Permissions</button></div>
          </div>
        </div>
      )}

      {/* DELETE */}
      {delRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="ui-card ui-pop w-[380px] p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><div className="font-semibold text-red-600">Delete Manager</div><button onClick={() => setDelRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"><i className="fa-solid fa-xmark" /></button></div>
            <p className="mb-4 text-sm text-gray-600">Delete <span className="font-semibold">{delRow.name}</span> ({delRow.email})? This cannot be undone.</p>
            {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-4 py-2 text-sm" onClick={() => setDelRow(null)}>Cancel</button><button className="ui-btn bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={async () => { setErr(""); const r = await fetch("/api/admin/managers/" + delRow.id, { method: "DELETE" }).then((x) => x.json()); if (r.ok) { setDelRow(null); load(); } else setErr(r.error || "Delete failed"); }}>Delete</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
