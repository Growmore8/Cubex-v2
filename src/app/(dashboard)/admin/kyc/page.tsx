"use client";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Link from "next/link";

export default function AdminKycPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const acc: Record<string, (d: any) => any> = { account: (d) => d.account?.login, type: (d) => d.docType, status: (d) => d.status };
  const toggle = (k: string) => setSort((s) => (!s || s.k !== k ? { k, d: 1 } : s.d === 1 ? { k, d: -1 } : null));
  const sorted = (() => { if (!sort || !acc[sort.k]) return docs; const g = acc[sort.k]; return [...docs].sort((a, b) => { const va = g(a), vb = g(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sort.d; }); })();
  const Sth = ({ k, label }: { k: string; label: string }) => (
    <th className="cursor-pointer select-none px-3 py-2" onClick={() => toggle(k)}><span className="inline-flex items-center gap-1">{label}<i className={"fa-solid text-[8px] " + (sort?.k === k ? (sort.d === 1 ? "fa-arrow-up-long" : "fa-arrow-down-long") : "fa-sort")} style={{ opacity: sort?.k === k ? 1 : 0.3, color: sort?.k === k ? "var(--brand-primary)" : "#9ca3af" }} /></span></th>
  );

  async function load() {
    const d = await fetch("/api/admin/kyc").then((r) => r.json());
    if (d.ok) setDocs(d.docs);
  }
  useEffect(() => {
    load();
    const socket = io({ path: "/socket.io" });
    socket.on("refresh", () => load());
    return () => { socket.disconnect(); };
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [flashErr, setFlashErr] = useState("");

  async function review(id: string, action: "approve" | "reject") {
    const doc = docs.find((d) => d.id === id);
    const label = doc ? `${doc.account?.login} — ${doc.docType}` : id;
    if (action === "reject" && !note[id]?.trim()) { setFlashErr("Enter a rejection reason before rejecting"); return; }
    if (!window.confirm(`${action === "approve" ? "Approve" : "Reject"} KYC for ${label}?`)) return;
    setBusy(id + action);
    const r = await fetch("/api/admin/kyc/" + id, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: note[id] || "" }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(null);
    if (!r.ok) { setFlashErr(r.error || "Update failed"); return; }
    setFlashErr("");
    load();
  }

  async function deleteDoc(id: string) {
    const doc = docs.find((d) => d.id === id);
    if (!window.confirm(`Delete KYC document for ${doc?.account?.login}?`)) return;
    setBusy(id + "DEL");
    await fetch("/api/admin/kyc/" + id, { method: "DELETE" }).then((x) => x.json()).catch(() => {});
    setBusy(null);
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
        {flashErr && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{flashErr}</div>}
      </div>
      <div className="ui-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-gray-600">
            <tr><Sth k="account" label="Account" /><Sth k="type" label="Type" /><th className="px-3 py-2">Documents</th><Sth k="status" label="Status" /><th className="px-3 py-2">Note / Reason</th><th className="px-3 py-2 text-right">Action</th></tr>
          </thead>
          <tbody>
            {docs.length === 0 ? <tr><td className="px-3 py-4" colSpan={6}>No documents.</td></tr> : sorted.map((d) => (
              <tr key={d.id} className="ui-row border-b last:border-0">
                <td className="px-3 py-2">{d.account.login} <span className="text-gray-500">{d.account.name}</span></td>
                <td className="px-3 py-2">{d.docType}</td>
                <td className="px-3 py-2 space-x-2">
                  <a className="text-blue-600 underline transition-colors duration-200" href={"/api/files/kyc/" + d.id} target="_blank" rel="noreferrer">Front</a>
                  {d.backUrl && <a className="text-blue-600 underline transition-colors duration-200" href={"/api/files/kyc/" + d.id + "?side=back"} target="_blank" rel="noreferrer">Back</a>}
                </td>
                <td className="px-3 py-2"><span className={badge(d.status)}>{d.status}</span></td>
                <td className="px-3 py-2"><input className="ui-input px-2 py-1 text-xs" placeholder="rejection reason" value={note[d.id] || ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} /></td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button disabled={!!busy} className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-green-600 disabled:opacity-40" onClick={() => review(d.id, "approve")}>{busy === d.id + "approve" ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Approve"}</button>
                  <button disabled={!!busy} className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-red-600 disabled:opacity-40" onClick={() => review(d.id, "reject")}>{busy === d.id + "reject" ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Reject"}</button>
                  <button disabled={!!busy} className="ui-btn ui-btn-ghost px-2 py-1 text-xs text-gray-400 disabled:opacity-40" onClick={() => deleteDoc(d.id)}>{busy === d.id + "DEL" ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-trash-can" />}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


