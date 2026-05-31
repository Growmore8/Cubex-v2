"use client";
import { useEffect, useState } from "react";
import { BUY, SELL, GOLD } from "@/config/theme";

export default function KycPanel() {
  const [list, setList] = useState<any[]>([]);
  const [status, setStatus] = useState("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState("");

  async function load() {
    const r = await fetch("/api/admin/kyc").then((x) => x.json()).catch(() => ({ ok: false }));
    if (r.ok) setList(r.documents || r.kyc || []);
  }
  useEffect(() => { load(); }, []);

  function g(p: any, keys: string[], d: any) { for (const k of keys) { if (p[k] != null && p[k] !== "") return p[k]; } return d; }
  function name(p: any) { return g(p, ["name", "clientName", "accountName"], (p.account && p.account.name) || "-"); }
  function login(p: any) { return g(p, ["accountLogin", "login", "accountId"], (p.account && p.account.login) || ""); }
  function email(p: any) { return g(p, ["email"], (p.account && p.account.email) || ""); }
  function docType(p: any) { return g(p, ["docType", "type", "documentType"], "ID"); }
  function st(p: any) { return String(g(p, ["status", "state"], "PENDING")).toUpperCase(); }
  function front(p: any) { return g(p, ["frontUrl", "front", "fileFront", "documentFront", "fileUrl", "url", "imageUrl"], ""); }
  function back(p: any) { return g(p, ["backUrl", "back", "fileBack", "documentBack"], ""); }
  function when(p: any) { const v = g(p, ["createdAt", "date", "submittedAt", "created"], null); return v ? new Date(v).toLocaleString() : ""; }
  function reviewed(p: any) { const v = g(p, ["reviewedAt", "updatedAt"], null); return v ? new Date(v).toLocaleDateString() : ""; }

  async function act(p: any, action: string) {
    setBusy(p.id + action); setErr("");
    const r = await fetch("/api/admin/kyc/" + p.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy("");
    if (!r.ok) { setErr(r.error || "Failed"); return; }
    load();
  }

  const tabs = ["PENDING", "APPROVED", "REJECTED", "ALL"];
  const rows = list.filter((p) => (status === "ALL" || st(p) === status)).filter((p) => (name(p) + " " + login(p) + " " + email(p)).toLowerCase().includes(q.toLowerCase()));
  const chip = (active: boolean) => "rounded px-2 py-0.5 text-[10px] " + (active ? "" : "text-[var(--muted)]");
  const badge = (s: string) => ({ background: s === "APPROVED" ? "rgba(38,166,154,0.18)" : s === "REJECTED" ? "rgba(239,83,80,0.18)" : "rgba(240,180,41,0.18)", color: s === "APPROVED" ? BUY : s === "REJECTED" ? SELL : GOLD });
  const th = "px-2 py-1 text-left font-normal text-[var(--muted)]";
  const td = "px-2 py-1";
  const eye = "rounded border border-[var(--border)] px-2 py-0.5 text-[9px]";

  return (
    <div className="flex h-full flex-col text-[10px]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-1 py-1">
        {tabs.map((t) => <button key={t} onClick={() => setStatus(t)} className={chip(status === t)} style={status === t ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)" }}>{t[0] + t.slice(1).toLowerCase()}</button>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / email / account" className="ml-auto w-44 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[var(--text)]" />
        <button onClick={load} className="rounded border border-[var(--border)] px-2 py-0.5">Refresh</button>
      </div>
      {err && <div className="px-2 py-1" style={{ color: SELL }}>{err}</div>}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead><tr className="border-b border-[var(--border)]">
            <th className={th}>#</th><th className={th}>Date</th><th className={th}>Account ID</th><th className={th}>Name</th>
            <th className={th}>Email</th><th className={th}>Doc Type</th><th className={th}>Front</th><th className={th}>Back</th>
            <th className={th}>Status</th><th className={th + " text-right"}>Action</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={10}>No KYC submissions.</td></tr> : rows.map((p, i) => (
              <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                <td className={td + " text-[var(--muted)]"}>{i + 1}</td>
                <td className={td + " text-[var(--muted)]"}>{when(p)}</td>
                <td className={td + " font-medium"}>{login(p)}</td>
                <td className={td}>{name(p)}</td>
                <td className={td + " text-[var(--muted)]"}>{email(p)}</td>
                <td className={td}>{docType(p)}</td>
                <td className={td}>{front(p) ? <button onClick={() => setView(front(p))} className={eye}>View</button> : <span className="text-[var(--muted)]">-</span>}</td>
                <td className={td}>{back(p) ? <button onClick={() => setView(back(p))} className={eye}>View</button> : <span className="text-[var(--muted)]">-</span>}</td>
                <td className={td}><span className="rounded px-1.5 py-0.5 text-[9px]" style={badge(st(p))}>{st(p)}</span></td>
                <td className={td}>
                  <div className="flex items-center justify-end gap-1">
                    {st(p) === "PENDING" ? (<>
                      <button disabled={!!busy} onClick={() => act(p, "approve")} className="rounded px-2 py-0.5 text-[9px]" style={{ background: BUY, color: "#04140e" }}>Approve</button>
                      <button disabled={!!busy} onClick={() => act(p, "reject")} className="rounded px-2 py-0.5 text-[9px]" style={{ background: SELL, color: "#1a0606" }}>Reject</button>
                    </>) : <span className="text-[var(--muted)]">{reviewed(p)}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => setView("")}>
          <img src={view} alt="document" className="max-h-full max-w-full rounded" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}