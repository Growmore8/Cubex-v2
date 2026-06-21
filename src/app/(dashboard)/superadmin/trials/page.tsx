"use client";
import { useEffect, useState } from "react";

type Trial = { id: string; name: string; subdomain: string; customDomain: string | null; plan: string; endsAt: string | null; clients: number; daysLeft: number | null; expired: boolean };

export default function SATrials() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [baseDomain, setBaseDomain] = useState("cubexenterprises.com");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [confirmDel, setConfirmDel] = useState<Trial | null>(null);

  async function load() {
    try { const d = await fetch("/api/superadmin/trials").then((r) => r.json()); if (d.ok) { setTrials(d.trials || []); setBaseDomain(d.baseDomain || "cubexenterprises.com"); } } catch {}
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, body: any, ok?: string) {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/outsource/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Failed"); return false; }
    if (ok) setMsg(ok);
    load();
    return true;
  }
  const extend = (t: Trial, days: number) => act(t.id, { action: "updateSub", status: "TRIALING", endsAt: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }, `Extended ${t.name} by ${days} days`);
  const convert = (t: Trial) => act(t.id, { action: "updateSub", status: "ACTIVE", endsAt: null }, `${t.name} converted to paid`);
  const seed = (t: Trial) => act(t.id, { action: "seedDemo" }, `Seeded demo data for ${t.name}`);
  async function welcome(t: Trial) {
    const to = window.prompt(`Send the demo welcome email for ${t.name} to:`, "");
    if (!to) return;
    const pw = window.prompt("Admin password to include (sets/locks the login to this, min 6 chars):", "");
    if (!pw) return;
    if (pw.length < 6) { setErr("Password must be at least 6 characters"); return; }
    await act(t.id, { action: "sendWelcome", to: to.trim(), password: pw }, `Welcome email sent to ${to.trim()}`);
  }

  const urlFor = (t: Trial) => "https://" + (t.customDomain || `${t.subdomain}.${baseDomain}`);

  return (<div className="max-w-5xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">Demo Trials</h1><p className="text-sm text-gray-500">All tenants on a trial — extend, convert to paid, seed demo data, or delete.</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}{msg && <div className="text-sm text-green-600">{msg}</div>}

    <div className="ui-card bg-white p-0" style={{ borderColor: "#e2e8f0", overflow: "hidden" }}>
      {trials.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No active trials. Start one from Tenants → Subscription → “Start 30-day trial”.</div> : (
        <div className="divide-y" style={{ borderColor: "#e2e8f0" }}>
          {trials.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 p-3" style={{ borderColor: "#e2e8f0" }}>
              <div className="min-w-[180px] flex-1">
                <div className="font-semibold">{t.name}</div>
                <a href={urlFor(t)} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">{urlFor(t).replace("https://", "")}</a>
                <div className="text-[11px] text-gray-400">{t.clients} client{t.clients === 1 ? "" : "s"} · {t.plan}</div>
              </div>
              <div className="text-center">
                {t.expired
                  ? <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "rgba(246,70,93,.16)", color: "#f6465d" }}>Expired</span>
                  : <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: (t.daysLeft ?? 99) <= 5 ? "rgba(234,179,8,.18)" : "rgba(22,199,154,.16)", color: (t.daysLeft ?? 99) <= 5 ? "#b45309" : "#0f9d77" }}>{t.daysLeft} days left</span>}
                {t.endsAt && <div className="mt-1 text-[10px] text-gray-400">ends {new Date(t.endsAt).toLocaleDateString()}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => welcome(t)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#2563eb", color: "#2563eb" }}><i className="fa-solid fa-envelope mr-1" />Welcome</button>
                <button onClick={() => extend(t, 30)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#cbd5e1" }}>+30d</button>
                <button onClick={() => seed(t)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#cbd5e1" }}>Seed data</button>
                <button onClick={() => convert(t)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#16a34a", color: "#16a34a" }}>Convert</button>
                <button onClick={() => setConfirmDel(t)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#fca5a5", color: "#dc2626" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {confirmDel && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
      <div className="ui-card ui-pop w-[380px] bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold text-red-600">Delete demo tenant?</div>
        <div className="mb-3 text-xs text-gray-500">{confirmDel.name} and all its clients/data will be permanently removed. This cannot be undone.</div>
        <div className="flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#dc2626", borderColor: "transparent" }} onClick={() => { act(confirmDel.id, { action: "delete" }, "Demo deleted"); setConfirmDel(null); }}>Delete</button></div>
      </div>
    </div>)}
  </div>);
}
