"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";
import { PresenceDot, DeviceIcon, ago } from "@/components/ui/Presence";

const PERM_GROUPS: { sec: string; items: [string, string][] }[] = [
  { sec: "Users", items: [["createClients", "Create Clients"], ["deleteClients", "Delete Clients"], ["manageManagers", "Manage Managers"]] },
  { sec: "Funds", items: [["processDeposits", "Process Deposits"], ["processWithdrawals", "Process Withdrawals"], ["creditBonus", "Credit / Bonus / Insurance"], ["transferFunds", "Transfer Funds"], ["editFinancial", "Edit Financial History"], ["deleteFinancial", "Delete Financial History"]] },
  { sec: "Trades", items: [["manualTrade", "Manual Trade Entry"], ["closeTrades", "Close Trades"], ["editTrades", "Edit Trade Records"], ["deleteTrades", "Delete Trades"]] },
  { sec: "Reports", items: [["viewAudit", "View Audit Log"], ["exportPdf", "Export PDF Reports"]] },
  { sec: "Communication", items: [["sendNotifications", "Send Notifications"]] },
];

export default function StaffConsole({ role, title, subtitle, newLabel }: { role: string; title: string; subtitle: string; newLabel: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  // Edit modal
  const [editRow, setEditRow] = useState<any>(null);
  const [ef, setEf] = useState<any>({});

  // Password modal
  const [pwRow, setPwRow] = useState<any>(null);
  const [pwVal, setPwVal] = useState("");
  const [pwShow, setPwShow] = useState(false);

  // Permissions modal
  const [permFor, setPermFor] = useState<any>(null);
  const [perms, setPerms] = useState<any>({});

  // Delete confirm
  const [delRow, setDelRow] = useState<any>(null);

  async function load() {
    try {
      const d = await fetch("/api/superadmin/staff?role=" + role).then((r) => r.json());
      if (d.ok) setRows(d.users || d.staff || []);
    } catch {}
  }
  async function loadTenants() {
    try {
      const d = await fetch("/api/superadmin/outsource").then((r) => r.json());
      if (d.ok) setTenants(d.outsources || []);
    } catch {}
  }
  useEffect(() => { load(); loadTenants(); }, [role]);

  async function act(id: string, action: string, extra: any = {}) {
    setErr("");
    const r = await fetch("/api/superadmin/staff/" + id, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return false; }
    load();
    return true;
  }

  async function create() {
    setErr("");
    if (!form.name || !form.email || !form.password || !form.tenantId) { setErr("All fields required"); return; }
    const r = await fetch("/api/superadmin/staff", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, name: form.name, email: form.email, password: form.password, tenantId: form.tenantId }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setCreateOpen(false); setForm({}); load();
  }

  function openEdit(u: any) {
    setErr("");
    setEf({ name: u.name, email: u.email, tenantId: u.tenantId || "" });
    setEditRow(u);
  }
  async function saveEdit() {
    if (!editRow) return;
    const ok = await act(editRow.id, "edit", { name: ef.name, email: ef.email, tenantId: ef.tenantId || null });
    if (ok) setEditRow(null);
  }

  async function savePw() {
    if (!pwRow || pwVal.length < 6) return;
    const ok = await act(pwRow.id, "resetPassword", { password: pwVal });
    if (ok) { setPwRow(null); setPwVal(""); }
  }

  function openPerms(u: any) { setPermFor(u); setPerms(u.perms || {}); }
  async function savePerms() {
    if (!permFor) return;
    await act(permFor.id, "perms", { perms });
    setPermFor(null);
  }

  const filtered = rows.filter((u: any) => !q || (u.name + u.email).toLowerCase().includes(q.toLowerCase()));
  const inp = "ui-input px-2 py-1.5 text-sm w-full";
  const btnStyle = (bg: string, color: string) => ({ background: bg, color, padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12 });

  return (
    <div className="ui-fade-up space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        <button onClick={() => { setErr(""); setForm({ tenantId: tenants[0]?.id || "" }); setCreateOpen(true); }} className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium">
          + {newLabel}
        </button>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="ui-card overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "#e2e8f0" }}>
          <i className="fa-solid fa-magnifying-glass text-[11px] text-gray-400" />
          <input className="flex-1 border-none bg-transparent text-sm outline-none" placeholder="Search name / email" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-gray-400">{filtered.length} rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "#f8fafc" }}>
              <tr className="border-b text-left" style={{ borderColor: "#e2e8f0" }}>
                {["Name / Email", "Tenant", "Status", "Last Login", "Last IP", "Permissions", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u: any) => (
                <tr key={u.id} className="ui-row border-b" style={{ borderColor: "#f0f4f8" }}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5"><PresenceDot online={u.online} /></span>
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">{u.name}{u.device && <DeviceIcon device={u.device} className="text-[11px] text-gray-400" />}</div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                        <div className="text-[10px]" style={{ color: u.online ? "#16a34a" : "#94a3b8" }}>{u.online ? "Online" : "last seen " + ago(u.lastSeenAt)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.company
                      ? <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#dbeafe", color: "#1d4ed8" }}>{u.company}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={"sab " + (u.status === "ACTIVE" ? "sab-green" : u.status === "LOCKED" ? "sab-red" : "sab-amber")}>{u.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-gray-500">
                    {u.lastLoginIp || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs" onClick={() => openPerms(u)}>
                      <i className="fa-solid fa-user-shield mr-1" />Permissions
                    </button>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {/* Edit */}
                    <button title="Edit info / change tenant" style={btnStyle("#f1f5f9", "#475569")} className="mr-1 ui-transition hover-lift" onClick={() => openEdit(u)}>
                      <i className="fa-solid fa-pen text-xs" />
                    </button>
                    {/* Password */}
                    <button title="Reset password" style={btnStyle("#fff7ed", "#b45309")} className="mr-1 ui-transition hover-lift" onClick={() => { setPwVal(""); setPwShow(false); setPwRow(u); }}>
                      <i className="fa-solid fa-key text-xs" />
                    </button>
                    {/* Lock / Unlock */}
                    <button title={u.status === "ACTIVE" ? "Lock account" : "Unlock account"} style={btnStyle(u.status === "ACTIVE" ? "#fff1f2" : "#f0fdf4", u.status === "ACTIVE" ? "#dc2626" : "#15803d")} className="mr-1 ui-transition hover-lift" onClick={() => act(u.id, u.status === "ACTIVE" ? "lock" : "unlock", {})}>
                      <i className={"fa-solid text-xs " + (u.status === "ACTIVE" ? "fa-lock" : "fa-lock-open")} />
                    </button>
                    {/* Delete */}
                    <button title="Delete" style={btnStyle("#fff1f2", "#dc2626")} className="ui-transition hover-lift" onClick={() => setDelRow(u)}>
                      <i className="fa-solid fa-trash text-xs" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={7}>No {role.toLowerCase()}s found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CREATE MODAL ── */}
      {createOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={() => setCreateOpen(false)}>
          <div className="ui-card ui-pop max-h-[90vh] w-[400px] overflow-y-auto p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="font-semibold text-lg">{newLabel}</div>
              <button onClick={() => setCreateOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-500 block mb-1">FULL NAME</label><input className={inp} placeholder="Full name" autoComplete="off" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-gray-500 block mb-1">EMAIL</label><input className={inp} placeholder="Email address" autoComplete="off" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-gray-500 block mb-1">PASSWORD</label><PasswordInput className={inp} placeholder="Min 6 characters" autoComplete="new-password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">ASSIGN TO TENANT</label>
                <select className={inp} value={form.tenantId || ""} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                  <option value="">— Select tenant —</option>
                  {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
                </select>
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={create}>Create {role === "ADMIN" ? "Admin" : "Manager"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={() => setEditRow(null)}>
          <div className="ui-card ui-pop max-h-[90vh] w-[440px] overflow-y-auto p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold text-lg">Edit {role === "ADMIN" ? "Admin" : "Manager"}</div>
              <button onClick={() => setEditRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="mb-4 text-xs text-gray-400">{editRow.email}</div>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-500 block mb-1">FULL NAME</label><input className={inp} autoComplete="off" value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-gray-500 block mb-1">EMAIL</label><input className={inp} autoComplete="off" value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">TENANT ASSIGNMENT</label>
                <select className={inp} value={ef.tenantId} onChange={(e) => setEf({ ...ef, tenantId: e.target.value })}>
                  <option value="">— No Tenant (Super Admin level) —</option>
                  {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">Changing the tenant will move this {role.toLowerCase()} to the selected workspace.</p>
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setEditRow(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PASSWORD MODAL ── */}
      {pwRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={() => setPwRow(null)}>
          <div className="ui-card ui-pop w-[360px] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold">Reset Password</div>
              <button onClick={() => setPwRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="mb-3 text-xs text-gray-500">{pwRow.name} — {pwRow.email}</div>
            <div className="relative">
              <input type={pwShow ? "text" : "password"} className={inp} placeholder="New password (min 6)" value={pwVal} onChange={(e) => setPwVal(e.target.value)} autoFocus />
              <button type="button" className="absolute right-2 top-2 text-gray-400 transition-colors duration-200 hover:text-gray-600" onClick={() => setPwShow((v) => !v)}>
                <i className={"fa-solid text-xs " + (pwShow ? "fa-eye-slash" : "fa-eye")} />
              </button>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPwRow(null)}>Cancel</button>
              <button disabled={pwVal.length < 6} className="ui-btn bg-amber-600 px-4 py-2 text-sm font-medium text-white" onClick={savePw}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PERMISSIONS MODAL ── */}
      {permFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={() => setPermFor(null)}>
          <div className="ui-card ui-pop max-h-[80vh] w-[500px] overflow-auto p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-0.5 flex items-center justify-between">
              <div className="font-semibold text-lg">Permissions — {permFor.name}</div>
              <button onClick={() => setPermFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="mb-4 text-xs text-gray-500">Personal permissions (still gated by the tenant-level permissions).</div>
            {PERM_GROUPS.map((g) => (
              <div key={g.sec} className="mb-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b pb-1" style={{ borderColor: "#e2e8f0" }}>{g.sec}</div>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-2 text-sm cursor-pointer transition-colors duration-200">
                      <input type="checkbox" className="rounded" checked={perms[k] !== false} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPermFor(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" onClick={savePerms}>Save Permissions</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {delRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={() => setDelRow(null)}>
          <div className="ui-card ui-pop w-[380px] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold text-red-600">Delete {role === "ADMIN" ? "Admin" : "Manager"}</div>
              <button onClick={() => setDelRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <p className="mb-4 text-sm text-gray-600">Delete <span className="font-semibold">{delRow.name}</span> ({delRow.email})? This cannot be undone.</p>
            {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button className="ui-btn ui-btn-ghost px-4 py-2 text-sm" onClick={() => setDelRow(null)}>Cancel</button>
              <button className="ui-btn bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={async () => { const ok = await act(delRow.id, "delete", {}); if (ok) setDelRow(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
