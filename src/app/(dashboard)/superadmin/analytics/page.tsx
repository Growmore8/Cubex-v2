"use client";
import { useEffect, useState } from "react";
import { PACKAGES } from "@/config/packages";

function fmt(n: number) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const TIME_OPTIONS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 90 Days", days: 90 },
  { label: "All Time", days: 0 },
];

export default function SAAnalyticsPage() {
  const [data, setData] = useState<any[]>([]);
  const [days, setDays] = useState(30);
  const [sortBy, setSortBy] = useState<string>("clients");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function load() {
    try {
      const d = await fetch("/api/superadmin/analytics?days=" + days).then((r) => r.json());
      if (d.ok) setData(d.analytics);
    } catch {}
  }
  useEffect(() => { load(); }, [days]);

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  const sorted = [...data].sort((a, b) => {
    const v = (a[sortBy] ?? 0) > (b[sortBy] ?? 0) ? 1 : -1;
    return sortDir === "desc" ? -v : v;
  });

  const totals = data.reduce((acc, t) => ({
    clients: acc.clients + t.clients,
    managers: acc.managers + t.managers,
    admins: acc.admins + t.admins,
    liveAccounts: acc.liveAccounts + t.liveAccounts,
    demoAccounts: acc.demoAccounts + t.demoAccounts,
    openTrades: acc.openTrades + t.openTrades,
    totalDeposits: acc.totalDeposits + t.totalDeposits,
    totalWithdrawals: acc.totalWithdrawals + t.totalWithdrawals,
  }), { clients: 0, managers: 0, admins: 0, liveAccounts: 0, demoAccounts: 0, openTrades: 0, totalDeposits: 0, totalWithdrawals: 0 });

  const Th = ({ col, label }: { col: string; label: string }) => (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(col)}>
      {label} {sortBy === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="space-y-5 ui-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Analytics</h1>
          <p className="text-sm text-gray-500">Per-tenant breakdown with time filters</p>
        </div>
        <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: "#e2e8f0" }}>
          {TIME_OPTIONS.map(({ label, days: d }) => (
            <button key={d} onClick={() => setDays(d)} className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={days === d ? { background: "#2563eb", color: "#fff" } : { color: "#64748b" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Platform totals */}
      <div className="grid grid-cols-4 gap-3 ui-fade-up-stagger">
        {[
          { label: "Total Clients", value: totals.clients, color: "#15803d", icon: "fa-users" },
          { label: "Total Managers", value: totals.managers, color: "#7c3aed", icon: "fa-users-gear" },
          { label: "Open Trades", value: totals.openTrades, color: "#dc2626", icon: "fa-arrow-right-arrow-left" },
          { label: "Net Deposits", value: fmt(totals.totalDeposits - totals.totalWithdrawals), color: "#1d4ed8", icon: "fa-money-bill" },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
            <div className="flex items-center gap-2 mb-1">
              <i className={"fa-solid " + icon} style={{ color, fontSize: 13 }} />
              <div className="text-xs font-medium text-gray-500">{label}</div>
            </div>
            <div className="text-2xl font-bold" style={{ color }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
          </div>
        ))}
      </div>

      {/* Tenant table */}
      <div className="ui-card bg-white" style={{ borderColor: "#e2e8f0" }}>
        <div className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: "#e2e8f0" }}>
          Per-Tenant Breakdown {days > 0 ? `(Last ${days} days)` : "(All Time)"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "#f8fafc" }}>
              <tr className="border-b text-left" style={{ borderColor: "#e2e8f0" }}>
                <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">Tenant</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">Plan</th>
                <Th col="clients" label="Clients" />
                <Th col="managers" label="Managers" />
                <Th col="admins" label="Admins" />
                <Th col="liveAccounts" label="Live Acc." />
                <Th col="demoAccounts" label="Demo Acc." />
                <Th col="activeAccounts" label="Active" />
                <Th col="lockedAccounts" label="Locked" />
                <Th col="openTrades" label="Open Trades" />
                <Th col="totalDeposits" label="Deposits" />
                <Th col="totalWithdrawals" label="Withdrawals" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const pkg = t.plan ? PACKAGES[t.plan as keyof typeof PACKAGES] : null;
                return (
                  <tr key={t.id} className="ui-row border-b" style={{ borderColor: "#f0f4f8" }}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{t.brandName || t.name}</div>
                      <div className="text-xs text-gray-400">{t.subdomain}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {pkg ? (
                        <span className="text-xs font-semibold" style={{ color: pkg.color }}>{pkg.name}</span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{t.clients}</td>
                    <td className="px-3 py-2.5">{t.managers}</td>
                    <td className="px-3 py-2.5">{t.admins}</td>
                    <td className="px-3 py-2.5">{t.liveAccounts}</td>
                    <td className="px-3 py-2.5">{t.demoAccounts}</td>
                    <td className="px-3 py-2.5 text-green-700">{t.activeAccounts}</td>
                    <td className="px-3 py-2.5 text-red-600">{t.lockedAccounts}</td>
                    <td className="px-3 py-2.5">{t.openTrades}</td>
                    <td className="px-3 py-2.5 text-green-700 font-medium">{fmt(t.totalDeposits)}</td>
                    <td className="px-3 py-2.5 text-red-600">{fmt(t.totalWithdrawals)}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={12}>No tenant data.</td></tr>}
            </tbody>
            {sorted.length > 0 && (
              <tfoot style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0" }}>
                <tr className="font-semibold text-gray-700">
                  <td className="px-3 py-2.5" colSpan={2}>TOTAL</td>
                  <td className="px-3 py-2.5">{totals.clients}</td>
                  <td className="px-3 py-2.5">{totals.managers}</td>
                  <td className="px-3 py-2.5">{totals.admins}</td>
                  <td className="px-3 py-2.5">{totals.liveAccounts}</td>
                  <td className="px-3 py-2.5">{totals.demoAccounts}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5">{totals.openTrades}</td>
                  <td className="px-3 py-2.5 text-green-700">{fmt(totals.totalDeposits)}</td>
                  <td className="px-3 py-2.5 text-red-600">{fmt(totals.totalWithdrawals)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
