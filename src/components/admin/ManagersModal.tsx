"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";
import CountrySelect from "@/components/ui/CountrySelect";

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

// In-place Manage Managers modal — opens over the desk, no page navigation.
// Themed with CSS vars so it matches both light and dark desk.
export default function ManagersModal({ onClose }: { onClose: () => void }) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("ALL");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", email: "", password: "", phone: "", country: "", perms: {} });

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
    setCreateOpen(false); setForm({ name: "", email: "", password: "", phone: "", country: "", perms: {} }); load();
  }

  // Use the DESK's trading-theme vars (--panel/--bg/--text/--border), NOT .ui-card
  // /.ui-input which pull next-themes light vars (white) and broke the dark theme.
  const inp = "w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bg)] text-[var(--text)] border-[var(--border)] outline-none focus:border-[var(--accent)]";
  const lab = "mb-1 block text-[11px] font-medium text-[var(--muted)]";
  const ovl = "fixed inset-0 z-[120] flex items-center justify-center bg-black/20 p-6";
  const card = "ui-pop desk-modal rounded-2xl border p-5 shadow-2xl bg-[var(--panel)] text-[var(--text)] border-[var(--border)]";

  const filtered = managers.filter((m) => {
    if (statusF !== "ALL" && m.status !== statusF) return false;
    if (q) { const s = q.toLowerCase(); if (!(m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s))) return false; }
    return true;
  });

  return (
    <div className={ovl} onMouseDown={onClose}>
      <div className={card + " max-h-[88vh] w-[760px] overflow-hidden flex flex-col"} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Manage Managers</div>
            <div className="text-[11px] text-[var(--muted)]">Create managers, set permissions, lock / deactivate, reset credentials.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setErr(""); setForm({ name: "", email: "", password: "", phone: "", country: "", perms: {} }); setCreateOpen(true); }} className="ui-btn ui-btn-primary px-3 py-1.5 text-xs font-medium" style={{ background: "var(--accent)", color: "#fff" }}>+ New Manager</button>
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
          </div>
        </div>

        {/* Filters (right-aligned) */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--muted)]">{filtered.length} manager{filtered.length === 1 ? "" : "s"}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / email" className="ml-auto rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] min-w-[180px]" />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)]">
            <option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="LOCKED">Locked</option><option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        {err && <div className="mb-2 rounded-lg border border-red-300 bg-red-500/10 px-3 py-2 text-xs text-red-500">{err}</div>}

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)]">
          <table className="w-full border-collapse text-xs [&_td]:border [&_td]:border-[var(--border)] [&_th]:border [&_th]:border-[var(--border)] [&_td]:px-3 [&_th]:px-3">
            <thead><tr className="sticky top-0 z-10 bg-[var(--soft)] text-left">
              {["Name / Email", "Clients", "Status", "Permissions", "Actions"].map((h) => (
                <th key={h} className="py-2 text-[11px] font-semibold text-[var(--muted)]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? <tr><td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={5}>Loading…</td></tr>
                : filtered.length === 0 ? <tr><td className="px-3 py-8 text-center text-[var(--muted)]" colSpan={5}>No managers.</td></tr>
                : filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-[var(--soft)]">
                    <td className="py-2"><div className="font-medium">{m.name}</div><div className="text-[10px] text-[var(--muted)]">{m.email}</div></td>
                    <td className="py-2">{m._count?.managedAccounts ?? 0}</td>
                    <td className="py-2"><span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + (m.status === "ACTIVE" ? "bg-green-500/15 text-green-500" : m.status === "LOCKED" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-500")}>{m.status}</span></td>
                    <td className="py-2"><button className="rounded px-2 py-1 text-[11px]" style={{ background: "var(--soft)", color: "var(--accent)" }} onClick={() => { setPermFor(m); setPerms(m.perms || {}); }}><i className="fa-solid fa-user-shield mr-1" />Permissions</button></td>
                    <td className="py-2 whitespace-nowrap text-[11px]">
                      <button title="Edit" onClick={() => { setErr(""); setEf({ name: m.name, email: m.email }); setEditRow(m); }} className="mr-1 rounded px-2 py-1" style={{ background: "var(--soft)", color: "var(--text)" }}><i className="fa-solid fa-pen" /></button>
                      <button title="Reset password" onClick={() => { setPwVal(""); setPwRow(m); }} className="mr-1 rounded px-2 py-1" style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}><i className="fa-solid fa-key" /></button>
                      <button title={m.status === "LOCKED" ? "Unlock" : "Lock (read-only)"} onClick={() => patch(m.id, { status: m.status === "LOCKED" ? "ACTIVE" : "LOCKED" })} className="mr-1 rounded px-2 py-1" style={{ background: "var(--soft)", color: m.status === "LOCKED" ? "#16a34a" : "#dc2626" }}><i className={"fa-solid " + (m.status === "LOCKED" ? "fa-lock-open" : "fa-lock")} /></button>
                      <button title={m.status === "SUSPENDED" ? "Activate" : "Deactivate (block sign-in)"} onClick={() => patch(m.id, { status: m.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" })} className="mr-1 rounded px-2 py-1" style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}><i className={"fa-solid " + (m.status === "SUSPENDED" ? "fa-circle-check" : "fa-ban")} /></button>
                      <button title="Delete" onClick={() => setDelRow(m)} className="rounded px-2 py-1" style={{ background: "rgba(220,38,38,0.15)", color: "#dc2626" }}><i className="fa-solid fa-trash" /></button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE */}
      {createOpen && (
        <div className={ovl} onMouseDown={() => setCreateOpen(false)}>
          <div className={card + " max-h-[90vh] w-[440px] overflow-y-auto"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><div className="text-base font-semibold">New Manager</div><button onClick={() => setCreateOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button></div>
            <div className="space-y-3">
              <div><label className={lab}>FULL NAME</label><input className={inp} value={form.name} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className={lab}>PHONE</label><input className={inp} value={form.phone} autoComplete="off" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label className={lab}>EMAIL</label><input className={inp} value={form.email} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className={lab}>PASSWORD</label><PasswordInput className={inp} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" /></div>
              <div><label className={lab}>COUNTRY</label><CountrySelect className={inp} value={form.country} onChange={(v) => setForm({ ...form, country: v })} /></div>
              <div>
                <label className={lab}>PERMISSIONS</label>
                {PERM_GROUPS.map((g) => (
                  <div key={g.sec} className="mb-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{g.sec}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items.map(([k, lbl]) => (
                        <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.perms[k] !== false} onChange={(e) => setForm({ ...form, perms: { ...form.perms, [k]: e.target.checked } })} />{lbl}</label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" style={{ background: "var(--accent)", color: "#fff" }} onClick={create}>Create Manager</button></div>
          </div>
        </div>
      )}

      {/* EDIT */}
      {editRow && (
        <div className={ovl} onMouseDown={() => setEditRow(null)}>
          <div className={card + " w-[400px]"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><div className="text-base font-semibold">Edit Manager</div><button onClick={() => setEditRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button></div>
            <div className="space-y-3">
              <div><label className={lab}>FULL NAME</label><input className={inp} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></div>
              <div><label className={lab}>EMAIL</label><input className={inp} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></div>
            </div>
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setEditRow(null)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" style={{ background: "var(--accent)", color: "#fff" }} onClick={async () => { if (await patch(editRow.id, { name: ef.name, email: ef.email })) setEditRow(null); }}>Save</button></div>
          </div>
        </div>
      )}

      {/* PASSWORD */}
      {pwRow && (
        <div className={ovl} onMouseDown={() => setPwRow(null)}>
          <div className={card + " w-[360px]"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between"><div className="font-semibold">Reset Password</div><button onClick={() => setPwRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button></div>
            <div className="mb-3 text-xs text-[var(--muted)]">{pwRow.name} — {pwRow.email}</div>
            <PasswordInput className={inp} value={pwVal} onChange={(e) => setPwVal(e.target.value)} placeholder="New password (min 6)" autoFocus />
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="mt-3 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPwRow(null)}>Cancel</button><button disabled={pwVal.length < 6} className="ui-btn px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: "#d97706" }} onClick={async () => { if (await patch(pwRow.id, { password: pwVal })) { setPwRow(null); setPwVal(""); } }}>Reset</button></div>
          </div>
        </div>
      )}

      {/* PERMISSIONS */}
      {permFor && (
        <div className={ovl} onMouseDown={() => setPermFor(null)}>
          <div className={card + " max-h-[80vh] w-[500px] overflow-auto"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-0.5 flex items-center justify-between"><div className="text-base font-semibold">Permissions — {permFor.name}</div><button onClick={() => setPermFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button></div>
            <div className="mb-4 text-xs text-[var(--muted)]">Unchecked = denied. Still gated by the tenant-level permissions.</div>
            {PERM_GROUPS.map((g) => (
              <div key={g.sec} className="mb-4">
                <div className="mb-2 border-b border-[var(--border)] pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{g.sec}</div>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map(([k, lbl]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={perms[k] !== false} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />{lbl}</label>
                  ))}
                </div>
              </div>
            ))}
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="mt-4 flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-3 py-2 text-sm" onClick={() => setPermFor(null)}>Cancel</button><button className="ui-btn ui-btn-primary px-4 py-2 text-sm font-medium" style={{ background: "var(--accent)", color: "#fff" }} onClick={async () => { if (await patch(permFor.id, { perms })) setPermFor(null); }}>Save Permissions</button></div>
          </div>
        </div>
      )}

      {/* DELETE */}
      {delRow && (
        <div className={ovl} onMouseDown={() => setDelRow(null)}>
          <div className={card + " w-[380px]"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between"><div className="font-semibold text-red-500">Delete Manager</div><button onClick={() => setDelRow(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button></div>
            <p className="mb-4 text-sm text-[var(--muted)]">Delete <span className="font-semibold text-[var(--text)]">{delRow.name}</span> ({delRow.email})? This cannot be undone.</p>
            {err && <div className="mb-2 text-xs text-red-500">{err}</div>}
            <div className="flex justify-end gap-2"><button className="ui-btn ui-btn-ghost px-4 py-2 text-sm" onClick={() => setDelRow(null)}>Cancel</button><button className="ui-btn px-4 py-2 text-sm font-medium text-white" style={{ background: "#dc2626" }} onClick={async () => { setErr(""); const r = await fetch("/api/admin/managers/" + delRow.id, { method: "DELETE" }).then((x) => x.json()); if (r.ok) { setDelRow(null); load(); } else setErr(r.error || "Delete failed"); }}>Delete</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
