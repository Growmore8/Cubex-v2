"use client";
import { useEffect, useState } from "react";

type Record_ = {
  id: string; tenantId: string; tenantName: string; clientName: string;
  clientEmail: string | null; login: string; type: string;
  balance: number; expiredAt: string; createdAt: string;
};

export default function SAExpiredAccounts() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/superadmin/expired-accounts").then((r) => r.json())
      .then((d) => { if (d.ok) setRecords(d.records || []); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.clientName.toLowerCase().includes(q) || (r.clientEmail || "").toLowerCase().includes(q)
      || r.login.toLowerCase().includes(q) || r.tenantName.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-5xl space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">Expired Demo Accounts</h1>
        <p className="text-sm text-gray-500">Permanent history of demo accounts deleted after 30-day expiry.</p>
      </div>

      <div className="flex items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client / email / login / tenant…"
          className="rounded-lg border px-3 py-1.5 text-sm flex-1 max-w-xs"
          style={{ background: "var(--bg2)", borderColor: "var(--border)", color: "var(--text)" }} />
        <span className="text-xs text-gray-400">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="ui-card p-0 overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {search ? "No records match your search." : "No expired demo accounts yet."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wider text-gray-400"
                style={{ borderColor: "var(--border)", background: "var(--bg2)" }}>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Login</th>
                <th className="px-3 py-2 text-right">Balance at Expiry</th>
                <th className="px-3 py-2 text-right">Expired On</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--soft)]">
                  <td className="px-3 py-2 font-medium">{r.tenantName}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.clientName}</div>
                    {r.clientEmail && <div className="text-gray-400 text-[10px]">{r.clientEmail}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.login}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={Number(r.balance) >= 0 ? "text-green-500" : "text-red-400"}>
                      ${Number(r.balance).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {new Date(r.expiredAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
