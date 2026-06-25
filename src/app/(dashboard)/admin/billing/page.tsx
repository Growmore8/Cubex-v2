"use client";
import { useEffect, useState } from "react";
import { PACKAGES } from "@/config/packages";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#b45309", PAID: "#15803d", OVERDUE: "#dc2626", CANCELLED: "#6b7280",
};
const STATUS_BG: Record<string, string> = {
  PENDING: "#fef3c7", PAID: "#dcfce7", OVERDUE: "#fee2e2", CANCELLED: "#f3f4f6",
};

function fmt(n: number) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function TenantBillingPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [printInv, setPrintInv] = useState<any>(null);

  async function load() {
    try {
      const d = await fetch("/api/admin/billing").then((r) => r.json());
      if (d.ok) { setInvoices(d.invoices); setSubscription(d.subscription); }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0);
  const pending = invoices.filter((i) => i.status === "PENDING" || i.status === "OVERDUE");
  const currentPkg = subscription ? PACKAGES[subscription.plan as keyof typeof PACKAGES] : null;

  return (
    <div className="space-y-5 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">Billing & Invoices</h1>
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Your subscription and payment history</p>
      </div>

      {/* Current Plan */}
      {subscription && currentPkg && (
        <div className="ui-card p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold uppercase mb-1" style={{ color: "var(--muted-foreground)" }}>Current Plan</div>
              <div className="text-2xl font-bold" style={{ color: currentPkg.color }}>{currentPkg.name}</div>
              <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>{currentPkg.description}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {currentPkg.features.map((f) => (
                  <span key={f} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: "var(--border)" }}>{f}</span>
                ))}
              </div>
            </div>
            <div className="text-right ml-6">
              <div className="text-3xl font-bold">${currentPkg.price}<span className="text-sm font-normal" style={{ color: "var(--muted-foreground)" }}>/mo</span></div>
              <div className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                Status: <span className="font-semibold">{subscription.status}</span>
              </div>
              {subscription.seats && <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{subscription.seats} seats</div>}
              {subscription.endsAt && (
                <div className="text-xs mt-1" style={{ color: new Date(subscription.endsAt) < new Date() ? "#dc2626" : "var(--muted-foreground)" }}>
                  Expires {new Date(subscription.endsAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subscription due-soon warning — shown to admin only, not to clients */}
      {subscription?.endsAt && (() => {
        const daysLeft = Math.ceil((new Date(subscription.endsAt).getTime() - Date.now()) / 86400000);
        const hasUnpaid = pending.length > 0;
        if (daysLeft > 7 && !hasUnpaid) return null;
        const isOverdue = daysLeft < 0 || subscription.status === "PAST_DUE";
        return (
          <div className="rounded-xl border px-4 py-3 flex items-start gap-3" style={{ background: isOverdue ? "#fff1f2" : "#fffbeb", borderColor: isOverdue ? "#fecaca" : "#fde68a" }}>
            <i className={"fa-solid mt-0.5 " + (isOverdue ? "fa-circle-exclamation text-red-600" : "fa-triangle-exclamation text-amber-500")} />
            <div>
              <div className="font-semibold text-sm" style={{ color: isOverdue ? "#b91c1c" : "#92400e" }}>
                {isOverdue ? "Subscription overdue — platform access at risk" : `Subscription renewing in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}
              </div>
              <div className="text-xs mt-0.5" style={{ color: isOverdue ? "#dc2626" : "#b45309" }}>
                {hasUnpaid
                  ? `You have ${pending.length} unpaid invoice${pending.length !== 1 ? "s" : ""}. Please arrange payment to avoid suspension.`
                  : `Your subscription expires on ${new Date(subscription.endsAt).toLocaleDateString()}. An invoice will be sent shortly.`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 ui-fade-up-stagger">
        {[
          { label: "Total Paid", value: fmt(totalPaid), icon: "fa-circle-check", color: "#15803d", bg: "#dcfce7" },
          { label: "Pending / Overdue", value: fmt(pending.reduce((s, i) => s + Number(i.amount), 0)), icon: "fa-clock", color: "#b45309", bg: "#fef3c7" },
          { label: "Total Invoices", value: String(invoices.length), icon: "fa-file-invoice", color: "#1d4ed8", bg: "#dbeafe" },
        ].map(({ label, value, icon, color, bg }) => (
          <div key={label} className="ui-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg w-8 h-8 flex items-center justify-center" style={{ background: bg }}>
                <i className={"fa-solid " + icon} style={{ color, fontSize: 13 }} />
              </div>
              <div className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</div>
            </div>
            <div className="text-xl font-bold" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Invoice History */}
      <div className="ui-card p-0">
        <div className="border-b px-4 py-3 font-semibold text-sm" style={{ borderColor: "var(--border)" }}>Invoice History</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                {["Invoice #","Period","Plan","Amount","Status","Due Date","Paid Date",""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="ui-row border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: "var(--brand-primary)" }}>{inv.number}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--muted-foreground)" }}>{inv.period}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium" style={{ color: PACKAGES[inv.plan as keyof typeof PACKAGES]?.color || "inherit" }}>
                      {PACKAGES[inv.plan as keyof typeof PACKAGES]?.name || inv.plan}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-semibold">{fmt(Number(inv.amount))}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: STATUS_BG[inv.status] || "#f3f4f6", color: STATUS_COLORS[inv.status] || "#6b7280" }}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(inv.dueAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setPrintInv(inv)} className="ui-btn ui-btn-ghost px-2 py-1 text-xs">
                      <i className="fa-solid fa-print text-xs" style={{ color: "var(--muted-foreground)" }} />
                    </button>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }} colSpan={8}>No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print Invoice */}
      {printInv && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <div className="ui-pop w-[600px] rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4 print:hidden" style={{ borderColor: "#e2e8f0" }}>
              <div className="font-semibold text-gray-800">Invoice {printInv.number}</div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="ui-btn ui-btn-primary px-4 py-1.5 text-sm"><i className="fa-solid fa-print mr-1" />Export PDF</button>
                <button onClick={() => setPrintInv(null)} className="ui-btn px-4 py-1.5 text-sm text-gray-700">Close</button>
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
                  <div className="text-sm text-gray-500">Subscription Billing</div>
                </div>
              </div>
              <div className="mb-6 p-4 rounded-lg border" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
                <div className="grid grid-cols-2 gap-4">
                  <div><div className="text-xs font-semibold text-gray-400 mb-1">PERIOD</div><div className="font-medium text-gray-800">{printInv.period}</div></div>
                  <div><div className="text-xs font-semibold text-gray-400 mb-1">DUE DATE</div><div className="font-medium text-gray-800">{new Date(printInv.dueAt).toLocaleDateString()}</div></div>
                </div>
              </div>
              <table className="w-full mb-6">
                <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <tr><th className="py-2 px-3 text-left text-xs text-gray-500">Description</th><th className="py-2 px-3 text-right text-xs text-gray-500">Amount</th></tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td className="py-3 px-3">
                      <div className="font-medium text-gray-800">{PACKAGES[printInv.plan as keyof typeof PACKAGES]?.name || printInv.plan} Plan</div>
                      <div className="text-xs text-gray-500">Monthly subscription — {printInv.period}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-gray-800">{fmt(Number(printInv.amount))}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr><td className="py-2 px-3 text-right font-bold text-gray-700">Total:</td><td className="py-2 px-3 text-right text-xl font-bold text-gray-900">{fmt(Number(printInv.amount))}</td></tr>
                </tfoot>
              </table>
              {printInv.paidAt && <div className="text-center text-sm font-semibold text-green-700 border border-green-200 rounded-lg py-2" style={{ background: "#dcfce7" }}>PAID — {new Date(printInv.paidAt).toLocaleDateString()}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
