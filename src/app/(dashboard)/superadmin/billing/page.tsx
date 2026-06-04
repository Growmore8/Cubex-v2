"use client";
import { useEffect, useState } from "react";
import { PACKAGES, PLAN_KEYS } from "@/config/packages";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "sab-amber", PAID: "sab-green", OVERDUE: "sab-red", CANCELLED: "sab-red",
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

  const inp = "rounded-md border px-2 py-1.5 text-sm w-full";
  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing & Invoicing</h1>
          <p className="text-sm text-gray-500">Generate and manage tenant invoices</p>
        </div>
        <button onClick={() => setGenOpen(true)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
          <i className="fa-solid fa-file-invoice mr-2" />Generate Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pending", value: fmt(totalPending), count: invoices.filter((i) => i.status === "PENDING").length, color: "#b45309", bg: "#fef3c7" },
          { label: "Paid", value: fmt(totalPaid), count: invoices.filter((i) => i.status === "PAID").length, color: "#15803d", bg: "#dcfce7" },
          { label: "Overdue", value: fmt(totalOverdue), count: invoices.filter((i) => i.status === "OVERDUE").length, color: "#dc2626", bg: "#fee2e2" },
        ].map(({ label, value, count, color, bg }) => (
          <div key={label} className="rounded-xl border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
            <div className="text-xs font-semibold text-gray-500 mb-1">{label.toUpperCase()}</div>
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{count} invoice{count !== 1 ? "s" : ""}</div>
          </div>
        ))}
      </div>

      {/* Package info */}
      <div className="rounded-xl border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
        <div className="mb-3 text-sm font-semibold text-gray-700">Package Plans</div>
        <div className="grid grid-cols-3 gap-3">
          {PLAN_KEYS.map((key) => {
            const pkg = PACKAGES[key];
            return (
              <div key={key} className="rounded-lg border p-3" style={{ borderColor: "#e2e8f0" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold" style={{ color: pkg.color }}>{pkg.name}</span>
                  <span className="text-lg font-bold">${pkg.price}<span className="text-xs text-gray-400">/mo</span></span>
                </div>
                <div className="text-xs text-gray-500 mb-2">{pkg.description}</div>
                <ul className="space-y-0.5">
                  {pkg.features.slice(0, 3).map((f) => (
                    <li key={f} className="text-xs text-gray-600 flex items-center gap-1">
                      <i className="fa-solid fa-check text-[9px]" style={{ color: pkg.color }} />{f}
                    </li>
                  ))}
                  {pkg.features.length > 3 && <li className="text-xs text-gray-400">+{pkg.features.length - 3} more</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      {/* Invoice table */}
      <div className="rounded-xl border bg-white" style={{ borderColor: "#e2e8f0" }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: "#e2e8f0" }}>
          <span className="font-semibold text-sm">Invoices</span>
          <div className="ml-auto flex gap-2">
            <select className="rounded border px-2 py-1.5 text-sm" value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)} style={{ borderColor: "#cbd5e1" }}>
              <option value="">All Tenants</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
            </select>
            <select className="rounded border px-2 py-1.5 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ borderColor: "#cbd5e1" }}>
              <option value="">All Status</option>
              {["PENDING","PAID","OVERDUE","CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "#f8fafc" }}>
              <tr className="border-b text-left" style={{ borderColor: "#e2e8f0" }}>
                {["Invoice #","Tenant","Period","Plan","Amount","Status","Due Date","Paid Date","Actions"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b hover:bg-gray-50/60" style={{ borderColor: "#f0f4f8" }}>
                  <td className="px-3 py-2.5 font-mono text-xs font-medium text-blue-600">{inv.number}</td>
                  <td className="px-3 py-2.5 font-medium">{inv.tenant?.brandName || inv.tenant?.name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{inv.period}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium" style={{ color: PACKAGES[inv.plan as keyof typeof PACKAGES]?.color || "#666" }}>
                      {PACKAGES[inv.plan as keyof typeof PACKAGES]?.name || inv.plan}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-semibold">{fmt(Number(inv.amount))}</td>
                  <td className="px-3 py-2.5"><span className={"sab " + (STATUS_COLORS[inv.status] || "sab-amber")}>{inv.status}</span></td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{new Date(inv.dueAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {inv.status === "PENDING" && (
                      <button onClick={() => act(inv.id, "markPaid")} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#dcfce7", color: "#15803d" }}>
                        <i className="fa-solid fa-check mr-1" />Paid
                      </button>
                    )}
                    {inv.status === "PENDING" && (
                      <button onClick={() => act(inv.id, "markOverdue")} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#fee2e2", color: "#dc2626" }}>
                        Overdue
                      </button>
                    )}
                    {(inv.status === "PAID" || inv.status === "OVERDUE") && (
                      <button onClick={() => act(inv.id, "markPending")} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#fef3c7", color: "#b45309" }}>
                        Reset
                      </button>
                    )}
                    <button onClick={() => setPrintInv(inv)} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "#f1f5f9", color: "#475569" }}>
                      <i className="fa-solid fa-print text-xs" />
                    </button>
                    <button onClick={() => { if (confirm("Delete invoice " + inv.number + "?")) act(inv.id, "delete"); }} className="rounded px-2 py-1 text-xs" style={{ background: "#fff1f2", color: "#dc2626" }}>
                      <i className="fa-solid fa-trash text-xs" />
                    </button>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={9}>No invoices found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Invoice Modal */}
      {genOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setGenOpen(false)}>
          <div className="w-[500px] rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-lg font-semibold">Generate Invoice</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">TENANT</label>
                <select className={inp} value={gf.tenantId} onChange={(e) => setGf({ ...gf, tenantId: e.target.value })}>
                  <option value="">Select tenant…</option>
                  {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PERIOD (YYYY-MM)</label>
                  <input className={inp} type="month" value={gf.period} onChange={(e) => setGf({ ...gf, period: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PLAN</label>
                  <select className={inp} value={gf.plan} onChange={(e) => setGf({ ...gf, plan: e.target.value, amount: PACKAGES[e.target.value as keyof typeof PACKAGES]?.price || gf.amount })}>
                    {PLAN_KEYS.map((k) => <option key={k} value={k}>{PACKAGES[k].name} — ${PACKAGES[k].price}/mo</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">AMOUNT ($)</label>
                  <input className={inp} type="number" value={gf.amount} onChange={(e) => setGf({ ...gf, amount: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">DUE DATE</label>
                  <input className={inp} type="date" value={gf.dueAt} onChange={(e) => setGf({ ...gf, dueAt: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">NOTES (optional)</label>
                <textarea className={inp} rows={2} value={gf.notes} onChange={(e) => setGf({ ...gf, notes: e.target.value })} />
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => setGenOpen(false)}>Cancel</button>
              <button className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white" onClick={generate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Invoice */}
      {printInv && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => setPrintInv(null)}>
          <div className="w-[600px] rounded-xl bg-white shadow-2xl print:shadow-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4 print:hidden" style={{ borderColor: "#e2e8f0" }}>
              <div className="font-semibold">Invoice Preview</div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white"><i className="fa-solid fa-print mr-1" />Print / Save PDF</button>
                <button onClick={() => setPrintInv(null)} className="rounded-lg border px-4 py-1.5 text-sm">Close</button>
              </div>
            </div>
            <div className="p-8">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <div className="text-2xl font-bold text-gray-800">INVOICE</div>
                  <div className="text-gray-500 text-sm mt-1">{printInv.number}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-800">CubeX Platform</div>
                  <div className="text-sm text-gray-500">Billing Department</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <div className="text-xs font-semibold text-gray-400 mb-1">BILLED TO</div>
                  <div className="font-semibold">{printInv.tenant?.brandName || printInv.tenant?.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-400 mb-1">INVOICE DETAILS</div>
                  <div className="text-sm text-gray-600">Period: <span className="font-medium">{printInv.period}</span></div>
                  <div className="text-sm text-gray-600">Due: <span className="font-medium">{new Date(printInv.dueAt).toLocaleDateString()}</span></div>
                  <div className="text-sm text-gray-600">Status: <span className="font-medium">{printInv.status}</span></div>
                </div>
              </div>
              <table className="w-full mb-6 border-collapse">
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500">Description</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td className="py-3 px-3">
                      <div className="font-medium">{PACKAGES[printInv.plan as keyof typeof PACKAGES]?.name || printInv.plan} Plan — Monthly Subscription</div>
                      <div className="text-xs text-gray-500">Billing period: {printInv.period}</div>
                      {printInv.notes && <div className="text-xs text-gray-400 mt-0.5">{printInv.notes}</div>}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">{fmt(Number(printInv.amount))}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td className="py-3 px-3 text-right font-bold text-gray-700">Total Due:</td>
                    <td className="py-3 px-3 text-right text-xl font-bold">{fmt(Number(printInv.amount))}</td>
                  </tr>
                </tfoot>
              </table>
              {printInv.paidAt && <div className="text-center text-sm font-semibold text-green-600 border border-green-200 rounded-lg py-2 bg-green-50">PAID on {new Date(printInv.paidAt).toLocaleDateString()}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
