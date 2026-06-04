"use client";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";

const PERM_GROUPS: { sec: string; items: [string, string][] }[] = [
  { sec: "Users", items: [["createClients", "Create Clients"], ["deleteClients", "Delete Clients"], ["manageManagers", "Manage Managers"]] },
  { sec: "Funds", items: [["processDeposits", "Process Deposits"], ["processWithdrawals", "Process Withdrawals"], ["creditBonus", "Credit / Bonus / Insurance"], ["transferFunds", "Transfer Funds"], ["editFinancial", "Edit Financial History"], ["deleteFinancial", "Delete Financial History"]] },
  { sec: "Trades", items: [["manualTrade", "Manual Trade Entry"], ["closeTrades", "Close Trades"], ["editTrades", "Edit Trade Records"], ["deleteTrades", "Delete Trades"]] },
  { sec: "Reports", items: [["viewAudit", "View Audit Log"], ["exportPdf", "Export PDF Reports"]] },
  { sec: "Communication", items: [["sendNotifications", "Send Notifications"]] },
];

const PLAN_LABELS: Record<string, string> = { STARTER: "Starter", PRO: "Pro", ENTERPRISE: "Enterprise" };

function subBadge(s: string) {
  if (s === "ACTIVE") return "sab sab-green";
  if (s === "TRIALING") return "sab sab-amber";
  return "sab sab-red";
}

export default function SATenantsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ plan: "STARTER", seats: 5, primaryColor: "#2563eb", accentColor: "#22c55e" });
  const [permFor, setPermFor] = useState<any>(null);
  const [perms, setPerms] = useState<any>({});
  const [subFor, setSubFor] = useState<any>(null);
  const [subForm, setSubForm] = useState<any>({});
  const [editFor, setEditFor] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const { confirm, prompt, node } = useDialog();

  async function load() {
    try {
      const d = await fetch("/api/superadmin/outsource").then((r) => r.json());
      if (d.ok) setRows(d.outsources);
    } catch (e) {}
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, action: string, extra: any) {
    setErr("");
    const r = await fetch("/api/superadmin/outsource/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }

  async function create() {
    setErr("");
    const r = await fetch("/api/platform/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, subdomain: (form.subdomain || "").toLowerCase(), seats: Number(form.seats) }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setCreateOpen(false);
    setForm({ plan: "STARTER", seats: 5, primaryColor: "#2563eb", accentColor: "#22c55e" });
    load();
  }

  function openEdit(t: any) {
    setEditForm({
      name: t.name || "", brandName: t.brandName || "", subdomain: t.subdomain || "",
      customDomain: t.customDomain || "", supportEmail: t.supportEmail || "",
      primaryColor: t.primaryColor || "#2563eb", accentColor: t.accentColor || "#22c55e",
    });
    setEditFor(t);
  }
  async function saveEdit() {
    if (!editFor) return;
    await act(editFor.id, "edit", editForm);
    setEditFor(null);
  }

  function openPerms(t: any) { setPermFor(t); setPerms(t.permissions || {}); }
  async function savePerms() {
    if (!permFor) return;
    await act(permFor.id, "perms", { perms });
    setPermFor(null);
  }

  function openSub(t: any) {
    setSubFor(t);
    setSubForm({
      plan: t.subscription?.plan || "STARTER",
      status: t.subscription?.status || "ACTIVE",
      seats: t.subscription?.seats ?? 5,
      endsAt: t.subscription?.endsAt ? String(t.subscription.endsAt).slice(0, 10) : "",
    });
  }
  async function saveSub() {
    if (!subFor) return;
    await act(subFor.id, "updateSub", {
      plan: subForm.plan,
      status: subForm.status,
      seats: Number(subForm.seats),
      endsAt: subForm.endsAt || null,
    });
    setSubFor(null);
  }

  const inp = "rounded-md border px-2 py-1.5 text-sm w-full";

  return (
    <div className="space-y-4">
      {node}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-sm text-gray-500">Manage tenants, subscription plans, and permissions</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white">
          + New Tenant
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="px-2 py-1 font-normal">Tenant</th>
              <th className="px-2 py-1 font-normal">Subdomain</th>
              <th className="px-2 py-1 font-normal">Status</th>
              <th className="px-2 py-1 font-normal">Plan</th>
              <th className="px-2 py-1 font-normal">Subscription</th>
              <th className="px-2 py-1 font-normal">Expires</th>
              <th className="px-2 py-1 font-normal text-right">Users / Accs</th>
              <th className="px-2 py-1 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: any) => (
              <tr key={t.id} className="border-t" style={{ borderColor: "#eef2f7" }}>
                <td className="px-2 py-2 font-medium">
                  {t.brandName || t.name}
                  <div className="text-xs text-gray-400">{t.name}</div>
                </td>
                <td className="px-2 py-2 text-blue-600">{t.subdomain}</td>
                <td className="px-2 py-2">
                  <span className={"sab " + (t.status === "ACTIVE" ? "sab-green" : "sab-red")}>{t.status}</span>
                </td>
                <td className="px-2 py-2">
                  <span className="font-medium">{t.subscription ? (PLAN_LABELS[t.subscription.plan] || t.subscription.plan) : "—"}</span>
                  {t.subscription && <div className="text-xs text-gray-400">{t.subscription.seats} seats</div>}
                </td>
                <td className="px-2 py-2">
                  {t.subscription
                    ? <span className={subBadge(t.subscription.status)}>{t.subscription.status}</span>
                    : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-2 py-2 text-xs">
                  {t.subscription?.endsAt
                    ? new Date(t.subscription.endsAt).toLocaleDateString()
                    : <span className="text-gray-400">No expiry</span>}
                </td>
                <td className="px-2 py-2 text-right">{t.users} / {t.accounts}</td>
                <td className="px-2 py-2 space-x-1 text-right whitespace-nowrap">
                  <button
                    title="Edit tenant info"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => openEdit(t)}
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                  <button
                    title="Permissions"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => openPerms(t)}
                  >
                    <i className="fa-solid fa-user-shield"></i>
                  </button>
                  <button
                    title="Subscription"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => openSub(t)}
                  >
                    <i className="fa-solid fa-credit-card"></i>
                  </button>
                  <button
                    title={t.status === "ACTIVE" ? "Suspend tenant" : "Activate tenant"}
                    className="mx-0.5 rounded px-2 py-1"
                    style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent2)" }}
                    onClick={() => act(t.id, t.status === "ACTIVE" ? "lock" : "open", {})}
                  >
                    <i className={"fa-solid " + (t.status === "ACTIVE" ? "fa-pause" : "fa-play")}></i>
                  </button>
                  <button
                    title="Reset admin password"
                    className="mx-0.5 rounded px-2 py-1"
                    style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)", color: "#b45309" }}
                    onClick={async () => { const p = await prompt({ title: "Reset admin password", message: "New password for " + (t.brandName || t.name) + " admin", password: true, placeholder: "New password", confirmLabel: "Reset" }); if (p) act(t.id, "resetPassword", { password: p }); }}
                  >
                    <i className="fa-solid fa-key"></i>
                  </button>
                  <button
                    title="Delete tenant"
                    className="mx-0.5 rounded px-2 py-1"
                    style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#b91c1c" }}
                    onClick={async () => { if (await confirm({ title: "Delete tenant", message: "Delete " + t.name + " and ALL its data? This cannot be undone.", danger: true })) act(t.id, "delete", {}); }}
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-2 py-4 text-gray-400" colSpan={8}>No tenants found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Tenant Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setCreateOpen(false)}>
          <div className="w-[480px] max-h-[90vh] overflow-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold">New Tenant</div>
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Company name *" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inp} placeholder="subdomain *" value={form.subdomain || ""} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="Brand name (shown on portal)" value={form.brandName || ""} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
              <input className={inp} placeholder="Admin name *" value={form.adminName || ""} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              <input className={inp} placeholder="Admin email *" value={form.adminEmail || ""} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              <input className={inp + " col-span-2"} type="password" placeholder="Admin password (min 6) *" value={form.adminPassword || ""} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Plan</label>
                <select className={inp} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                  <option value="STARTER">Starter</option>
                  <option value="PRO">Pro</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Seats</label>
                <input type="number" className={inp} min="1" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Primary Color</label>
                <input type="color" className="rounded-md border h-9 w-full cursor-pointer" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Accent Color</label>
                <input type="color" className="rounded-md border h-9 w-full cursor-pointer" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white" onClick={create}>Create Tenant</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Modal */}
      {subFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setSubFor(null)}>
          <div className="w-[360px] rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold">Subscription — {subFor.brandName || subFor.name}</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Plan</label>
                <select className={inp} value={subForm.plan} onChange={(e) => setSubForm({ ...subForm, plan: e.target.value })}>
                  <option value="STARTER">Starter</option>
                  <option value="PRO">Pro</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Subscription Status</label>
                <select className={inp} value={subForm.status} onChange={(e) => setSubForm({ ...subForm, status: e.target.value })}>
                  <option value="TRIALING">Trialing</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAST_DUE">Past Due</option>
                  <option value="CANCELED">Canceled</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Seats</label>
                <input type="number" className={inp} min="1" value={subForm.seats} onChange={(e) => setSubForm({ ...subForm, seats: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Expiry Date (leave blank = no expiry)</label>
                <input type="date" className={inp} value={subForm.endsAt} onChange={(e) => setSubForm({ ...subForm, endsAt: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setSubFor(null)}>Cancel</button>
              <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={saveSub}>Save Subscription</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tenant Modal */}
      {editFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setEditFor(null)}>
          <div className="w-[500px] max-h-[90vh] overflow-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold text-lg">Edit Tenant — {editFor.name}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Company Name *</label><input className={inp} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Brand Name</label><input className={inp} value={editForm.brandName} onChange={(e) => setEditForm({ ...editForm, brandName: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Subdomain *</label><input className={inp} value={editForm.subdomain} onChange={(e) => setEditForm({ ...editForm, subdomain: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Custom Domain</label><input className={inp} placeholder="e.g. portal.acme.com" value={editForm.customDomain} onChange={(e) => setEditForm({ ...editForm, customDomain: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Support Email</label><input className={inp} type="email" value={editForm.supportEmail} onChange={(e) => setEditForm({ ...editForm, supportEmail: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Primary Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /><input className={inp} value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /></div></div>
              <div><label className="text-xs text-gray-500 block mb-1">Accent Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /><input className={inp} value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /></div></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setEditFor(null)}>Cancel</button>
              <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {permFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setPermFor(null)}>
          <div className="max-h-[80vh] w-[520px] overflow-auto rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Tenant Permissions — {permFor.brandName || permFor.name}</div>
            <div className="mb-3 text-xs text-gray-500">If a permission is OFF, no one under this tenant can use it regardless of personal settings.</div>
            {PERM_GROUPS.map((g) => (
              <div key={g.sec} className="mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{g.sec}</div>
                <div className="grid grid-cols-2 gap-1">
                  {g.items.map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={perms[k] !== false} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setPermFor(null)}>Cancel</button>
              <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={savePerms}>Save Permissions</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
