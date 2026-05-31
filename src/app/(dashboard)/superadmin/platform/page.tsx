"use client";
import { useEffect, useState } from "react";

const MODES: [string, string, string, string][] = [
  ["OPEN", "Platform Open", "All users can access normally", "#16a34a"],
  ["READONLY", "Read-only", "Trading disabled, viewing only", "#b45309"],
  ["LOCKED", "Locked", "All access blocked", "#dc2626"],
];

export default function SAPlatform() {
  const [mode, setMode] = useState("OPEN"); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  async function load() { try { const d = await fetch("/api/superadmin/platform").then((r) => r.json()); if (d.ok) setMode(d.mode); } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function save(m: string) { setErr(""); setMsg(""); const r = await fetch("/api/superadmin/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setMode(m); setMsg("Saved"); setTimeout(() => setMsg(""), 1500); }
  return (<div className="max-w-2xl space-y-4">
    <div><h1 className="text-2xl font-bold">Platform Control</h1><p className="text-sm text-gray-500">Open / Read-only / Locked for the entire platform</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}
    <div className="space-y-2">
      {MODES.map(([k, t, d, c]) => (<button key={k} onClick={() => save(k)} className="block w-full rounded-lg border p-4 text-left" style={{ borderColor: mode === k ? c : "#e2e8f0", background: mode === k ? c + "18" : "#fff" }}>
        <div className="font-semibold" style={{ color: c }}>{t}{mode === k ? " ✓" : ""}</div><div className="text-sm text-gray-500">{d}</div></button>))}
    </div>
  </div>);
}