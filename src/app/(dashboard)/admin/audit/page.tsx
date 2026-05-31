"use client";
import { useEffect, useState } from "react";

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [msg, setMsg] = useState("");
  async function load() { const d = await fetch("/api/admin/audit").then((r) => r.json()); if (d.ok) setLogs(d.logs); }
  useEffect(() => { load(); }, []);
  async function broadcast(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) });
    const d = await r.json(); setMsg(d.ok ? "Sent to all clients" : (d.error || "Failed"));
    if (d.ok) { setTitle(""); setBody(""); load(); }
  }
  const input = "rounded-md border px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit & Announcements</h1>
      </div>
      <form onSubmit={broadcast} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4">
        <span className="text-sm font-semibold">Announce to all clients:</span>
        <input className={input} placeholder="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={input} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Send</button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </form>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm"><thead className="border-b bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Detail</th></tr></thead>
          <tbody>{logs.length === 0 ? <tr><td className="px-3 py-4" colSpan={4}>No activity.</td></tr> : logs.map((l) => (
            <tr key={l.id} className="border-b last:border-0"><td className="px-3 py-2 text-xs text-gray-500">{new Date(l.createdAt).toLocaleString()}</td><td className="px-3 py-2">{l.performedBy}</td><td className="px-3 py-2 font-mono text-xs">{l.action}</td><td className="px-3 py-2 text-gray-600">{l.detail}</td></tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}
