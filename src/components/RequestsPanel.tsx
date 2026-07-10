"use client";
import { useEffect, useState } from "react";
import { BUY, SELL, GOLD } from "@/config/theme";
import { useDialog } from "@/components/ui/ConfirmDialog";

// Tenant-admin review of clients' additional-live-account requests.
export default function RequestsPanel() {
  const { confirm, prompt, node } = useDialog();
  const [list, setList] = useState<any[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch("/api/admin/account-requests").then((x) => x.json()).catch(() => ({ ok: false }));
    if (r.ok) setList(r.requests || []);
  }
  useEffect(() => { load(); }, []);

  async function act(p: any, action: string, note?: string) {
    setBusy(p.id + action); setErr("");
    const r = await fetch("/api/admin/account-requests/" + p.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy("");
    if (!r.ok) { setErr(r.error || "Failed"); return; }
    load();
  }
  async function approve(p: any) {
    if (!(await confirm({ title: "Approve account", message: `Create a new ${p.currency} live account for ${p.name}? This uses one package seat.` }))) return;
    act(p, "approve");
  }
  async function reject(p: any) {
    const note = await prompt({ title: "Decline request", message: `Reason for declining ${p.name}'s request (optional — shown to the client):`, placeholder: "e.g. Reached your plan's account limit" });
    if (note === null) return; // cancelled
    act(p, "reject", note || "");
  }

  const tabs = ["PENDING", "APPROVED", "REJECTED", "ALL"];
  const when = (v: any) => (v ? new Date(v).toLocaleString() : "");
  const rows = list
    .filter((p) => (status === "ALL" || String(p.status).toUpperCase() === status))
    .filter((p) => (p.name + " " + p.login + " " + p.email).toLowerCase().includes(q.toLowerCase()));
  const pendCount = list.filter((p) => p.status === "PENDING").length;
  const chip = (active: boolean) => "ui-transition rounded-md px-2.5 py-1 text-[10px] " + (active ? "" : "text-[var(--muted)]");
  const badge = (s: string) => ({ background: s === "APPROVED" ? "rgba(38,166,154,0.18)" : s === "REJECTED" ? "rgba(239,83,80,0.18)" : "rgba(240,180,41,0.18)", color: s === "APPROVED" ? BUY : s === "REJECTED" ? SELL : GOLD });
  const th = "px-2 py-1 text-left font-normal text-[var(--muted)]";
  const td = "px-2 py-1";

  return (
    <div className="flex h-full flex-col text-[10px]">
      {node}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-1 py-1">
        {tabs.map((t) => <button key={t} onClick={() => setStatus(t)} className={chip(status === t)} style={status === t ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)" }}>{t[0] + t.slice(1).toLowerCase()}{t === "PENDING" && pendCount > 0 ? ` (${pendCount})` : ""}</button>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="ui-input !rounded-md ml-auto w-28 bg-[var(--bg)] px-2 py-1 text-[var(--text)]" />
        <button onClick={load} className="ui-btn !rounded-md px-2.5 py-1">Refresh</button>
      </div>
      {err && <div className="px-2 py-1" style={{ color: SELL }}>{err}</div>}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead><tr className="border-b border-[var(--border)]">
            <th className={th}>Client</th><th className={th}>Primary ID</th><th className={th}>Wants</th>
            <th className={th}>Leverage</th><th className={th}>Requested</th>
            <th className={th}>Status</th><th className={th + " text-right"}>Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={7}>No account requests.</td></tr> : rows.map((p) => (
              <tr key={p.id} className="ui-row border-b border-[var(--border)]">
                <td className={td + " font-medium"}>
                  {p.name && p.name !== "—" ? p.name : <span className="text-[var(--muted)] italic">Deleted account</span>}
                  {p.email ? <span className="ml-1.5 text-[var(--muted)]">{p.email}</span> : null}
                </td>
                <td className={td + " text-[var(--muted)]"}><span className="font-medium text-[var(--text)]">{p.login || "-"}</span></td>
                <td className={td}><span className="rounded px-1 py-0.5 text-[8px] font-semibold" style={{ background: "rgba(38,166,154,0.18)", color: BUY }}>{p.type}</span> <span className="text-[var(--muted)]">{p.currency}</span></td>
                <td className={td + " text-[var(--muted)]"}>1:{p.leverage}</td>
                <td className={td + " text-[var(--muted)]"}>{when(p.createdAt)}</td>
                <td className={td}><span className="rounded-full px-1.5 py-0.5 text-[9px]" style={badge(String(p.status).toUpperCase())}>{p.status}</span></td>
                <td className={td}>
                  <div className="flex items-center justify-end gap-1">
                    {p.status === "PENDING" ? (<>
                      <button disabled={!!busy} onClick={() => approve(p)} className="ui-btn px-2 py-0.5 text-[9px]" style={{ background: BUY, color: "#04140e" }}>Approve</button>
                      <button disabled={!!busy} onClick={() => reject(p)} className="ui-btn px-2 py-0.5 text-[9px]" style={{ background: SELL, color: "#1a0606" }}>Decline</button>
                    </>) : (
                      <span className="text-[var(--muted)]">{p.reviewedBy ? "by " + p.reviewedBy : ""}{p.note ? " — " + p.note : ""}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
