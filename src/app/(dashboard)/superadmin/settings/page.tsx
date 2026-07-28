"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

function SwapRolloverCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  async function run() {
    setRunning(true); setResult(null); setErr("");
    try {
      const r = await fetch("/api/superadmin/swap-rollover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Failed"); } else { setResult(d); }
    } catch { setErr("Request failed"); }
    setRunning(false);
  }

  return (
    <div className="space-y-3 ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="text-sm font-semibold text-gray-700">Swap Rollover</div>
      <p className="text-xs text-gray-500">Charges overnight swap on all open positions across every swap-enabled tenant. Runs automatically at 21:00 UTC via Vercel Cron. Triple swap is applied on Wednesdays.</p>
      {err && <div className="text-xs text-red-500">{err}</div>}
      {result && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          ✓ Rollover complete — {result.date} · ×{result.multiplier} · {result.tradesCharged} trades charged across {result.tenantsProcessed} tenants
          {result.errors?.length ? <div className="mt-1 text-red-600">{result.errors.join("; ")}</div> : null}
        </div>
      )}
      <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm disabled:opacity-50" onClick={run} disabled={running}>
        {running ? <><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />Running…</> : <><i className="fa-solid fa-rotate mr-1.5" />Run Rollover Now</>}
      </button>
    </div>
  );
}

export default function SASettings() {
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/superadmin/settings").then((r) => r.json()).then((d) => {
      if (d.ok) setForm((f: any) => ({ ...f, publicApiUrl: d.publicApiUrl || "" }));
    }).catch(() => {});
  }, []);

  async function save() {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMsg("Saved"); setTimeout(() => setMsg(""), 1500);
  }
  const inp = "ui-input rounded-md border px-3 py-2 text-sm w-full";
  return (<div className="max-w-3xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">Super Admin Settings</h1><p className="text-sm text-gray-500">Update your own credentials and platform config</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}
    <div className="space-y-3 ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="text-sm font-semibold text-gray-700">Profile</div>
      <div><div className="text-xs text-gray-500">New name</div><input className={inp} placeholder="Display name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><div className="text-xs text-gray-500">New password</div><PasswordInput className={inp} placeholder="Leave blank to keep current" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div><div className="text-xs text-gray-500">Email</div><input className={inp} placeholder="your@email.com" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
    </div>
    <div className="space-y-3 ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="text-sm font-semibold text-gray-700">Public API Gateway</div>
      <p className="text-xs text-gray-500">The domain shown to tenants in API key docs. Set this to your proxy domain so CubeX is never exposed.</p>
      <div>
        <div className="text-xs text-gray-500 mb-1">Public API URL</div>
        <input className={inp} placeholder="https://orbitfxsolution.com" value={form.publicApiUrl || ""} onChange={(e) => setForm({ ...form, publicApiUrl: e.target.value })} />
        <div className="text-xs text-gray-400 mt-1">Leave blank to use the current server URL (not recommended for production)</div>
      </div>
    </div>
    <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" onClick={save}>Save Changes</button>
    <SwapRolloverCard />
  </div>);
}