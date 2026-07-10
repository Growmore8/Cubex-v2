"use client";
import { useEffect, useState } from "react";
import { BUY, SELL, GOLD } from "@/config/theme";

function fmtDt(d: string | Date) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " " + dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ReferralPanel() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState("");
  const [err, setErr]         = useState("");
  const [cfg, setCfg]         = useState({ signupBonus: 0, depositPercent: 0, tradingPercent: 0, minDepositForSignup: 0 });
  const [q, setQ]             = useState("");
  const [view, setView]       = useState<"summary" | "all">("summary");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/referral").then((x) => x.json()).catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok) {
      setData(r);
      setCfg({
        signupBonus:         r.config.signupBonus         || 0,
        depositPercent:      r.config.depositPercent      || 0,
        tradingPercent:      r.config.tradingPercent      || 0,
        minDepositForSignup: r.config.minDepositForSignup || 0,
      });
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setMsg(""); setErr("");
    const r = await fetch("/api/admin/referral", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).then((x) => x.json()).catch(() => ({ ok: false }));
    setSaving(false);
    if (r.ok) { setMsg("Saved"); setTimeout(() => setMsg(""), 3000); load(); }
    else setErr(r.error || "Failed to save");
  }

  const inp = "rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)] w-20 tabular-nums";

  const referrals: any[] = data?.referrals || [];

  // Summary: group by referrer
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
    return (r.referrerName || "").toLowerCase().includes(lq)
      || (r.referrerEmail || "").toLowerCase().includes(lq)
      || (r.refereeName   || "").toLowerCase().includes(lq)
      || (r.refereeEmail  || "").toLowerCase().includes(lq);
  });

  const th = "px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
  const td = "px-2 py-1.5 align-middle";

  return (
    <div className="flex h-full flex-col text-[11px]">

      {/* ── Compact config bar ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] bg-[var(--soft)] px-3 py-2">
        <span className="text-[9px] font-bold uppercase tracking-widest shrink-0" style={{ color: "var(--muted)" }}>Reward Config</span>

        <label className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold whitespace-nowrap" style={{ color: "var(--muted)" }}>Signup ($)</span>
          <input className={inp} type="number" min={0} step={1}
            value={cfg.signupBonus}
            onChange={(e) => setCfg({ ...cfg, signupBonus: Number(e.target.value) })} />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold whitespace-nowrap" style={{ color: "var(--muted)" }}>Deposit (%)</span>
          <input className={inp} type="number" min={0} step={0.1}
            value={cfg.depositPercent}
            onChange={(e) => setCfg({ ...cfg, depositPercent: Number(e.target.value) })} />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold whitespace-nowrap" style={{ color: "var(--muted)" }}>Min Deposit ($)</span>
          <input className={inp} type="number" min={0} step={1}
            value={cfg.minDepositForSignup}
            onChange={(e) => setCfg({ ...cfg, minDepositForSignup: Number(e.target.value) })} />
        </label>

        <button onClick={save} disabled={saving}
          className="rounded-lg px-3 py-1 text-[11px] font-semibold text-white shrink-0"
          style={{ background: BUY, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save"}
        </button>

        {msg && <span className="text-[11px] font-semibold" style={{ color: BUY }}>{msg}</span>}
        {err && <span className="text-[11px]" style={{ color: SELL }}>{err}</span>}

        <i className="fa-solid fa-circle-info ml-auto shrink-0 text-[11px]" style={{ color: "var(--muted)" }}
          title="Signup bonus paid once on the referee's first qualifying deposit. Deposit bonus paid on every approved deposit." />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
        {(["summary", "all"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className="rounded px-2 py-0.5 capitalize"
            style={view === v
              ? { background: "var(--accent)", color: "#fff" }
              : { border: "1px solid var(--border)", color: "var(--muted)" }}>
            {v === "summary" ? "Summary" : "All Referrals"}
          </button>
        ))}
        <span style={{ color: "var(--muted)" }}>{referrals.length} total</span>
        {view === "all" && (
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search referrer / referee…"
            className="ml-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text)]"
            style={{ width: 180 }} />
        )}
        <button onClick={load} className="ml-auto rounded border border-[var(--border)] px-2 py-0.5" style={{ color: "var(--muted)" }}>
          Refresh
        </button>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center" style={{ color: "var(--muted)" }}>
            <i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…
          </div>

        ) : view === "summary" ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Referrer</th>
                <th className={th}>Email</th>
                <th className={th + " text-right"}>Referrals</th>
                <th className={th + " text-right"}>Total Earned</th>
                {/* Last Referred = date of most recent referee this person brought in */}
                <th className={th}>Last Referred</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 ? (
                <tr><td className="px-2 py-6 text-center text-[var(--muted)]" colSpan={5}>
                  No referrals yet.
                </td></tr>
              ) : (summaryRows as any[]).map((r: any, i: number) => (
                <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                  <td className={td + " font-medium"}>{r.name || "—"}</td>
                  <td className={td} style={{ color: "var(--muted)" }}>{r.email || "—"}</td>
                  <td className={td + " text-right font-semibold"} style={{ color: "var(--accent)" }}>{r.count}</td>
                  <td className={td + " text-right font-bold tabular-nums"} style={{ color: r.earned > 0 ? BUY : "var(--muted)" }}>
                    ${Number(r.earned).toFixed(2)}
                  </td>
                  <td className={td + " tabular-nums"} style={{ color: "var(--muted)", fontSize: 10 }}>
                    {r.latest ? fmtDt(r.latest) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Referrer</th>
                <th className={th}>Referee</th>
                <th className={th}>Type</th>
                <th className={th + " text-right"}>Earned</th>
                <th className={th}>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredAll.length === 0 ? (
                <tr><td className="px-2 py-6 text-center text-[var(--muted)]" colSpan={5}>No referrals found.</td></tr>
              ) : filteredAll.map((r: any) => {
                const depositEarned = Number(r.totalEarned) - (r.signupBonusPaid ? cfg.signupBonus : 0);
                const hasDeposit    = depositEarned > 0.001;
                return (
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                    {/* Referrer */}
                    <td className={td}>
                      <div className="font-medium">{r.referrerName || "—"}</div>
                      <div className="text-[9px]" style={{ color: "var(--muted)" }}>{r.referrerEmail || ""}</div>
                    </td>
                    {/* Referee — who was referred */}
                    <td className={td}>
                      <div className="font-medium">{r.refereeName || "—"}</div>
                      <div className="text-[9px]" style={{ color: "var(--muted)" }}>{r.refereeEmail || ""}</div>
                    </td>
                    {/* Type badges */}
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.signupBonusPaid && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{ background: BUY + "22", color: BUY }}>
                            Signup
                          </span>
                        )}
                        {hasDeposit && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{ background: GOLD + "22", color: GOLD }}>
                            Deposit
                          </span>
                        )}
                        {!r.signupBonusPaid && !hasDeposit && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px]"
                            style={{ background: "var(--soft)", color: "var(--muted)" }}>
                            Pending
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Earned */}
                    <td className={td + " text-right font-bold tabular-nums"}
                      style={{ color: Number(r.totalEarned) > 0 ? BUY : "var(--muted)" }}>
                      ${Number(r.totalEarned).toFixed(2)}
                    </td>
                    {/* Date & time */}
                    <td className={td + " tabular-nums"} style={{ color: "var(--muted)", fontSize: 10 }}>
                      {fmtDt(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
