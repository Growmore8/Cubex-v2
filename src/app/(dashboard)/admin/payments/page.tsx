"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminPaymentsPage() {
  const [reqs, setReqs] = useState<any[]>([]);

  async function load() {
    const d = await fetch("/api/admin/payments").then((r) => r.json());
    if (d.ok) setReqs(d.requests);
  }
  useEffect(() => { load(); }, []);

  async function review(id: string, status: string) {
    await fetch("/api/admin/payments/" + id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    load();
  }

  const nav = (href: string, label: string, active = false) => (
    <Link href={href} className={"text-sm " + (active ? "font-medium" : "text-gray-500")}
      style={active ? { color: "var(--brand-primary)" } : undefined}>{label}</Link>
  );
  const badge = (s: string) => "rounded px-2 py-0.5 text-xs " + (s === "APPROVED" ? "bg-green-100 text-green-700" : s === "REJECTED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Deposits / Withdrawals</h1>
        
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600">
            <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Slip</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr>
          </thead>
          <tbody>
            {reqs.length === 0 ? <tr><td className="px-3 py-4" colSpan={7}>No requests.</td></tr> : reqs.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-3 py-2">{p.account.login} <span className="text-gray-500">{p.account.name}</span></td>
                <td className="px-3 py-2">{p.kind}</td>
                <td className="px-3 py-2">{Number(p.amount).toFixed(2)}</td>
                <td className="px-3 py-2">{p.method || "-"}</td>
                <td className="px-3 py-2">{p.slipUrl ? <a className="text-blue-600 underline" href={"/api/files/slip/" + p.id} target="_blank" rel="noreferrer">View</a> : "-"}</td>
                <td className="px-3 py-2"><span className={badge(p.status)}>{p.status}</span></td>
                <td className="px-3 py-2 text-right space-x-2">
                  {p.status === "PENDING" ? (<>
                    <button className="text-green-600" onClick={() => review(p.id, "APPROVED")}>Approve</button>
                    <button className="text-red-600" onClick={() => review(p.id, "REJECTED")}>Reject</button>
                  </>) : <span className="text-gray-400">{p.reviewedBy}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


