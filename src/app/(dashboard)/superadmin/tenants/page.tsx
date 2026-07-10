"use client";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";
import PasswordInput from "@/components/ui/PasswordInput";
import { PACKAGES, PLAN_KEYS } from "@/config/packages";

const FEATURE_FLAGS: { key: string; label: string; desc: string }[] = [
  { key: "copyTrading", label: "Copy Trading", desc: "Clients can subscribe to signal providers and auto-copy trades" },
  { key: "referral", label: "Referral Program", desc: "Clients can invite others and earn referral bonuses" },
  { key: "analytics", label: "Advanced Analytics", desc: "Show detailed trading analytics and performance reports to clients" },
  { key: "news", label: "Market News Feed", desc: "Show live market news in the client trading panel" },
  { key: "economic", label: "Economic Calendar", desc: "Show the economic events calendar in the client panel" },
];

const PERM_GROUPS: { sec: string; items: [string, string][] }[] = [
  { sec: "Users", items: [["createClients", "Create Clients"], ["deleteClients", "Delete Clients"], ["manageManagers", "Manage Managers"]] },
  { sec: "Funds", items: [["processDeposits", "Process Deposits"], ["processWithdrawals", "Process Withdrawals"], ["creditBonus", "Credit / Bonus / Insurance"], ["transferFunds", "Transfer Funds"], ["editFinancial", "Edit Financial History"], ["deleteFinancial", "Delete Financial History"]] },
  { sec: "Trades", items: [["manualTrade", "Manual Trade Entry"], ["closeTrades", "Close Trades"], ["editTrades", "Edit Trade Records"], ["deleteTrades", "Delete Trades"]] },
  { sec: "Reports", items: [["viewAudit", "View Audit Log"], ["exportPdf", "Export PDF Reports"]] },
  { sec: "Communication", items: [["sendNotifications", "Send Notifications"]] },
  { sec: "Spread", items: [["editSpread", "Edit Spread Settings (symbol / group / account markup)"]] },
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
  const [feats, setFeats] = useState<any>({});
  const [subFor, setSubFor] = useState<any>(null);
  const [subForm, setSubForm] = useState<any>({});
  const [editFor, setEditFor] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [smtpTest, setSmtpTest] = useState<string>("");
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
    if (!form.name?.trim()) { setErr("Company name is required"); return; }
    if (!form.subdomain?.trim()) { setErr("Subdomain is required"); return; }
    if (!form.adminName?.trim()) { setErr("Admin name is required"); return; }
    if (!form.adminEmail?.trim()) { setErr("Admin email is required"); return; }
    if (!form.adminPassword?.trim()) { setErr("Admin password is required"); return; }
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
      customDomain: t.customDomain || "", websiteUrl: t.websiteUrl || "", supportEmail: t.supportEmail || "",
      slogan: t.slogan || "", companyInfo: t.companyInfo || "", logoUrl: t.logoUrl || "",
      primaryColor: t.primaryColor || "#2563eb", accentColor: t.accentColor || "#22c55e",
      plan: t.subscription?.plan || "STARTER",
      smtpEmail: t.smtpEmail || "", smtpPassword: "", smtpHost: t.smtpHost || "",
      contactName: t.contactName || "", contactPhone: t.contactPhone || "",
      allowRegistration: t.allowRegistration !== false,
      swapEnabled: !!t.swapEnabled,
      features: (t.features as Record<string, boolean>) || {},
    });
    setSmtpTest("");
    setEditFor(t);
  }
  async function saveEdit() {
    if (!editFor) return;
    await act(editFor.id, "edit", editForm);
    setEditFor(null);
  }
  async function testSmtp() {
    if (!editFor) return;
    const to = window.prompt("Send a test email to (leave blank to just check the SMTP login):", editFor.supportEmail || "");
    if (to === null) return; // cancelled
    setSmtpTest("Testing…");
    const r = await fetch("/api/superadmin/smtp-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: editFor.id, to: to.trim() }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Request failed" }));
    setSmtpTest(r.ok ? (r.sent ? `✓ Sent to ${r.sent} (host ${r.host})` : `✓ Login OK (host ${r.host})`) : `✗ ${r.error}`);
  }

  function openPerms(t: any) { setPermFor(t); setPerms(t.permissions || {}); setFeats(t.features || {}); }
  async function savePerms() {
    if (!permFor) return;
    await act(permFor.id, "perms", { perms });
    await act(permFor.id, "edit", { features: feats });
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
  // Demo (trial) tenants: lock the paid-only settings (SMTP, custom domain).
  const isTrial = (editFor as any)?.subscription?.status === "TRIALING";
  const lockHint = <span className="ml-1 text-[10px] font-semibold text-amber-500">🔒 paid only</span>;
  const [q, setQ] = useState("");

  const filteredRows = q.trim()
    ? rows.filter((t: any) => {
        const s = q.toLowerCase();
        return (t.name || "").toLowerCase().includes(s) || (t.brandName || "").toLowerCase().includes(s);
      })
    : rows;

  return (
    <div className="space-y-4 ui-fade-up">
      {node}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-sm text-gray-500">Manage tenants, subscription plans, and permissions</p>
        </div>
        <button onClick={() => { setErr(""); setCreateOpen(true); }} className="ui-btn px-4 py-2 text-sm text-white" style={{ background: "#d97706", borderColor: "transparent" }}>
          + New Tenant
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="ui-card bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input
              className="ui-input rounded border pl-7 pr-3 py-1.5 text-sm w-full"
              placeholder="Search tenants…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q && (
            <span className="text-xs text-gray-400">{filteredRows.length} of {rows.length}</span>
          )}
        </div>
        {(() => {
          const broken = rows.filter((t: any) => !t.smtpConfigured);
          if (!broken.length) return null;
          return (
            <div className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" style={{ background: "rgba(220,38,38,0.07)", borderColor: "rgba(220,38,38,0.3)", color: "#b91c1c" }}>
              <i className="fa-solid fa-triangle-exclamation mt-0.5" />
              <div>
                <b>{broken.length}</b> tenant{broken.length === 1 ? "" : "s"} have <b>no SMTP configured</b> — client registration, password reset and statement emails are disabled for them.
                <div className="mt-0.5 text-xs" style={{ color: "#dc2626" }}>{broken.map((t: any) => t.brandName || t.name).join(", ")}</div>
              </div>
            </div>
          );
        })()}
        <table className="sa-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Subdomain</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Subscription</th>
              <th>Expires</th>
              <th className="text-center">Accounts</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((t: any) => (
              <tr key={t.id} className="ui-row">
                <td className="px-2 py-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {t.brandName || t.name}
                    {!t.smtpConfigured && (
                      <button type="button" onClick={() => openEdit(t)} title="SMTP not configured — client registration, password reset and statement emails are disabled. Click to set it up." className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.35)" }}>
                        <i className="fa-solid fa-triangle-exclamation" /> SMTP
                      </button>
                    )}
                  </span>
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
            {filteredRows.length === 0 && (
              <tr><td className="px-2 py-4 text-gray-400" colSpan={8}>{q ? "No tenants match your search." : "No tenants found."}</td></tr>
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
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Tenant Details</div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Company name *" autoComplete="off" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inp} placeholder="Brand name (portal)" autoComplete="off" value={form.brandName || ""} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
              <input className={inp} placeholder="Subdomain * — e.g. infinity" autoComplete="off" value={form.subdomain || ""} onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
              <input className={inp} placeholder="Custom domain (optional)" autoComplete="off" value={form.customDomain || ""} onChange={(e) => setForm({ ...form, customDomain: e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\s/g, "") })} />
              <input className={inp + " col-span-2"} placeholder="Slogan / Tagline" autoComplete="off" value={form.slogan || ""} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="Company / Brokerage Info (footer)" autoComplete="off" value={form.companyInfo || ""} onChange={(e) => setForm({ ...form, companyInfo: e.target.value })} />
              <div className="col-span-2"><label className="text-xs text-gray-500 mb-1 block">Logo</label><LogoField value={form.logoUrl} which="create" /></div>
            </div>
            {/* Section: Admin Credentials */}
            <div className="mb-2 mt-4 border-t border-gray-200 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin Account</div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Admin name *" autoComplete="off" value={form.adminName || ""} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              <input className={inp} placeholder="Admin email *" autoComplete="off" value={form.adminEmail || ""} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              <PasswordInput wrap="relative col-span-2" className={inp} placeholder="Admin password (min 6) *" autoComplete="new-password" value={form.adminPassword || ""} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
            </div>
            {/* Section: Tenant Contact (SuperAdmin only) — invoices/billing go to the contact email */}
            <div className="mb-2 mt-4 border-t border-gray-200 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Tenant Contact <span className="text-gray-300 normal-case font-normal">(SuperAdmin only — invoices &amp; billing go here)</span></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp + " col-span-2"} placeholder="Contact email (invoices & billing)" autoComplete="off" value={form.supportEmail || ""} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
              <input className={inp} placeholder="Contact person" autoComplete="off" value={form.contactName || ""} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <input className={inp} placeholder="Contact phone (with country code, e.g. +94 77…)" autoComplete="off" value={form.contactPhone || ""} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
            </div>
            {/* Section: Email / SMTP */}
            <div className="mb-2 mt-4 border-t border-gray-200 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Email Settings <span className="text-gray-300 normal-case font-normal">(for verification & password reset emails)</span></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="SMTP email (e.g. info@yourbrand.com)" autoComplete="off" type="email" value={form.smtpEmail || ""} onChange={(e) => setForm({ ...form, smtpEmail: e.target.value })} />
              <PasswordInput wrap="relative" className={inp} placeholder="Email / App password" autoComplete="new-password" value={form.smtpPassword || ""} onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })} />
              <input className={inp + " col-span-2"} placeholder="SMTP host (optional — e.g. mail.privateemail.com)" autoComplete="off" value={form.smtpHost || ""} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
              <p className="col-span-2 text-[10px] text-gray-400">Gmail/Outlook/Zoho auto-detected. For a custom-domain mailbox set the host (Namecheap Private Email = <b>mail.privateemail.com</b>). Gmail needs an App Password.</p>
            </div>
            {/* Section: Plan & Branding */}
            <div className="mb-2 mt-4 border-t border-gray-200 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Plan & Branding</div>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
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
            {/* Quick trial actions */}
            <div className="mt-3 flex flex-wrap gap-2">
              {[7, 14, 30].map((d) => (
                <button key={d} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "#cbd5e1" }}
                  onClick={() => { const end = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10); setSubForm({ ...subForm, status: "TRIALING", endsAt: end }); }}>
                  Start {d}-day trial
                </button>
              ))}
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "#16a34a", color: "#16a34a" }}
                onClick={() => setSubForm({ ...subForm, status: "ACTIVE", endsAt: "" })}>
                Convert to paid (no expiry)
              </button>
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
              <div><label className="text-xs text-gray-500 block mb-1">Custom Domain{isTrial && lockHint}</label><input className={inp + (isTrial ? " opacity-50 cursor-not-allowed" : "")} disabled={isTrial} placeholder={isTrial ? "Available after converting to paid" : "e.g. trade.acme.com"} value={editForm.customDomain} onChange={(e) => setEditForm({ ...editForm, customDomain: e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\s/g, "") })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Website URL <span className="text-gray-400">(for the "Back to website" link — blank = use the domain)</span></label><input className={inp} placeholder="https://acme.com" value={editForm.websiteUrl} onChange={(e) => setEditForm({ ...editForm, websiteUrl: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Plan (sets the account limit)</label><select className={inp} value={editForm.plan} onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}>{PLAN_KEYS.map((k) => <option key={k} value={k}>{pkgs[k]?.name || PACKAGES[k].name} — up to {seatsOf(k)} accounts (${pkgs[k]?.price ?? PACKAGES[k].price}/mo)</option>)}</select></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Contact Email <span className="text-gray-400">(invoices &amp; billing — private)</span></label><input className={inp} type="email" value={editForm.supportEmail} onChange={(e) => setEditForm({ ...editForm, supportEmail: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Logo</label><LogoField value={editForm.logoUrl} which="edit" /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Slogan / Tagline</label><input className={inp} placeholder="Trade smarter" value={editForm.slogan} onChange={(e) => setEditForm({ ...editForm, slogan: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Company / Brokerage Info (footer)</label><input className={inp} placeholder="Acme Markets Ltd · Reg# 12345 · London" value={editForm.companyInfo} onChange={(e) => setEditForm({ ...editForm, companyInfo: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact Person <span className="text-gray-400">(private)</span></label><input className={inp} autoComplete="off" value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact Phone <span className="text-gray-400">(private)</span></label><input className={inp} autoComplete="off" value={editForm.contactPhone} onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })} /></div>
              <div className="col-span-2 border-t pt-3 mt-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Email Settings <span className="text-gray-300 normal-case font-normal">(verification & password reset)</span>{isTrial && lockHint}</div>
                {isTrial && <div className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: "color-mix(in srgb, var(--amber, #d97706) 12%, transparent)", color: "#b45309" }}>SMTP is locked for demo tenants — it unlocks when you convert this tenant to paid.</div>}
                <div className={"grid grid-cols-2 gap-2" + (isTrial ? " opacity-50 pointer-events-none" : "")}>
                  <div><label className="text-xs text-gray-500 block mb-1">SMTP Email</label><input className={inp} type="email" autoComplete="off" disabled={isTrial} placeholder="info@yourbrand.com" value={editForm.smtpEmail} onChange={(e) => setEditForm({ ...editForm, smtpEmail: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Email / App Password {editFor?.smtpEmail ? <span className="text-gray-400">(leave blank to keep current)</span> : null}</label><PasswordInput wrap="relative" className={inp} autoComplete="new-password" disabled={isTrial} placeholder={editFor?.smtpEmail ? "Leave blank to keep" : "App password"} value={editForm.smtpPassword} onChange={(e) => setEditForm({ ...editForm, smtpPassword: e.target.value })} /></div>
                  <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">SMTP Host <span className="text-gray-400">(optional — custom domains, e.g. mail.privateemail.com)</span></label><input className={inp} autoComplete="off" disabled={isTrial} placeholder="Blank = auto-detect from email domain" value={editForm.smtpHost} onChange={(e) => setEditForm({ ...editForm, smtpHost: e.target.value })} /></div>
                  <div className="col-span-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={testSmtp} disabled={isTrial} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "#cbd5e1" }}><i className="fa-solid fa-paper-plane mr-1" />Test SMTP</button>
                    <span className="text-[11px] text-gray-400">Tests the <b>saved</b> settings — save first if you changed them.</span>
                    {smtpTest && <span className="text-xs font-medium" style={{ color: smtpTest.startsWith("✓") ? "#16a34a" : smtpTest.startsWith("✗") ? "#dc2626" : "#64748b" }}>{smtpTest}</span>}
                  </div>
                </div>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Primary Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /><input className={inp} value={editForm.primaryColor} onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })} /></div></div>
              <div><label className="text-xs text-gray-500 block mb-1">Accent Color</label><div className="flex gap-2"><input type="color" className="rounded border h-9 w-12 cursor-pointer" value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /><input className={inp} value={editForm.accentColor} onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })} /></div></div>
              {isTrial ? (
                <div className="col-span-2 mt-1 flex items-center gap-2 text-sm text-gray-500 select-none">
                  <input type="checkbox" className="h-4 w-4 opacity-40 cursor-not-allowed" checked={false} readOnly disabled />
                  <span>Allow client self-registration <span className="text-yellow-500 text-xs ml-1">🔒 blocked on demo — unlocks on convert to paid</span></span>
                </div>
              ) : (
                <>
                  <label className="col-span-2 mt-1 flex cursor-pointer select-none items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={editForm.allowRegistration !== false} onChange={(e) => setEditForm({ ...editForm, allowRegistration: e.target.checked })} />
                    <span>Allow client self-registration <span className="text-gray-400">(shows the Open Account / Register link on this tenant's login)</span></span>
                  </label>
                  <label className="col-span-2 mt-2 flex cursor-pointer select-none items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={!!(editForm as any).swapEnabled} onChange={(e) => setEditForm({ ...editForm, swapEnabled: e.target.checked } as any)} />
                    <span>Enable overnight swap charges <span className="text-gray-400">(tenant admin configures rates per symbol; Islamic accounts are exempt)</span></span>
                  </label>
                </>
              )}
              {/* ── Feature Flags ── */}
              <div className="col-span-2 mt-4 border-t border-gray-200 pt-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Feature Flags</div>
                <div className="text-[11px] text-gray-400 mb-2">Enable or disable platform features for this tenant. Disabled features are completely hidden from all users.</div>
                <div className="grid grid-cols-1 gap-1.5">
                  {FEATURE_FLAGS.map(({ key, label, desc }) => (
                    <label key={key} className="flex cursor-pointer select-none items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 flex-shrink-0"
                        checked={!!((editForm as any).features?.[key])}
                        onChange={(e) => setEditForm({ ...editForm, features: { ...((editForm as any).features || {}), [key]: e.target.checked } } as any)}
                      />
                      <span>
                        <span className="font-medium">{label}</span>
                        <span className="ml-1.5 text-gray-400 text-[11px]">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
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
            <div className="mb-3 border-t border-gray-200 pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Feature Flags</div>
              <div className="text-xs text-gray-400 mb-2">Disabled features are completely hidden from all users under this tenant.</div>
              <div className="grid grid-cols-1 gap-1">
                {FEATURE_FLAGS.map(({ key, label, desc }) => (
                  <label key={key} className="flex cursor-pointer select-none items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 flex-shrink-0" checked={!!feats[key]} onChange={(e) => setFeats({ ...feats, [key]: e.target.checked })} />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="ml-1.5 text-gray-400 text-[11px]">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
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
