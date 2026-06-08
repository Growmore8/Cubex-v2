"use client";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";
import PasswordInput from "@/components/ui/PasswordInput";
import { PACKAGES, PLAN_KEYS } from "@/config/packages";

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
  // Live package definitions (defaults merged with super-admin overrides) so the plan
  // dropdowns show the real account limit set in Packages & Pricing.
  const [pkgs, setPkgs] = useState<any>(PACKAGES);
  const seatsOf = (k: string) => Number(pkgs?.[k]?.seats) || PACKAGES[k as keyof typeof PACKAGES]?.seats || 5;
  const { confirm, prompt, node } = useDialog();

  async function load() {
    try {
      const d = await fetch("/api/superadmin/outsource").then((r) => r.json());
      if (d.ok) setRows(d.outsources);
    } catch (e) {}
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { fetch("/api/superadmin/packages").then((r) => r.json()).then((d) => { if (d.ok && d.packages) setPkgs(d.packages); }).catch(() => {}); }, []);

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
      body: JSON.stringify({ ...form, subdomain: (form.subdomain || "").toLowerCase() }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Create failed"); return; }
    setCreateOpen(false);
    setForm({ plan: "STARTER", seats: 5, primaryColor: "#2563eb", accentColor: "#22c55e" });
    load();
  }

  async function uploadLogo(file: File | null, which: "create" | "edit") {
    if (!file) return;
    setErr("");
    const fd = new FormData(); fd.set("file", file);
    const r = await fetch("/api/superadmin/tenants/logo", { method: "POST", body: fd });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Logo upload failed"); return; }
    if (which === "create") setForm((f: any) => ({ ...f, logoUrl: d.url })); else setEditForm((f: any) => ({ ...f, logoUrl: d.url }));
  }
  function LogoField({ value, which }: { value?: string; which: "create" | "edit" }) {
    return (
      <div className="flex items-center gap-3">
        {value ? <img src={value} alt="logo" className="h-12 w-12 rounded border object-contain bg-white" /> : <div className="flex h-12 w-12 items-center justify-center rounded border bg-gray-50 text-gray-300"><i className="fa-solid fa-image" /></div>}
        <div>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadLogo(e.target.files?.[0] || null, which)} className="text-xs" />
          {value && <button type="button" onClick={() => which === "create" ? setForm((f: any) => ({ ...f, logoUrl: "" })) : setEditForm((f: any) => ({ ...f, logoUrl: "" }))} className="ml-2 text-xs text-red-600">Remove</button>}
        </div>
      </div>
    );
  }

  function openEdit(t: any) {
    setEditForm({
      name: t.name || "", brandName: t.brandName || "", subdomain: t.subdomain || "",
      customDomain: t.customDomain || "", supportEmail: t.supportEmail || "",
      slogan: t.slogan || "", companyInfo: t.companyInfo || "", logoUrl: t.logoUrl || "",
      primaryColor: t.primaryColor || "#2563eb", accentColor: t.accentColor || "#22c55e",
      plan: t.subscription?.plan || "STARTER",
      smtpEmail: t.smtpEmail || "", smtpPassword: "", smtpHost: t.smtpHost || "",
      contactName: t.contactName || "", contactPhone: t.contactPhone || "",
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

  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm w-full";

  return (
    <div className="space-y-4 ui-fade-up">
      {node}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-sm text-gray-500">Manage tenants, subscription plans, and permissions</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="ui-btn px-4 py-2 text-sm text-white" style={{ background: "#d97706", borderColor: "transparent" }}>
          + New Tenant
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="ui-card bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="px-2 py-1 font-normal">Tenant</th>
              <th className="px-2 py-1 font-normal">Subdomain</th>
              <th className="px-2 py-1 font-normal">Status</th>
              <th className="px-2 py-1 font-normal">Plan</th>
              <th className="px-2 py-1 font-normal">Subscription</th>
              <th className="px-2 py-1 font-normal">Expires</th>
              <th className="px-2 py-1 font-normal text-center">Accounts</th>
              <th className="px-2 py-1 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: any) => (
              <tr key={t.id} className="ui-row border-t" style={{ borderColor: "var(--border)" }}>
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
                <td className="px-2 py-2 text-center">
                  <div className="flex flex-col gap-0.5 text-[11px]">
                    <span><span className="font-semibold text-green-700">{t.liveCnt ?? "?"}</span> <span className="text-gray-400">live</span> / <span className="font-semibold text-blue-600">{t.demoCnt ?? "?"}</span> <span className="text-gray-400">demo</span></span>
                    <span><span className="font-semibold text-purple-600">{t.managerCnt ?? "?"}</span> <span className="text-gray-400">mgr</span> · <span className="font-semibold text-gray-600">{t.groupCnt ?? "?"}</span> <span className="text-gray-400">grp</span></span>
                    <span className="text-[10px]" style={{ color: (t.seatsLeft ?? 99) <= 0 ? "#ef4444" : (t.seatsLeft ?? 99) <= 2 ? "#f59e0b" : "#6b7280" }}>
                      {t.seatsLeft ?? "?"} seat{t.seatsLeft !== 1 ? "s" : ""} left / {t.seatsLimit ?? "?"}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 space-x-1 text-right whitespace-nowrap">
                  <button
                    title="Edit tenant info"
                    className="ui-btn px-2 py-1 text-xs"
                    onClick={() => openEdit(t)}
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                  <button
                    title="Permissions"
                    className="ui-btn px-2 py-1 text-xs"
                    onClick={() => openPerms(t)}
                  >
                    <i className="fa-solid fa-user-shield"></i>
                  </button>
                  <button
                    title="Subscription"
                    className="ui-btn px-2 py-1 text-xs"
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
          <div className="ui-card ui-pop w-[480px] max-h-[90vh] overflow-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="font-semibold text-lg">New Tenant</div>
              <button onClick={() => setCreateOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            {/* Section: Tenant Identity */}
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Tenant Details</div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Company name *" autoComplete="off" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inp} placeholder="Brand name (portal)" autoComplete="off" value={form.brandName || ""} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
              <input className={inp} placeholder="Subdomain * — e.g. infinity" autoComplete="off" value={form.subdomain || ""} onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
              <input className={inp} placeholder="Custom domain (optional)" autoComplete="off" value={form.customDomain || ""} onChange={(e) => setForm({ ...form, customDomain: e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\s/g, "") })} />
              <input className={inp + " col-span-2"} placeholder="Slogan / Tagline" autoComplete="off" value={form.slogan || ""} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="Company / Brokerage Info (footer)" autoComplete="off" value={form.companyInfo || ""} onChange={(e) => setForm({ ...form, companyInfo: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="Contact email (private — not shown publicly)" autoComplete="off" value={form.supportEmail || ""} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
              <div className="col-span-2"><label className="text-xs text-gray-500 mb-1 block">Logo</label><LogoField value={form.logoUrl} which="create" /></div>
            </div>
            {/* Section: Admin Credentials */}
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin Account</div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Admin name *" autoComplete="off" value={form.adminName || ""} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              <input className={inp} placeholder="Admin email *" autoComplete="off" value={form.adminEmail || ""} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              <PasswordInput wrap="relative col-span-2" className={inp} placeholder="Admin password (min 6) *" autoComplete="new-password" value={form.adminPassword || ""} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
            </div>
            {/* Section: Tenant Contact (SuperAdmin only) */}
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Tenant Contact <span className="text-gray-300 normal-case font-normal">(SuperAdmin only — never shown publicly)</span></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Contact person" autoComplete="off" value={form.contactName || ""} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <input className={inp} placeholder="Contact phone (with country code, e.g. +94 77…)" autoComplete="off" value={form.contactPhone || ""} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
            </div>
            {/* Section: Email / SMTP */}
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Email Settings <span className="text-gray-300 normal-case font-normal">(for verification & password reset emails)</span></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="SMTP email (e.g. info@yourbrand.com)" autoComplete="off" type="email" value={form.smtpEmail || ""} onChange={(e) => setForm({ ...form, smtpEmail: e.target.value })} />
              <PasswordInput wrap="relative" className={inp} placeholder="Email / App password" autoComplete="new-password" value={form.smtpPassword || ""} onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="SMTP host (optional — e.g. mail.privateemail.com)" autoComplete="off" value={form.smtpHost || ""} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
              <p className="col-span-2 text-[10px] text-gray-400">Gmail/Outlook/Zoho auto-detected. For a custom-domain mailbox set the host (Namecheap Private Email = <b>mail.privateemail.com</b>). Gmail needs an App Password.</p>
            </div>
            {/* Section: Plan & Branding */}
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Plan & Branding</div>
            <div className="space-y-2">
              <div>
                <select className={inp} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                  {PLAN_KEYS.map((k) => <option key={k} value={k}>{pkgs[k]?.name || PACKAGES[k].name} — up to {seatsOf(k)} accounts (${pkgs[k]?.price ?? PACKAGES[k].price}/mo)</option>)}
                </select>
                <p className="mt-1 text-[11px] text-gray-400">The tenant can create up to <b>{seatsOf(form.plan || "STARTER")} accounts</b> on this plan. Manage plans in Packages &amp; Pricing.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Primary Color</label>
                  <input type="color" className="rounded-md border h-9 w-full cursor-pointer" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Accent Color</label>
                  <input type="color" className="rounded-md border h-9 w-full cursor-pointer" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
                </div>
              </div>
            </div>
            {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#d97706", borderColor: "transparent" }} onClick={create}>Create Tenant</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Modal */}
      {subFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setSubFor(null)}>
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold">Subscription — {subFor.brandName || subFor.name}</div>
              <button onClick={() => setSubFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Plan (sets the account limit)</label>
                <select className={inp} value={subForm.plan} onChange={(e) => setSubForm({ ...subForm, plan: e.target.value, seats: seatsOf(e.target.value) })}>
                  {PLAN_KEYS.map((k) => <option key={k} value={k}>{pkgs[k]?.name || PACKAGES[k].name} — up to {seatsOf(k)} accounts (${pkgs[k]?.price ?? PACKAGES[k].price}/mo)</option>)}
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
                <label className="text-xs text-gray-500 block mb-1">Account limit</label>
                <div className={inp + " bg-gray-50 text-gray-700"}>{seatsOf(subForm.plan || "STARTER")} accounts <span className="text-gray-400">(from {pkgs[subForm.plan || "STARTER"]?.name || PACKAGES[(subForm.plan || "STARTER") as keyof typeof PACKAGES]?.name} plan)</span></div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Expiry Date (leave blank = no expiry)</label>
                <input type="date" className={inp} value={subForm.endsAt} onChange={(e) => setSubForm({ ...subForm, endsAt: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setSubFor(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm" onClick={saveSub}>Save Subscription</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tenant Modal */}
      {editFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
          <div className="ui-card ui-pop w-[500px] max-h-[90vh] overflow-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold text-lg">Edit Tenant — {editFor.name}</div>
              <button onClick={() => setEditFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Company Name *</label><input className={inp} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Brand Name</label><input className={inp} value={editForm.brandName} onChange={(e) => setEditForm({ ...editForm, brandName: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Subdomain *</label><input className={inp} value={editForm.subdomain} onChange={(e) => setEditForm({ ...editForm, subdomain: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Custom Domain</label><input className={inp} placeholder="e.g. trade.acme.com" value={editForm.customDomain} onChange={(e) => setEditForm({ ...editForm, customDomain: e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\s/g, "") })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Plan (sets the account limit)</label><select className={inp} value={editForm.plan} onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}>{PLAN_KEYS.map((k) => <option key={k} value={k}>{pkgs[k]?.name || PACKAGES[k].name} — up to {seatsOf(k)} accounts (${pkgs[k]?.price ?? PACKAGES[k].price}/mo)</option>)}</select></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Contact Email <span className="text-gray-400">(private — not shown publicly)</span></label><input className={inp} type="email" value={editForm.supportEmail} onChange={(e) => setEditForm({ ...editForm, supportEmail: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Logo</label><LogoField value={editForm.logoUrl} which="edit" /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Slogan / Tagline</label><input className={inp} placeholder="Trade smarter" value={editForm.slogan} onChange={(e) => setEditForm({ ...editForm, slogan: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Company / Brokerage Info (footer)</label><input className={inp} placeholder="Acme Markets Ltd · Reg# 12345 · London" value={editForm.companyInfo} onChange={(e) => setEditForm({ ...editForm, companyInfo: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact Person <span className="text-gray-400">(private)</span></label><input className={inp} autoComplete="off" value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact Phone <span className="text-gray-400">(private)</span></label><input className={inp} autoComplete="off" value={editForm.contactPhone} onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })} /></div>
              <div className="col-span-2 border-t pt-3 mt-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Email Settings <span className="text-gray-300 normal-case font-normal">(verification & password reset)</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs text-gray-500 block mb-1">SMTP Email</label><input className={inp} type="email" autoComplete="off" placeholder="info@yourbrand.com" value={editForm.smtpEmail} onChange={(e) => setEditForm({ ...editForm, smtpEmail: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Email / App Password {editFor?.smtpEmail ? <span className="text-gray-400">(leave blank to keep current)</span> : null}</label><PasswordInput wrap="relative" className={inp} autoComplete="new-password" placeholder={editFor?.smtpEmail ? "Leave blank to keep" : "App password"} value={editForm.smtpPassword} onChange={(e) => setEditForm({ ...editForm, smtpPassword: e.target.value })} /></div>
                  <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">SMTP Host <span className="text-gray-400">(optional — custom domains, e.g. mail.privateemail.com)</span></label><input className={inp} autoComplete="off" placeholder="Blank = auto-detect from email domain" value={editForm.smtpHost} onChange={(e) => setEditForm({ ...editForm, smtpHost: e.target.value })} /></div>
                </div>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Primary Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /><input className={inp} value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /></div></div>
              <div><label className="text-xs text-gray-500 block mb-1">Accent Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /><input className={inp} value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /></div></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setEditFor(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {permFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onClick={() => setPermFor(null)}>
          <div className="ui-card ui-pop max-h-[80vh] w-[520px] overflow-auto bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold">Tenant Permissions — {permFor.brandName || permFor.name}</div>
              <button onClick={() => setPermFor(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"><i className="fa-solid fa-xmark text-sm" /></button>
            </div>
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
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setPermFor(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm" onClick={savePerms}>Save Permissions</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
