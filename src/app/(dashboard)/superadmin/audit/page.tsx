"use client";
import { useEffect, useState } from "react";

export default function SAAudit() {
  const [items, setItems] = useState<any[]>([]); const [companies, setCompanies] = useState<any[]>([]);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [co, setCo] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  async function load() { const p = new URLSearchParams(); if (q) p.set("q", q); if (cat) p.set("category", cat); if (co) p.set("tenantId", co); if (from) p.set("from", from); if (to) p.set("to", to); try { const d = await fetch("/api/superadmin/audit?" + p.toString()).then((r) => r.json()); if (d.ok) { setItems(d.items); setCompanies(d.companies); } } catch (e) {} }
  useEffect(() => { load(); }, [q, cat, co, from, to]);
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm";
  const catColor = (c: string) => c === "TRADE" ? "#16a34a" : c === "CLIENT" ? "#b45309" : c === "ADMIN" ? "#2563eb" : "#7c3aed";
  return (<div className="space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">Full Audit Log</h1><p className="text-sm text-gray-500">Every action across the entire platform</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <input className={inp + " min-w-[200px] flex-1"} placeholder="Search action / detail / user" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className={inp} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All Categories</option><option>SUPERADMIN</option><option>ADMIN</option><option>MANAGER</option><option>CLIENT</option><option>TRADE</option></select>
      <select className={inp} value={co} onChange={(e) => setCo(e.target.value)}><option value="">All Companies</option>{companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input className={inp} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input className={inp} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => { setQ(""); setCat(""); setCo(""); setFrom(""); setTo(""); }}>Clear</button>
    </div>
    <div className="ui-card bg-white" style={{ borderColor: "#e2e8f0" }}>
      {items.map((r: any) => (<div key={r.id} className="ui-row flex items-start gap-3 border-b px-3 py-2 last:border-0" style={{ borderColor: "#eef2f7" }}>
        <span className="mt-0.5 rounded px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: catColor(r.category) }}>{r.category}</span>
        <div className="flex-1"><div className="text-sm font-medium">{r.action} {r.company && <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] sab-amber">{r.company}</span>}</div>{r.detail && <div className="text-xs text-gray-500">{r.detail} {r.by && <span>&mdash; by <b>{r.by}</b></span>}</div>}</div>
        <div className="text-xs text-gray-400">{new Date(r.at).toLocaleString()}</div>
      </div>))}
      {items.length === 0 && <div className="px-3 py-4 text-sm text-gray-400">No entries.</div>}
    </div>
  </div>);
}