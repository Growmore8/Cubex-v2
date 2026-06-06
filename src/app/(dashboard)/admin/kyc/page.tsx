"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminKycPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});

  async function load() {
    const d = await fetch("/api/admin/kyc").then((r) => r.json());
    if (d.ok) setDocs(d.docs);
  }
  useEffect(() => { load(); }, []);

  async function review(id: string, status: string) {
    await fetch("/api/admin/kyc/" + id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: note[id] || "" }),
    });
    load();
  }

  const nav = (href: string, label: string, active = false) => (
    <Link href={href} className={"text-sm " + (active ? "font-medium" : "text-gray-500")}
      style={active ? { color: "var(--brand-primary)" } : undefined}>{label}</Link>
  );
  const badge = (s: string) => "rounded px-2 py-0.5 text-xs " + (s === "APPROVED" ? "bg-green-100 text-green-700" : s === "REJECTED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700");

  return (
    <div className="space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">KYC Review</h1>

      </div>
      <div className="ui-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600">
            <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">File</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">Action</th></tr>
          </thead>
          <tbody>
            {docs.length === 0 ? <tr><td className="px-3 py-4" colSpan={6}>No documents.</td></tr> : docs.map((d) => (
              <tr key={d.id} className="ui-row border-b last:border-0">
                <td className="px-3 py-2">{d.account.login} <span className="text-gray-500">{d.account.name}</span></td>
                <td className="px-3 py-2">{d.docType}</td>
                <td className="px-3 py-2"><a className="text-blue-600 underline transition-colors duration-200" href={"/api/files/kyc/" + d.id} target="_blank" rel="noreferrer">View</a></td>
                <td className="px-3 py-2"><span className={badge(d.status)}>{d.status}</span></td>
                <td className="px-3 py-2"><input className="ui-input px-2 py-1 text-xs" placeholder="reason" value={note[d.id] || ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} /></td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-green-600" onClick={() => review(d.id, "APPROVED")}>Approve</button>
                  <button className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => review(d.id, "REJECTED")}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


