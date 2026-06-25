"use client";
import { useEffect, useRef, useState } from "react";
import { PACKAGES, PLAN_KEYS } from "@/config/packages";
import { useDialog } from "@/components/ui/ConfirmDialog";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_APP_NAME || "OrbitFxSolution";

const STATUS_LABEL: Record<string, string> = { PENDING: "UNPAID", PAID: "PAID", OVERDUE: "OVERDUE", CANCELLED: "CANCELLED" };
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  PENDING: { bg: "#fef3c7", color: "#92400e" },
  PAID: { bg: "#dcfce7", color: "#15803d" },
  OVERDUE: { bg: "#fee2e2", color: "#b91c1c" },
  CANCELLED: { bg: "#f1f5f9", color: "#64748b" },
};

function fmt(n: number) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SABillingPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [filterTenant, setFilterTenant] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [printInv, setPrintInv] = useState<any>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // Email dialog state
  const [emailInv, setEmailInv] = useState<any>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  const { confirm, node } = useDialog();

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [gf, setGf] = useState<any>({
    tenantId: "", period: defaultPeriod, plan: "STARTER",
    amount: PACKAGES.STARTER.price, dueAt: "", notes: "",
  });

  async function load() {
    try {
      const qs = new URLSearchParams();
      if (filterTenant) qs.set("tenantId", filterTenant);
      if (filterStatus) qs.set("status", filterStatus);
      const [id, td] = await Promise.all([
        fetch("/api/superadmin/billing?" + qs.toString()).then((r) => r.json()),
        fetch("/api/superadmin/outsource").then((r) => r.json()),
      ]);
      if (id.ok) setInvoices(id.invoices);
      if (td.ok) setTenants(td.outsources || []);
    } catch {}
  }
  useEffect(() => { load(); }, [filterTenant, filterStatus]);

  // When tenant changes in generate form, auto-fill plan + amount from their subscription
  function onTenantChange(tenantId: string) {
    const t = tenants.find((x: any) => x.id === tenantId);
    const plan = t?.subscription?.plan || "STARTER";
    const amount = PACKAGES[plan as keyof typeof PACKAGES]?.price || PACKAGES.STARTER.price;
    setGf((f: any) => ({ ...f, tenantId, plan, amount }));
  }

  async function generate() {
    setErr("");
    if (!gf.tenantId) { setErr("Select a tenant"); return; }
    const r = await fetch("/api/superadmin/billing", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...gf, amount: Number(gf.amount) }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setGenOpen(false);
    setGf({ tenantId: "", period: defaultPeriod, plan: "STARTER", amount: PACKAGES.STARTER.price, dueAt: "", notes: "" });
    load();
  }

  async function act(id: string, action: string) {
    setErr("");
    const r = await fetch("/api/superadmin/billing/" + id, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }

  function openEmailDialog(inv: any) {
    setEmailInv(inv);
    setEmailTo(inv.tenant?.supportEmail || "");
    setEmailSent(false);
    setEmailErr("");
    setEmailSending(false);
  }

  async function sendEmail() {
    if (!emailTo.trim()) { setEmailErr("Enter an email address"); return; }
    setEmailSending(true);
    setEmailErr("");
    const r = await fetch("/api/superadmin/billing/" + emailInv.id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", overrideTo: emailTo.trim() }),
    }).then((x) => x.json()).catch(() => ({ ok: false }));
    setEmailSending(false);
    if (!r.ok) { setEmailErr(r.error || "Failed to send"); return; }
    setEmailSent(true);
  }

  function printInvoice() {
    const el = printRef.current;
    if (!el) return;
    const w = window.open("", "_blank", "width=794,height=1123");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoice ${printInv?.number}</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{size:A4;margin:0}
      .page{width:794px;min-height:1123px;padding:60px 72px;background:#fff}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding:8px 10px}
      td{padding:10px;border-bottom:1px solid #f3f4f6;font-size:13px}
      .total-row td{border-top:2px solid #e5e7eb;border-bottom:none;padding-top:14px}
      .stamp{display:inline-block;border:3px solid #16a34a;color:#16a34a;font-size:22px;font-weight:800;letter-spacing:.1em;padding:6px 20px;border-radius:6px;transform:rotate(-12deg);opacity:.85}
    </style></head><body><div class="page">${el.innerHTML}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }

  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm w-full";
  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-5 ui-fade-up">
      {node}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing & Invoicing</h1>
          <p className="text-sm text-gray-500">Generate and manage tenant invoices</p>
        </div>
        <button onClick={() => setGenOpen(true)} className="ui-btn px-4 py-2 text-sm text-white" style={{ background: "#d97706", borderColor: "transparent" }}>
          <i className="fa-solid fa-file-invoice mr-2" />Generate Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 ui-fade-up-stagger">
        {[
          { label: "Pending", value: fmt(totalPending), count: invoices.filter((i) => i.status === "PENDING").length, color: "#b45309", bg: "#fef3c7" },
          { label: "Paid", value: fmt(totalPaid), count: invoices.filter((i) => i.status === "PAID").length, color: "#15803d", bg: "#dcfce7" },
          { label: "Overdue", value: fmt(totalOverdue), count: invoices.filter((i) => i.status === "OVERDUE").length, color: "#dc2626", bg: "#fee2e2" },
        ].map(({ label, value, count, color, bg }) => (
          <div key={label} className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
            <div className="text-xs font-semibold text-gray-500 mb-1">{label.toUpperCase()}</div>
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{count} invoice{count !== 1 ? "s" : ""}</div>
          </div>
        ))}
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      {/* Invoice table */}
      <div className="ui-card bg-white" style={{ borderColor: "#e2e8f0" }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: "#e2e8f0" }}>
          <span className="font-semibold text-sm">Invoices</span>
          <div className="ml-auto flex gap-2">
            <select className="ui-input rounded border px-2 py-1.5 text-sm" value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)} style={{ borderColor: "#cbd5e1" }}>
              <option value="">All Tenants</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
            </select>
            <select className="ui-input rounded border px-2 py-1.5 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ borderColor: "#cbd5e1" }}>
              <option value="">All Status</option>
              {["PENDING","PAID","OVERDUE","CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="sa-table">
            <thead>
              <tr className="text-left">
                {["Invoice #","Tenant","Period","Plan","Amount","Status","Due Date","Paid Date","Actions"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const ss = STATUS_STYLE[inv.status] || STATUS_STYLE.PENDING;
                const isPaid = inv.status === "PAID";
                return (
                <tr key={inv.id} style={isPaid ? { opacity: 0.75 } : undefined}>
                  <td className="font-mono text-xs font-medium text-blue-600">{inv.number}</td>
                  <td className="font-medium">{inv.tenant?.brandName || inv.tenant?.name || "—"}{inv.tenant?.supportEmail && <div className="text-[10px] font-normal text-gray-400">{inv.tenant.supportEmail}</div>}</td>
                  <td className="text-gray-600">{inv.period}</td>
                  <td>
                    <span className="font-medium" style={{ color: PACKAGES[inv.plan as keyof typeof PACKAGES]?.color || "#666" }}>
                      {PACKAGES[inv.plan as keyof typeof PACKAGES]?.name || inv.plan}
                    </span>
                  </td>
                  <td className="font-semibold">{fmt(Number(inv.amount))}</td>
                  <td>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: ss.bg, color: ss.color }}>
                      {STATUS_LABEL[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className="text-xs" style={{ color: inv.status === "OVERDUE" ? "#b91c1c" : "#6b7280", fontWeight: inv.status === "OVERDUE" ? 600 : 400 }}>{new Date(inv.dueAt).toLocaleDateString()}</td>
                  <td className="text-xs text-green-600 font-medium">{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "—"}</td>
                  <td className="whitespace-nowrap">
                    {(inv.status === "PENDING" || inv.status === "OVERDUE") && (
                      <button onClick={() => act(inv.id, "markPaid")} title="Mark as Paid" className="mr-1 rounded px-2 py-1 text-xs font-semibold" style={{ background: "#dcfce7", color: "#15803d" }}>
                        <i className="fa-solid fa-check mr-1" />Paid
                      </button>
                    )}
                    {(inv.status === "PENDING" || inv.status === "OVERDUE") && (
                      <button onClick={() => act(inv.id, "markOverdue")} title="Suspend tenant" className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#fee2e2", color: "#dc2626" }}>
                        Suspend
                      </button>
                    )}
                    {(inv.status === "PAID" || inv.status === "OVERDUE") && (
                      <button onClick={() => act(inv.id, "markPending")} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#fef3c7", color: "#b45309" }}>
                        Reset
                      </button>
                    )}
                    <button onClick={() => openEmailDialog(inv)} title="Send invoice by email" className="mr-1 rounded px-2 py-1 text-xs gap-1 inline-flex items-center" style={{ background: "#dbeafe", color: "#2563eb" }}>
                      <i className="fa-solid fa-envelope text-xs" /><span>Email</span>
                    </button>
                    <button onClick={() => setPrintInv(inv)} title="Download / Print PDF" className="mr-1 rounded px-2 py-1 text-xs gap-1 inline-flex items-center" style={{ background: "#f1f5f9", color: "#475569" }}>
                      <i className="fa-solid fa-download text-xs" /><span>PDF</span>
                    </button>
                    <button onClick={async () => { if (await confirm({ title: "Delete invoice", message: "Delete invoice " + inv.number + "?", danger: true })) act(inv.id, "delete"); }} className="rounded px-2 py-1 text-xs" style={{ background: "#fff1f2", color: "#dc2626" }}>
                      <i className="fa-solid fa-trash text-xs" />
                    </button>
                  </td>
                </tr>
                );
              })}
              {invoices.length === 0 && <tr><td className="text-center text-gray-400 py-8" colSpan={9}>No invoices found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Invoice Modal */}
      {genOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="ui-card ui-pop w-[500px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-lg font-semibold">Generate Invoice</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">TENANT</label>
                <select className={inp} value={gf.tenantId} onChange={(e) => onTenantChange(e.target.value)}>
                  <option value="">Select tenant…</option>
                  {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PERIOD (YYYY-MM)</label>
                  <input className={inp} type="month" value={gf.period} onChange={(e) => setGf((f: any) => ({ ...f, period: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PLAN</label>
                  <select className={inp} value={gf.plan} onChange={(e) => setGf((f: any) => ({ ...f, plan: e.target.value, amount: PACKAGES[e.target.value as keyof typeof PACKAGES]?.price || f.amount }))}>
                    {PLAN_KEYS.map((k) => <option key={k} value={k}>{PACKAGES[k].name} — ${PACKAGES[k].price}/mo</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">AMOUNT ($)</label>
                  <input className={inp} type="number" value={gf.amount} onChange={(e) => setGf((f: any) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">DUE DATE</label>
                  <input className={inp} type="date" value={gf.dueAt} onChange={(e) => setGf((f: any) => ({ ...f, dueAt: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">NOTES (optional)</label>
                <textarea className={inp} rows={2} value={gf.notes} onChange={(e) => setGf((f: any) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn px-4 py-2 text-sm" onClick={() => setGenOpen(false)}>Cancel</button>
              <button className="ui-btn px-4 py-2 text-sm text-white" style={{ background: "#d97706", borderColor: "transparent" }} onClick={generate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Email Dialog */}
      {emailInv && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="ui-card ui-pop w-[440px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            {emailSent ? (
              <div className="text-center py-4">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "#dcfce7" }}>
                  <i className="fa-solid fa-circle-check text-2xl" style={{ color: "#16a34a" }} />
                </div>
                <div className="text-lg font-semibold text-gray-800 mb-1">Email Sent Successfully</div>
                <div className="text-sm text-gray-500 mb-4">Invoice <span className="font-mono font-medium">{emailInv.number}</span> was emailed to <span className="font-medium">{emailTo}</span></div>
                <button onClick={() => setEmailInv(null)} className="ui-btn px-6 py-2 text-sm text-white" style={{ background: "#16a34a", borderColor: "transparent" }}>Done</button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="font-semibold text-gray-800">Send Invoice by Email</div>
                  <button onClick={() => setEmailInv(null)} className="text-gray-400 hover:text-gray-600"><i className="fa-solid fa-xmark" /></button>
                </div>
                <div className="mb-3 rounded-lg p-3 text-sm" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div className="text-xs text-gray-400 mb-0.5">Invoice</div>
                  <div className="font-mono font-medium text-gray-700">{emailInv.number}</div>
                  <div className="text-xs text-gray-500 mt-1">{emailInv.tenant?.brandName || emailInv.tenant?.name} · {emailInv.period} · {fmt(Number(emailInv.amount))}</div>
                </div>
                <div className="mb-1">
                  <label className="text-xs font-medium text-gray-500 block mb-1">SEND TO</label>
                  <input
                    className={inp}
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="email@example.com"
                    autoFocus
                  />
                  {emailInv.tenant?.supportEmail && emailTo !== emailInv.tenant.supportEmail && (
                    <button onClick={() => setEmailTo(emailInv.tenant.supportEmail)} className="mt-1 text-xs" style={{ color: "#2563eb" }}>
                      Use contact email: {emailInv.tenant.supportEmail}
                    </button>
                  )}
                </div>
                {emailErr && <div className="mt-2 text-sm text-red-600">{emailErr}</div>}
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setEmailInv(null)} className="ui-btn px-4 py-2 text-sm">Cancel</button>
                  <button onClick={sendEmail} disabled={emailSending} className="ui-btn px-5 py-2 text-sm text-white inline-flex items-center gap-2 disabled:opacity-60" style={{ background: "#2563eb", borderColor: "transparent" }}>
                    {emailSending ? <><i className="fa-solid fa-spinner fa-spin text-xs" />Sending…</> : <><i className="fa-solid fa-paper-plane text-xs" />Send Email</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PDF Invoice Preview */}
      {printInv && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={() => setPrintInv(null)}>
          <div className="flex flex-col" style={{ maxHeight: "95vh" }} onClick={(e) => e.stopPropagation()}>
            {/* Toolbar */}
            <div className="flex items-center justify-between rounded-t-xl px-4 py-2.5" style={{ background: "#1e293b" }}>
              <span className="text-sm font-medium text-white">{printInv.number}</span>
              <div className="flex gap-2">
                <button onClick={printInvoice} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "#2563eb" }}>
                  <i className="fa-solid fa-download text-xs" />Download PDF
                </button>
                <button onClick={() => setPrintInv(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:text-white" style={{ background: "#334155" }}>
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>

            {/* A4 white invoice */}
            <div className="overflow-auto rounded-b-xl" style={{ background: "#94a3b8" }}>
              <div className="p-6">
                {/* This div is what gets printed */}
                <div ref={printRef} style={{ width: 595, minHeight: 842, background: "#fff", color: "#111827", fontFamily: "system-ui,-apple-system,sans-serif", padding: "56px 60px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 40 }}>
                    <div>
                      <div style={{ fontSize: 32, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>INVOICE</div>
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4, fontFamily: "monospace" }}>{printInv.number}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{PLATFORM_NAME}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Finance Department</div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 2, background: "#e5e7eb", marginBottom: 32 }} />

                  {/* Billed To + Invoice Details */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Billed To</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{printInv.tenant?.brandName || printInv.tenant?.name}</div>
                      {printInv.tenant?.supportEmail && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{printInv.tenant.supportEmail}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Invoice Details</div>
                      <div style={{ fontSize: 13, color: "#374151" }}>Period: <strong>{printInv.period}</strong></div>
                      <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>Due Date: <strong>{new Date(printInv.dueAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>
                        Status: <strong style={{ color: STATUS_STYLE[printInv.status]?.color }}>{STATUS_LABEL[printInv.status] || printInv.status}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Line items table */}
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        <th style={{ textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 10px" }}>Description</th>
                        <th style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 10px" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "14px 10px", borderBottom: "1px solid #f3f4f6" }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{PACKAGES[printInv.plan as keyof typeof PACKAGES]?.name || printInv.plan} Plan — Monthly Subscription</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>Billing period: {printInv.period}</div>
                          {printInv.notes && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{printInv.notes}</div>}
                        </td>
                        <td style={{ padding: "14px 10px", textAlign: "right", fontSize: 14, fontWeight: 600, color: "#111827", borderBottom: "1px solid #f3f4f6" }}>{fmt(Number(printInv.amount))}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ padding: "16px 10px 0", textAlign: "right", fontSize: 13, fontWeight: 600, color: "#374151", borderTop: "2px solid #e5e7eb" }}>Total Due</td>
                        <td style={{ padding: "16px 10px 0", textAlign: "right", fontSize: 22, fontWeight: 800, color: "#111827", borderTop: "2px solid #e5e7eb" }}>{fmt(Number(printInv.amount))}</td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* PAID stamp */}
                  {printInv.status === "PAID" && (
                    <div style={{ textAlign: "center", margin: "24px 0" }}>
                      <span style={{ display: "inline-block", border: "3px solid #16a34a", color: "#16a34a", fontSize: 22, fontWeight: 800, letterSpacing: "0.12em", padding: "6px 24px", borderRadius: 6, transform: "rotate(-12deg)", opacity: 0.85 }}>PAID</span>
                      {printInv.paidAt && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 8 }}>Payment received on {new Date(printInv.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ marginTop: 60, paddingTop: 20, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      <div style={{ fontWeight: 600, color: "#6b7280" }}>{PLATFORM_NAME}</div>
                      <div>Finance Department</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
                      <div>Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
