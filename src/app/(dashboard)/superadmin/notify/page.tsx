"use client";
import { useEffect, useState } from "react";

const TPL: any = { Maintenance: { title: "Scheduled Maintenance", body: "The platform will undergo scheduled maintenance shortly." }, Promotion: { title: "Special Promotion", body: "A new promotion is now available." }, News: { title: "Market News", body: "Latest market updates." }, Notice: { title: "Important Notice", body: "Please review this notice." }, Custom: { title: "", body: "" } };

export default function SANotify() {
  const [form, setForm] = useState<any>({ role: "ALL", tenantId: "" }); const [companies, setCompanies] = useState<any[]>([]); const [recent, setRecent] = useState<any[]>([]); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  async function load() { try { const d = await fetch("/api/superadmin/notify").then((r) => r.json()); if (d.ok) { setCompanies(d.companies); setRecent(d.recent); } } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function send() { setErr(""); setMsg(""); const r = await fetch("/api/superadmin/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: form.title, body: form.body, image: form.image, tenantId: form.tenantId, role: form.role }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setMsg("Sent to " + d.count + " users"); setForm({ role: "ALL", tenantId: "" }); load(); setTimeout(() => setMsg(""), 2500); }
  const inp = "rounded-md border px-2 py-1.5 text-sm w-full";
  return (<div className="max-w-2xl space-y-4">
    <div><h1 className="text-2xl font-bold">Send Notification</h1><p className="text-sm text-gray-500">Broadcast a message by company and role</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}
    <div className="space-y-2 rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="flex flex-wrap gap-1">{Object.keys(TPL).map((k) => <button key={k} className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--border)", background: form.template === k ? "var(--accent2)" : "var(--bg2)", color: form.template === k ? "#fff" : "var(--text)" }} onClick={() => setForm({ ...form, title: TPL[k].title, body: TPL[k].body, template: k })}>{k}</button>)}</div>
      <div className="grid grid-cols-2 gap-2">
        <select className={inp} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}><option value="">All companies</option>{companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className={inp} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="ALL">Clients + Managers</option><option value="CLIENT">Clients only</option><option value="MANAGER">Managers only</option></select>
      </div>
      <input className={inp} placeholder="Title" value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea className={inp} rows={3} placeholder="Message" value={form.body || ""} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      <input className={inp} placeholder="Image URL (optional)" value={form.image || ""} onChange={(e) => setForm({ ...form, image: e.target.value })} />
      <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={send}>Send notification</button>
    </div>
    {recent.length > 0 && <div className="rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}><div className="text-xs font-semibold text-gray-500">Recently sent</div>{recent.map((n: any, i: number) => (<div key={i} className="mt-1 text-sm">{n.title} <span className="text-xs text-gray-400">&middot; {new Date(n.createdAt).toLocaleString()}</span></div>))}</div>}
  </div>);
}