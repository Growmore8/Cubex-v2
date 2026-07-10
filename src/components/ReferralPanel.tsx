"use client";
import { useEffect, useState } from "react";
import { BUY, SELL, GOLD } from "@/config/theme";

export default function ReferralPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState({ signupBonus: 0, depositPercent: 0, tradingPercent: 0, minDepositForSignup: 0 });
  const [q, setQ] = useState("");
  const [view, setView] = useState<"summary" | "all">("summary");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/referral").then((x) => x.json()).catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok) {
      setData(r);
      setCfg({
        signupBonus: r.config.signupBonus || 0,
        depositPercent: r.config.depositPercent || 0,
        tradingPercent: r.config.tradingPercent || 0,
        minDepositForSignup: r.config.minDepositForSignup || 0,
      });
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setMsg(""); setErr("");
    const r = await fetch("/api/admin/referral", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setSaving(false);
    if (r.ok) { setMsg("Saved."); load(); } else setErr(r.error || "Failed to save");
  }

  const inp = "rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)] w-full";
  const lbl = "text-[9px] font-semibold uppercase tracking-wide mb-0.5 block text-[var(--muted)]";

  // Group referrals by referrer for summary view
  const referrals: any[] = data?.referrals || [];
  const byReferrer = referrals.reduce((acc: any, r: any) => {
    if (!acc[r.referrerId]) acc[r.referrerId] = { name: r.referrerName, email: r.referrerEmail, count: 0, earned: 0, latest: r.createdAt };
    acc[r.referrerId].count++;
    acc[r.referrerId].earned += r.totalEarned;
    if (r.createdAt > acc[r.referrerId].latest) acc[r.referrerId].latest = r.createdAt;
    return acc;
  }, {});
  const summaryRows = Object.values(byReferrer as any).sort((a: any, b: any) => b.earned - a.earned);

  const filteredAll = referrals.filter((r) => {
    if (!q) return true;
    const lq = q.toLowerCase();
    return (r.referrerName || "").toLowerCase().includes(lq) || (r.referrerEmail || "").toLowerCase().includes(lq);
  });

  const th = "px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
  const td = "px-2 py-1.5 align-middle";

  return (
    <div className="flex h-full flex-col text-[10px]">
      {/* Config bar */}
      <div className="border-b border-[var(--border)] bg-[var(--soft)] px-3 py-2.5">
        <div className="mb-1.5 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Reward Configuration</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36">
            <label className={lbl}>Signup Bonus ($)</label>
            <input className={inp} type="number" min={0} step={1} value={cfg.signupBonus} onChange={(e) => setCfg({ ...cfg, signupBonus: Number(e.target.value) })} />
          </div>
          <div className="w-36">
            <label className={lbl}>Deposit Bonus (%)</label>
            <input className={inp} type="number" min={0} step={0.1} value={cfg.depositPercent} onChange={(e) => setCfg({ ...cfg, depositPercent: Number(e.target.value) })} />
          </div>
          <div className="w-36">
            <label className={lbl}>Min Deposit for Signup Bonus ($)</label>
            <input className={inp} type="number" min={0} step={1} value={cfg.minDepositForSignup} onChange={(e) => setCfg({ ...cfg, minDepositForSignup: Number(e.target.value) })} />
          </div>
          <div className="flex items-end gap-2">
            <button onClick={save} disabled={saving} className="rounded-lg px-4 py-1 text-[11px] font-semibold text-white" style={{ background: BUY, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
            {msg && <span className="text-[11px]" style={{ color: BUY }}>{msg}</span>}
            {err && <span className="text-[11px]" style={{ color: SELL }}>{err}</span>}
          </div>
        </div>
        <div className="mt-1.5 text-[9px]" style={{ color: "var(--muted)" }}>
          <i className="fa-solid fa-circle-info mr-1" />
          Signup bonus is paid once when the referred client makes their first qualifying deposit. Deposit bonus is paid on every approved deposit.
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
        <button onClick={() => setView("summary")} className="rounded px-2 py-0.5" style={view === "summary" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Summary</button>
        <button onClick={() => setView("all")} className="rounded px-2 py-0.5" style={view === "all" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>All Referrals</button>
        <span className="text-[var(--muted)]">{referrals.length} total</span>
        {view === "all" && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search referrer…" className="ml-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text)]" style={{ width: 160 }} />}
        <button onClick={load} className="ml-auto rounded border border-[var(--border)] px-2 py-0.5" style={{ color: "var(--muted)" }}>Refresh</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…</div>
        ) : view === "summary" ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Referrer</th>
                <th className={th}>Email</th>
                <th className={th + " text-right"}>Referrals</th>
                <th className={th + " text-right"}>Total Earned</th>
                <th className={th}>Latest Referral</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 ? (
                <tr><td className="px-2 py-4 text-center text-[var(--muted)]" colSpan={5}>No referrals yet. Share the referral link with clients to get started.</td></tr>
              ) : (summaryRows as any[]).map((r: any, i: number) => (
                <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                  <td className={td + " font-medium"}>{r.name || "—"}</td>
                  <td className={td} style={{ color: "var(--muted)" }}>{r.email || "—"}</td>
                  <td className={td + " text-right font-semibold"} style={{ color: "var(--accent)" }}>{r.count}</td>
                  <td className={td + " text-right font-bold tabular-nums"} style={{ color: r.earned > 0 ? BUY : "var(--muted)" }}>${Number(r.earned).toFixed(2)}</td>
                  <td className={td} style={{ color: "var(--muted)" }}>{r.latest ? new Date(r.latest).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Referrer</th>
                <th className={th}>Referrer Email</th>
                <th className={th}>Signup Bonus Paid</th>
                <th className={th + " text-right"}>Earned on This Ref</th>
                <th className={th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {filteredAll.length === 0 ? (
                <tr><td className="px-2 py-4 text-center text-[var(--muted)]" colSpan={5}>No referrals found.</td></tr>
              ) : filteredAll.map((r: any) => (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                  <td className={td + " font-medium"}>{r.referrerName || "—"}</td>
                  <td className={td} style={{ color: "var(--muted)" }}>{r.referrerEmail || "—"}</td>
                  <td className={td}>
                    {r.signupBonusPaid
                      ? <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: BUY + "22", color: BUY }}>Paid</span>
                      : <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: "var(--muted)" }}>Pending</span>}
                  </td>
                  <td className={td + " text-right font-bold tabular-nums"} style={{ color: r.totalEarned > 0 ? BUY : "var(--muted)" }}>${Number(r.totalEarned).toFixed(2)}</td>
                  <td className={td} style={{ color: "var(--muted)" }}>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
