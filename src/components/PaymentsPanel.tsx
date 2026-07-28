"use client";
import { useEffect, useState } from "react";
import { BUY, SELL, GOLD } from "@/config/theme";
import { useDialog } from "@/components/ui/ConfirmDialog";

export default function PaymentsPanel() {
  const { confirm, node } = useDialog();
  const [list, setList] = useState<any[]>([]);
  const [status, setStatus] = useState("ALL");
  const [kindF, setKindF] = useState("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [expand, setExpand] = useState("");
  // Settlement date modal for approving CREDIT_REQUEST
  const [settleModal, setSettleModal] = useState<{ p: any; settleFrom: string; settleTo: string } | null>(null);

  async function load() {
    const r = await fetch("/api/admin/payments").then((x) => x.json()).catch(() => ({ ok: false }));
    if (r.ok) setList(r.payments || r.requests || []);
  }
  useEffect(() => { load(); }, []);

  function g(p: any, keys: string[], d: any) { for (const k of keys) { if (p[k] != null && p[k] !== "") return p[k]; } return d; }
  function name(p: any) { return g(p, ["clientName", "client", "accountName", "name"], (p.account && p.account.name) || "-"); }
  function login(p: any) { return (p.account && p.account.login) || g(p, ["accountLogin", "login"], ""); }
  function acctType(p: any) { return String((p.account && p.account.type) || g(p, ["accountType"], "")).toUpperCase(); }
  function kind(p: any) { return String(g(p, ["kind", "type", "direction"], "")).toUpperCase(); }
  function method(p: any) { return g(p, ["method", "channel", "gateway", "network"], ""); }
  function slip(p: any) { return g(p, ["slipUrl", "proofUrl", "slip", "receiptUrl"], ""); }
  function st(p: any) { return String(g(p, ["status", "state"], "PENDING")).toUpperCase(); }
  function when(p: any) { const v = g(p, ["createdAt", "date", "requestedAt", "created"], null); return v ? new Date(v).toLocaleString() : ""; }
  function isOut(p: any) { const k = kind(p); return /out|withdraw|debit/i.test(k) && k !== "CREDIT_REQUEST" && k !== "CREDIT_CLEAR"; }
  function kindLabel(p: any) {
    const k = kind(p);
    if (k === "CREDIT_REQUEST") return "Instant Credit Request";
    if (k === "CREDIT_CLEAR") return "Credit Clearance";
    if (k === "DEPOSIT") return "Deposit";
    if (k === "WITHDRAWAL") return "Withdrawal";
    return k;
  }
  function details(p: any) { const d = g(p, ["details", "destination", "meta"], null); if (!d) return null; if (typeof d === "string") { try { return JSON.parse(d); } catch { return { Info: d }; } } return d; }

  async function act(p: any, action: string, extra?: Record<string, string>) {
    setBusy(p.id + action); setErr("");
    const r = await fetch("/api/admin/payments/" + p.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy("");
    if (!r.ok) { setErr(r.error || "Failed"); return; }
    load();
  }

  function tryApprove(p: any) {
    if (kind(p) === "CREDIT_REQUEST") {
      setSettleModal({ p, settleFrom: "", settleTo: "" });
    } else {
      act(p, "approve");
    }
  }

  async function confirmSettle() {
    if (!settleModal) return;
    await act(settleModal.p, "approve", {
      settleFrom: settleModal.settleFrom || "",
      settleTo: settleModal.settleTo || "",
    });
    setSettleModal(null);
  }

  async function del(id: string) {
    setBusy(id + "del"); setErr("");
    const r = await fetch("/api/admin/payments/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete" }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy("");
    if (!r.ok) { setErr(r.error || "Delete failed"); return false; }
    return true;
  }
  async function delOne(id: string) { if (!(await confirm({ title: "Delete request", message: "Delete this payment request?", danger: true }))) return; if (await del(id)) load(); }
  async function bulkDelete() {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length || !(await confirm({ title: "Delete requests", message: "Delete " + ids.length + " request(s)?", danger: true }))) return;
    for (const id of ids) { await del(id); }
    setSel({}); load();
  }

  const tabs = ["PENDING", "APPROVED", "REJECTED", "ALL"];
  const rows = list
    .filter((p) => (status === "ALL" || st(p) === status))
    .filter((p) => (kindF === "ALL" || (kindF === "CREDIT" ? (kind(p) === "CREDIT_REQUEST" || kind(p) === "CREDIT_CLEAR") : kindF === "OUT" ? isOut(p) : !isOut(p) && kind(p) !== "CREDIT_REQUEST" && kind(p) !== "CREDIT_CLEAR")))
    .filter((p) => (name(p) + " " + login(p)).toLowerCase().includes(q.toLowerCase()));
  const selCount = Object.keys(sel).filter((k) => sel[k]).length;
  const allOn = rows.length > 0 && rows.every((p) => sel[p.id]);
  function toggleAll() { if (allOn) setSel({}); else { const n: Record<string, boolean> = {}; rows.forEach((p) => (n[p.id] = true)); setSel(n); } }
  const chip = (active: boolean) => "ui-transition rounded-md px-2.5 py-1 text-[10px] " + (active ? "" : "text-[var(--muted)]");
  const badge = (s: string) => ({ background: s === "APPROVED" ? "rgba(38,166,154,0.18)" : s === "REJECTED" ? "rgba(239,83,80,0.18)" : "rgba(240,180,41,0.18)", color: s === "APPROVED" ? BUY : s === "REJECTED" ? SELL : GOLD });
  const creditColor = "#a855f7";
  const th = "px-2 py-1 text-left font-normal text-[var(--muted)]";
  const td = "px-2 py-1";
  const inp = "ui-input w-full px-2 py-1 text-xs";
  const flab = "mb-0.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide";

  return (
    <div className="flex h-full flex-col text-[10px]">
      {node}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-1 py-1">
        {tabs.map((t) => <button key={t} onClick={() => setStatus(t)} className={chip(status === t)} style={status === t ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)" }}>{t[0] + t.slice(1).toLowerCase()}</button>)}
        <select value={kindF} onChange={(e) => setKindF(e.target.value)} className="ui-input !rounded-md bg-[var(--bg)] px-1.5 py-1 text-[var(--text)]">
          <option value="ALL">All Kinds</option>
          <option value="IN">Deposits</option>
          <option value="OUT">Withdrawals</option>
          <option value="CREDIT">Credit</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="ui-input !rounded-md ml-auto w-28 bg-[var(--bg)] px-2 py-1 text-[var(--text)]" />
        <button onClick={load} className="ui-btn !rounded-md px-2.5 py-1">Refresh</button>
      </div>
      {selCount > 0 && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--soft)] px-2 py-1">
          <span>{selCount} selected</span>
          <button onClick={bulkDelete} className="ui-btn px-2 py-0.5" style={{ background: SELL, color: "#1a0606" }}>Delete Selected</button>
          <button onClick={() => setSel({})} className="ui-btn px-2 py-0.5">Clear</button>
        </div>
      )}
      {err && <div className="px-2 py-1" style={{ color: SELL }}>{err}</div>}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead><tr className="border-b border-[var(--border)]">
            <th className={th}><input type="checkbox" checked={allOn} onChange={toggleAll} /></th>
            <th className={th}></th>
            <th className={th}>Client</th><th className={th}>Account ID</th><th className={th}>Kind</th>
            <th className={th + " text-right"}>Amount</th><th className={th}>Method / Note</th><th className={th}>Date / Time</th>
            <th className={th}>Status</th><th className={th + " text-right"}>Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={10}>No payment requests.</td></tr> : rows.map((p) => {
              const d = details(p); const open = expand === p.id;
              const isCredit = kind(p) === "CREDIT_REQUEST" || kind(p) === "CREDIT_CLEAR";
              return [
                <tr key={p.id} className="ui-row border-b border-[var(--border)]">
                  <td className={td}><input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel((s) => ({ ...s, [p.id]: e.target.checked }))} /></td>
                  <td className={td}>{d ? <button onClick={() => setExpand(open ? "" : p.id)} className="text-[var(--muted)]">{open ? "▾" : "▸"}</button> : null}</td>
                  <td className={td + " font-medium"}>{name(p)}</td>
                  <td className={td + " text-[var(--muted)]"}>
                    <span className="font-medium text-[var(--text)]">{login(p) || "-"}</span>
                    {acctType(p) ? <span className="ml-1.5 rounded px-1 py-0.5 text-[8px] font-semibold" style={acctType(p) === "DEMO" ? { background: "rgba(155,89,182,0.18)", color: "#b07cd6" } : { background: "rgba(38,166,154,0.18)", color: BUY }}>{acctType(p)}</span> : null}
                  </td>
                  <td className={td} style={{ color: isCredit ? creditColor : isOut(p) ? SELL : BUY }}>
                    <span>{kindLabel(p)}</span>
                  </td>
                  <td className={td + " text-right"} style={{ color: isOut(p) ? SELL : BUY }}>
                    {(isOut(p) ? "-" : "+") + "$" + Number(g(p, ["amount"], 0)).toFixed(2)}
                  </td>
                  <td className={td + " max-w-[140px] truncate text-[var(--muted)]"}>{method(p) || g(p, ["note"], "")}</td>
                  <td className={td + " text-[var(--muted)]"}>{when(p)}</td>
                  <td className={td}><span className="rounded-full px-1.5 py-0.5 text-[9px]" style={badge(st(p))}>{st(p)}</span></td>
                  <td className={td}>
                    <div className="flex items-center justify-end gap-1">
                      {slip(p) ? <button onClick={() => setView("/api/files/slip/" + g(p, ["id"], ""))} className="ui-btn px-2 py-0.5 text-[9px]">Slip</button> : null}
                      {st(p) === "PENDING" && (<>
                        <button disabled={!!busy} onClick={() => tryApprove(p)} className="ui-btn px-2 py-0.5 text-[9px]" style={{ background: BUY, color: "#04140e" }}>Approve</button>
                        <button disabled={!!busy} onClick={() => act(p, "reject")} className="ui-btn px-2 py-0.5 text-[9px]" style={{ background: SELL, color: "#1a0606" }}>Reject</button>
                      </>)}
                      <button disabled={!!busy} onClick={() => delOne(p.id)} className="ui-btn px-1.5 py-0.5 text-[9px]" style={{ color: SELL }}>Del</button>
                    </div>
                  </td>
                </tr>,
                open && d ? (
                  <tr key={p.id + "x"} style={{ background: "var(--bg)" }}>
                    <td colSpan={10} className="px-6 py-2 text-[var(--muted)]">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">{Object.entries(d as Record<string, any>).map(([k, v]) => <span key={k}><b className="text-[var(--text)]">{k}:</b> {String(v)}</span>)}</div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Settlement dates modal for CREDIT_REQUEST approval */}
      {settleModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop w-80 rounded-xl border p-4 shadow-2xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold">Approve Instant Credit</div>
              <button onClick={() => setSettleModal(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="mb-3 text-[11px] text-[var(--muted)]">
              Approving credit of <b className="text-[var(--text)]">${Number(settleModal.p.amount).toFixed(2)}</b> for <b className="text-[var(--text)]">{login(settleModal.p) || name(settleModal.p)}</b>. Optionally set a settlement period.
            </div>
            <div className="space-y-2">
              <div><div className={flab}>Settlement From (optional)</div><input type="date" className={inp} value={settleModal.settleFrom} onChange={(e) => setSettleModal({ ...settleModal, settleFrom: e.target.value })} /></div>
              <div><div className={flab}>Settlement To / Due Date (optional)</div><input type="date" className={inp} value={settleModal.settleTo} onChange={(e) => setSettleModal({ ...settleModal, settleTo: e.target.value })} /></div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setSettleModal(null)} className="flex-1 rounded border py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button onClick={confirmSettle} disabled={!!busy} className="flex-1 rounded py-1.5 text-xs font-semibold text-white" style={{ background: BUY }}>
                <i className="fa-solid fa-check mr-1" />{busy ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.8)" }}>
          <button onClick={() => setView("")} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg text-white transition-colors duration-200 hover:bg-white/30"><i className="fa-solid fa-xmark" /></button>
          <img src={view} alt="slip" className="ui-pop max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
