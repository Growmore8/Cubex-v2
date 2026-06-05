"use client";
import { useEffect, useState } from "react";

const DEFAULT_FEATURES: Record<string, string[]> = {
  STARTER: ["Up to 5 Trading Accounts", "Live & Demo Accounts", "Basic Trade Desk", "Email Support", "Standard Reports", "KYC Management"],
  PRO: ["Up to 25 Trading Accounts", "All Starter Features", "Manager Role Access", "Priority Support", "Advanced Reports", "Custom Branding", "API Access", "Group Management"],
  ENTERPRISE: ["Up to 100 Trading Accounts", "All Pro Features", "Dedicated Account Manager", "White Label Solution", "Custom Integrations", "SLA Guarantee", "Multi-admin Access", "Audit Compliance Tools"],
};
const PLAN_COLORS: Record<string, string> = { STARTER: "#2563eb", PRO: "#7c3aed", ENTERPRISE: "#d97706" };
const PLANS = ["STARTER", "PRO", "ENTERPRISE"] as const;

export default function SAPackagesPage() {
  const [packages, setPackages] = useState<any>({});
  const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [ef, setEf] = useState<any>({});
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const d = await fetch("/api/superadmin/packages").then((r) => r.json());
      if (d.ok) { setPackages(d.packages); setPlanCounts(d.planCounts || {}); }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function openEdit(plan: string) {
    const pkg = packages[plan] || {};
    setEf({
      name: pkg.name || plan,
      price: pkg.price || 0,
      description: pkg.description || "",
      seats: pkg.seats || 5,
      features: (pkg.features || DEFAULT_FEATURES[plan] || []).join("\n"),
    });
    setEditing(plan);
    setErr("");
  }

  async function saveEdit() {
    if (!editing) return;
    const updated = {
      ...packages,
      [editing]: {
        ...packages[editing],
        name: ef.name,
        price: Number(ef.price),
        description: ef.description,
        seats: Number(ef.seats),
        features: ef.features.split("\n").map((f: string) => f.trim()).filter(Boolean),
      },
    };
    setErr("");
    const r = await fetch("/api/superadmin/packages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packages: updated }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setPackages(updated);
    setEditing(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const inp = "rounded-md border px-2 py-1.5 text-sm w-full";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Package Plans</h1>
          <p className="text-sm text-gray-500">Edit plan names, prices, seats and features</p>
        </div>
        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
            <i className="fa-solid fa-circle-check" /> Saved successfully
          </div>
        )}
      </div>

      {err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-3 gap-5">
        {PLANS.map((plan) => {
          const pkg = packages[plan] || {};
          const color = PLAN_COLORS[plan];
          const count = planCounts[plan] || 0;
          const features: string[] = pkg.features || DEFAULT_FEATURES[plan] || [];

          return (
            <div key={plan} className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: "#e2e8f0" }}>
              {/* Header */}
              <div className="px-5 py-4" style={{ background: color + "12", borderBottom: `2px solid ${color}30` }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color }}>{plan}</div>
                    <div className="text-xl font-bold text-gray-800">{pkg.name || plan}</div>
                    <div className="text-sm text-gray-500 mt-0.5">{pkg.description || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold" style={{ color }}>${pkg.price || 0}</div>
                    <div className="text-xs text-gray-400">/month</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="text-xs font-medium text-gray-600">
                    <i className="fa-solid fa-users mr-1" style={{ color }} />{pkg.seats || 5} seats
                  </div>
                  <div className="text-xs font-medium" style={{ color: count > 0 ? "#15803d" : "#9ca3af" }}>
                    <i className="fa-solid fa-building mr-1" />{count} tenant{count !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>

              {/* Features */}
              <div className="px-5 py-4">
                <div className="text-xs font-semibold uppercase text-gray-400 mb-3">Features</div>
                <ul className="space-y-1.5 mb-4">
                  {features.map((f: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <i className="fa-solid fa-check mt-0.5 text-[10px] shrink-0" style={{ color }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => openEdit(plan)} className="w-full rounded-lg border py-2 text-sm font-medium transition-colors hover:border-current" style={{ borderColor: color + "40", color }}>
                  <i className="fa-solid fa-pen mr-2" />Edit Plan
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tenant distribution */}
      <div className="rounded-xl border bg-white p-5" style={{ borderColor: "#e2e8f0" }}>
        <div className="mb-3 text-sm font-semibold text-gray-700">
          <i className="fa-solid fa-chart-pie mr-2 text-gray-400" />Tenant Distribution
        </div>
        <div className="flex gap-4">
          {PLANS.map((plan) => {
            const count = planCounts[plan] || 0;
            const total = Object.values(planCounts).reduce((s: number, v: any) => s + Number(v), 0);
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const color = PLAN_COLORS[plan];
            return (
              <div key={plan} className="flex-1 rounded-lg border p-4" style={{ borderColor: "#e2e8f0" }}>
                <div className="text-xs font-semibold uppercase mb-1" style={{ color }}>{packages[plan]?.name || plan}</div>
                <div className="text-2xl font-bold text-gray-800">{count}</div>
                <div className="text-xs text-gray-400">{pct}% of tenants</div>
                <div className="mt-2 h-1.5 rounded-full bg-gray-100">
                  <div className="h-1.5 rounded-full transition-all" style={{ width: pct + "%", background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-[500px] max-h-[90vh] overflow-auto rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
              <div className="h-3 w-3 rounded-full" style={{ background: PLAN_COLORS[editing] }} />
              Edit {editing} Plan
            </div>
            <div className="mb-4 text-xs text-gray-400">Changes take effect immediately for new invoices and UI display</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PLAN DISPLAY NAME</label>
                  <input className={inp} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">PRICE ($/month)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-2 text-sm text-gray-400">$</span>
                    <input className={inp + " pl-6"} type="number" min="0" value={ef.price} onChange={(e) => setEf({ ...ef, price: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">SEATS (max accounts)</label>
                  <input className={inp} type="number" min="1" value={ef.seats} onChange={(e) => setEf({ ...ef, seats: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">SHORT DESCRIPTION</label>
                <input className={inp} value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">FEATURES (one per line)</label>
                <textarea className={inp + " font-mono text-xs"} rows={8} value={ef.features} onChange={(e) => setEf({ ...ef, features: e.target.value })} />
                <p className="text-[10px] text-gray-400 mt-1">Each line is a separate feature bullet</p>
              </div>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: PLAN_COLORS[editing] }} onClick={saveEdit}>
                <i className="fa-solid fa-floppy-disk mr-2" />Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
