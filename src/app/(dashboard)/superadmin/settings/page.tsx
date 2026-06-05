"use client";
import { useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

export default function SASettings() {
  const [form, setForm] = useState<any>({}); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  async function save() { setErr(""); setMsg(""); const r = await fetch("/api/superadmin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setMsg("Saved"); setForm({}); setTimeout(() => setMsg(""), 1500); }
  const inp = "rounded-md border px-3 py-2 text-sm w-full";
  return (<div className="max-w-lg space-y-4">
    <div><h1 className="text-2xl font-bold">Super Admin Settings</h1><p className="text-sm text-gray-500">Update your own credentials</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}
    <div className="space-y-3 rounded-lg border bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div><div className="text-xs text-gray-500">New name</div><input className={inp} placeholder="Display name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><div className="text-xs text-gray-500">New password</div><PasswordInput className={inp} placeholder="Leave blank to keep current" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div><div className="text-xs text-gray-500">Email</div><input className={inp} placeholder="your@email.com" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white" onClick={save}>Save Changes</button>
    </div>
  </div>);
}