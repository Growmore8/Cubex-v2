"use client";
import { useEffect, useState } from "react";
import CountrySelect from "@/components/ui/CountrySelect";
import { titleCaseName } from "@/lib/format";
import AdjustBalanceDialog from "./AdjustBalanceDialog";

// ── Per-account trading details (lazy-loaded on expand) ───────────────────
function TradingSection({ accountId, m }: { accountId: string; m: (v: number) => string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);

  async function toggle() {
    if (!open && !data) {
      setLoading(true);
      try {
        const r = await fetch("/api/superadmin/clients/" + accountId + "/trading").then((x) => x.json());
        if (r.ok) setData(r);
      } finally { setLoading(false); }
    }
    setOpen((v) => !v);
  }

  const pnlColor = (v: number) => v > 0 ? "#16a34a" : v < 0 ? "#dc2626" : "#6b7280";

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 6 }}>
      <button
        onClick={toggle}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--text2)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", width: "100%" }}
      >
        <i className={"fa-solid fa-chevron-" + (open ? "up" : "down")} style={{ fontSize: 9 }} />
        <i className="fa-solid fa-chart-line" style={{ fontSize: 10, color: "#2563eb" }} />
        Trading Details
        {loading && <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: 9, marginLeft: "auto" }} />}
      </button>

      {open && data && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Financial breakdown */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text2)", marginBottom: 5 }}>Financial Breakdown</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
              {[
                { label: "Deposit",    val: data.financials.deposit,    color: "#16a34a" },
                { label: "Withdrawal", val: -data.financials.withdrawal, color: "#dc2626" },
                { label: "Credit",     val: data.financials.credit,     color: "#2563eb" },
                { label: "Bonus",      val: data.financials.bonus,      color: "#7c3aed" },
                { label: "Insurance",  val: data.financials.insurance,  color: "#0891b2" },
                { label: "Closed PnL", val: data.financials.closedPnl,  color: pnlColor(data.financials.closedPnl) },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 7px" }}>
                  <div style={{ fontSize: 9, color: "var(--text2)", marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color }}>{val >= 0 ? "$" : "-$"}{m(Math.abs(val))}</div>
                </div>
              ))}
            </div>
            {/* Net balance line */}
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", display: "flex", justifyContent: "space-between" }}>
              <span>Net Balance (deposits - withdrawals + credit + bonus + PnL)</span>
              <span style={{ fontWeight: 700, color: "var(--text)" }}>
                ${m(data.financials.deposit - data.financials.withdrawal + data.financials.credit + data.financials.bonus + data.financials.closedPnl)}
              </span>
            </div>
          </div>

          {/* Closed trade stats */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text2)", marginBottom: 5 }}>Closed Trade Stats</div>
            {data.closedStats.count === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text2)", padding: "6px 0" }}>No closed trades.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }}>
                {[
                  { label: "Trades", val: String(data.closedStats.count), color: "var(--text)" },
                  { label: "Total PnL", val: (data.closedStats.totalPnl >= 0 ? "+$" : "-$") + m(Math.abs(data.closedStats.totalPnl)), color: pnlColor(data.closedStats.totalPnl) },
                  { label: "Win Rate", val: data.closedStats.winRate + "%", color: data.closedStats.winRate >= 50 ? "#16a34a" : "#dc2626" },
                  { label: "W / L", val: data.closedStats.wins + " / " + data.closedStats.losses, color: "var(--text)" },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "var(--text2)" }}>{label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 1 }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open trades */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text2)", marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
              Open Positions
              <span style={{ fontWeight: 400, color: "#2563eb" }}>{data.openTrades.length}</span>
            </div>
            {data.openTrades.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text2)", padding: "4px 0" }}>No open trades.</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                    <thead>
                      <tr style={{ background: "var(--bg2)" }}>
                        {["Ticket", "Symbol", "Side", "Lots", "Open @", "SL", "TP"].map((h) => (
                          <th key={h} style={{ padding: "4px 6px", textAlign: "left", fontWeight: 600, color: "var(--text2)", borderBottom: "1px solid var(--border)", fontSize: 9, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllOpen ? data.openTrades : data.openTrades.slice(0, 5)).map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "var(--text2)" }}>{t.ticket}</td>
                          <td style={{ padding: "4px 6px", fontWeight: 600 }}>{t.symbol}</td>
                          <td style={{ padding: "4px 6px", fontWeight: 700, color: t.side === "BUY" ? "#16a34a" : "#dc2626" }}>{t.side}</td>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{t.lots}</td>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{t.openPrice}</td>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "var(--text2)" }}>{t.sl || "—"}</td>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "var(--text2)" }}>{t.tp || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.openTrades.length > 5 && (
                  <button onClick={() => setShowAllOpen((v) => !v)} style={{ marginTop: 4, fontSize: 10, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {showAllOpen ? "Show less" : `Show all ${data.openTrades.length} open trades`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Recent closed trades */}
          {data.recentTrades.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text2)", marginBottom: 5 }}>Recent Closed Trades</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                  <thead>
                    <tr style={{ background: "var(--bg2)" }}>
                      {["Symbol", "Side", "Lots", "Open", "Close", "PnL", "Closed"].map((h) => (
                        <th key={h} style={{ padding: "4px 6px", textAlign: "left", fontWeight: 600, color: "var(--text2)", borderBottom: "1px solid var(--border)", fontSize: 9, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllClosed ? data.recentTrades : data.recentTrades.slice(0, 5)).map((t: any) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "4px 6px", fontWeight: 600 }}>{t.symbol}</td>
                        <td style={{ padding: "4px 6px", fontWeight: 700, color: t.side === "BUY" ? "#16a34a" : "#dc2626" }}>{t.side}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{t.lots}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "var(--text2)" }}>{t.openPrice}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "var(--text2)" }}>{t.closePrice}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "monospace", fontWeight: 700, color: pnlColor(t.pnl) }}>
                          {t.pnl >= 0 ? "+" : ""}{m(t.pnl)}
                        </td>
                        <td style={{ padding: "4px 6px", color: "var(--text2)", fontSize: 9 }}>{t.closedAt ? new Date(t.closedAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.recentTrades.length > 5 && (
                <button onClick={() => setShowAllClosed((v) => !v)} style={{ marginTop: 4, fontSize: 10, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {showAllClosed ? "Show less" : `Show all ${data.recentTrades.length} recent trades`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const BLU = "#2563eb";
const GRN = "#16a34a";
const RED = "#dc2626";
const AMB = "#b45309";

function isCreditLocked(a: any) {
  return !a.locked && !a.deactivated && Number(a.credit || 0) > 0 && a.creditSettleTo && new Date(a.creditSettleTo) < new Date();
}

// ── Account card rendered inside the detail panel ──────────────────────────
function AccountCard({ a, tenants, m, act, openEdit, openMgr, setPwRow, setIdRow, setDelRow, setRepRow, setMoneyRow, setErr }: any) {
  const bs = (bg: string) => ({ background: bg, padding: "3px 8px", borderRadius: 4, border: "1px solid transparent", cursor: "pointer" });
  function kycChip(kyc: string | null, type: string) {
    if (!kyc || type !== "LIVE") return null;
    const cls = kyc === "APPROVED" ? "sab-green" : kyc === "PENDING" ? "sab-amber" : "sab-red";
    return <span className={"sab " + cls} style={{ fontSize: 9 }}>KYC</span>;
  }
  function statusChip(a: any) {
    if (a.deactivated) return <span className="sab sab-amber" style={{ fontSize: 9 }}>Inactive</span>;
    if (a.locked) return <span className="sab sab-red" style={{ fontSize: 9 }}>Admin Lock</span>;
    if (isCreditLocked(a)) return <span className="sab" style={{ fontSize: 9, background: "#7c3aed18", color: "#7c3aed", border: "1px solid #7c3aed40" }}>Credit Lock</span>;
    return <span className="sab sab-green" style={{ fontSize: 9 }}>Active</span>;
  }
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div className="mb-2 flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono font-semibold text-sm" style={{ color: a.type === "LIVE" ? GRN : BLU }}>{a.login}</span>
          {a.isPool && <span className="text-[9px] font-semibold" style={{ color: AMB }}>POOL</span>}
          {kycChip(a.kyc, a.type)}
          {statusChip(a)}
        </div>
        <div className="text-right">
          <div className="font-semibold text-sm">${m(a.balance)}</div>
          {a.company !== "—" && <div className="text-[11px] text-gray-400">{a.company}</div>}
          {a.manager && <div className="text-[11px] text-gray-400"><i className="fa-solid fa-user text-[9px] mr-1" />{a.manager}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <button title="Edit" style={bs("#f1f5f9")} onClick={() => openEdit(a)}><i className="fa-solid fa-pen text-xs" style={{ color: "#475569" }} /></button>
        <button title="Reset Password" style={bs("#fff7ed")} onClick={() => setPwRow(a)}><i className="fa-solid fa-key text-xs" style={{ color: AMB }} /></button>
        <button title="Change Login ID" style={bs("#f1f5f9")} onClick={() => setIdRow(a)}><i className="fa-solid fa-hashtag text-xs" style={{ color: "#7c3aed" }} /></button>
        <button title="Assign Manager" style={bs("#f0fdf4")} onClick={() => openMgr(a)}><i className="fa-solid fa-user-tie text-xs" style={{ color: GRN }} /></button>
        <button title={a.locked ? "Unlock" : "Lock"} style={bs(a.locked ? "#f0fdf4" : "#fff1f2")} onClick={() => act(a.id, a.locked ? "unlock" : "lock")}><i className={"fa-solid text-xs " + (a.locked ? "fa-lock-open" : "fa-lock")} style={{ color: a.locked ? GRN : RED }} /></button>
        <button title={a.deactivated ? "Activate" : "Deactivate"} style={bs("#fff7ed")} onClick={() => act(a.id, a.deactivated ? "activate" : "deactivate")}><i className={"fa-solid text-xs " + (a.deactivated ? "fa-circle-check" : "fa-ban")} style={{ color: AMB }} /></button>
        <button title="Adjust Balance" style={bs("#f0fdf4")} onClick={() => setMoneyRow(a)}><i className="fa-solid fa-coins text-xs" style={{ color: GRN }} /></button>
        <button title="Statement / Report" style={bs("#eff6ff")} onClick={() => setRepRow(a)}><i className="fa-solid fa-file-invoice text-xs" style={{ color: BLU }} /></button>
        {!a.hasUser && (
          <button title="Repair login" style={bs("#fefce8")} onClick={async () => {
            if (!a.email) { alert("Set an email on this account first (Edit), then repair."); return; }
            const pw = window.prompt(`Rebuild login for ${a.email}. Set a new password (min 6 chars):`);
            if (!pw || pw.length < 6) { if (pw !== null) alert("Password must be at least 6 characters."); return; }
            const ok = await act(a.id, "repairLogin", { email: a.email, password: pw });
            if (ok) alert("Login repaired. Client can now sign in with " + a.email);
          }}><i className="fa-solid fa-user-shield text-xs" style={{ color: "#ca8a04" }} /></button>
        )}
        <button title="Delete" style={bs("#fff1f2")} onClick={() => setDelRow(a)}><i className="fa-solid fa-trash text-xs" style={{ color: RED }} /></button>
      </div>
      <TradingSection accountId={a.id} m={m} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function SAClientsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [err, setErr] = useState("");

  // Filters
  const [q, setQ] = useState("");
  const [tenantF, setTenantF] = useState("All");
  const [typeF, setTypeF] = useState("All");
  const [statusF, setStatusF] = useState("All");
  const [kycF, setKycF] = useState("All");
  const [poolF, setPoolF] = useState("All");
  const [onlineF, setOnlineF] = useState("All");
  const [perPage, setPerPage] = useState(30);
  const [page, setPage] = useState(1);

  // Detail panel
  const [detailClient, setDetailClient] = useState<any>(null);

  // Edit modal
  const [editRow, setEditRow] = useState<any>(null);
  const [ef, setEf] = useState<any>({});
  const [efPwShow, setEfPwShow] = useState(false);

  // Quick modals
  const [pwRow, setPwRow] = useState<any>(null);
  const [pwVal, setPwVal] = useState("");
  const [pwShow, setPwShow] = useState(false);
  const [idRow, setIdRow] = useState<any>(null);
  const [idVal, setIdVal] = useState("");
  const [mgrRow, setMgrRow] = useState<any>(null);
  const [mgrTenantMgrs, setMgrTenantMgrs] = useState<any[]>([]);
  const [mgrVal, setMgrVal] = useState("");
  const [delRow, setDelRow] = useState<any>(null);
  const [moneyRow, setMoneyRow] = useState<any>(null);
  const [moneyForm, setMoneyForm] = useState<any>({ type: "DEPOSIT", amount: "", description: "" });
  const [repRow, setRepRow] = useState<any>(null);
  const [repEmail, setRepEmail] = useState("");
  const [repMsg, setRepMsg] = useState("");
  const [repSending, setRepSending] = useState(false);
  const [repPreset, setRepPreset] = useState("all");
  const [repFrom, setRepFrom] = useState("");
  const [repTo, setRepTo] = useState("");
  const repParams = () => { const o: any = { preset: repPreset }; if (repPreset === "custom") { if (repFrom) o.from = repFrom; if (repTo) o.to = repTo; } return o; };

  async function load(keepDetail?: any) {
    try {
      const [cd, td] = await Promise.all([
        fetch("/api/superadmin/clients").then((r) => r.json()),
        fetch("/api/superadmin/outsource").then((r) => r.json()),
      ]);
      if (cd.ok) {
        setRows(cd.clients);
        // Refresh open detail panel
        const panel = keepDetail ?? detailClient;
        if (panel) {
          const updated = cd.clients.find((c: any) => c.userId === panel.userId);
          setDetailClient(updated ?? null);
        }
      }
      if (td.ok) setTenants(td.outsources || []);
    } catch {}
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, action: string, extra: any = {}) {
    setErr("");
    const r = await fetch("/api/superadmin/clients/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return false; }
    load();
    return true;
  }

  function openEdit(acct: any) {
    setErr("");
    setEfPwShow(false);
    setEf({ name: acct.name || "", login: acct.login || "", email: acct.email || "", phone: acct.phone || "", country: acct.country || "", tenantId: acct.tenantId || "", newPw: "" });
    setEditRow(acct);
  }

  async function saveEdit() {
    if (!editRow) return;
    setErr("");
    const id = editRow.id;
    const infoChanged = ef.name !== editRow.name || ef.email !== (editRow.email || "") || ef.phone !== (editRow.phone || "") || ef.country !== (editRow.country || "");
    if (infoChanged) { const ok = await act(id, "rename", { name: ef.name, email: ef.email, phone: ef.phone, country: ef.country }); if (!ok) return; }
    if (ef.login !== editRow.login) { const ok = await act(id, "accountId", { login: ef.login }); if (!ok) return; }
    if (ef.newPw && ef.newPw.length >= 6) { const ok = await act(id, "resetPassword", { password: ef.newPw }); if (!ok) return; }
    if (ef.tenantId !== (editRow.tenantId || "")) { const ok = await act(id, "assignTenant", { tenantId: ef.tenantId || null }); if (!ok) return; }
    setEditRow(null);
  }

  async function openMgr(acct: any) {
    setMgrVal(acct.managerId || "");
    setMgrTenantMgrs([]);
    setMgrRow(acct);
    if (acct.tenantId) {
      try {
        const sd = await fetch("/api/superadmin/staff?role=MANAGER&tenantId=" + acct.tenantId).then((r) => r.json());
        if (sd.ok) setMgrTenantMgrs(sd.staff || sd.users || []);
      } catch {}
    }
  }

  // Client-level filtering
  const filtered = rows.filter((client) => {
    if (tenantF !== "All") {
      if (tenantF === "__own__") { if (!client.accounts.some((a: any) => !a.tenantId)) return false; }
      else { if (!client.accounts.some((a: any) => a.tenantId === tenantF)) return false; }
    }
    if (typeF !== "All" && !client.accounts.some((a: any) => a.type === typeF)) return false;
    if (statusF !== "All") {
      const has = client.accounts.some((a: any) => statusF === "Active" ? (!a.locked && !a.deactivated) : statusF === "Locked" ? a.locked : a.deactivated);
      if (!has) return false;
    }
    if (kycF !== "All" && !client.accounts.some((a: any) => a.type === "LIVE" && (a.kyc || "NONE") === kycF)) return false;
    if (poolF !== "All" && !client.accounts.some((a: any) => poolF === "Pool" ? a.isPool : !a.isPool)) return false;
    if (onlineF === "Online" && !client.isOnline) return false;
    if (onlineF === "Offline" && client.isOnline) return false;
    if (q) {
      const sq = q.toLowerCase();
      if (!((client.name || "").toLowerCase().includes(sq) || (client.email || "").toLowerCase().includes(sq) || (client.phone || "").includes(sq) || client.accounts.some((a: any) => (a.login || "").toLowerCase().includes(sq)))) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safeP = Math.min(Math.max(1, page), totalPages);
  const paged = filtered.slice((safeP - 1) * perPage, safeP * perPage);

  const m = (v: number) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm w-full";
  const sel = "ui-input rounded border px-2 py-1.5 text-sm";

  function clientKyc(client: any): string | null {
    const live = client.accounts.filter((a: any) => a.type === "LIVE");
    if (live.some((a: any) => a.kyc === "APPROVED")) return "APPROVED";
    if (live.some((a: any) => a.kyc === "PENDING")) return "PENDING";
    if (live.some((a: any) => a.kyc === "REJECTED")) return "REJECTED";
    return null;
  }
  function kycText(client: any) {
    const kyc = clientKyc(client);
    const hasLive = client.accounts.some((a: any) => a.type === "LIVE");
    if (kyc === "APPROVED") return <span className="text-xs font-semibold" style={{ color: GRN }}>KYC Verified</span>;
    if (kyc === "PENDING") return <span className="text-xs font-semibold" style={{ color: AMB }}>KYC Pending</span>;
    if (hasLive) return <span className="text-xs font-semibold" style={{ color: RED }}>KYC Required</span>;
    return <span className="text-gray-300 text-xs">—</span>;
  }
  function clientStatusText(client: any) {
    if (client.accounts.some((a: any) => a.locked)) return <span className="text-xs font-semibold" style={{ color: RED }}>Admin Lock</span>;
    if (client.accounts.some((a: any) => isCreditLocked(a))) return <span className="text-xs font-semibold" style={{ color: "#7c3aed" }}>Credit Lock</span>;
    if (client.accounts.some((a: any) => a.deactivated)) return <span className="text-xs font-semibold" style={{ color: AMB }}>Inactive</span>;
    return <span className="text-xs font-semibold" style={{ color: GRN }}>Active</span>;
  }

  // Group actions — run for each account in a group sequentially
  async function actAll(accounts: any[], action: string) {
    for (const a of accounts) {
      await fetch("/api/superadmin/clients/" + a.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    }
    load();
  }

  const demoAccts = (c: any) => c.accounts.filter((a: any) => a.type === "DEMO");
  const liveAccts = (c: any) => c.accounts.filter((a: any) => a.type === "LIVE");

  return (
    <div className="space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">All Clients</h1>
        <p className="text-sm text-gray-500">View all clients across the platform</p>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="ui-card bg-white" style={{ borderColor: "var(--border)" }}>
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="relative min-w-[220px] flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-2.5 text-[11px] text-gray-400" />
            <input className="ui-input w-full rounded border py-1.5 pl-7 pr-2 text-sm" placeholder="Search name, email, phone, login ID…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ borderColor: "var(--border)" }} />
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-medium text-gray-400">TENANT</div>
            <select className={sel} value={tenantF} onChange={(e) => { setTenantF(e.target.value); setPage(1); }} style={{ borderColor: "var(--border)" }}>
              <option value="All">All Tenants</option>
              <option value="__own__">Own (Main Admin)</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
            </select>
          </div>
          {([
            { label: "TYPE", val: typeF, set: setTypeF, opts: [["All","All"],["LIVE","Live"],["DEMO","Demo"]] },
            { label: "STATUS", val: statusF, set: setStatusF, opts: [["All","All"],["Active","Active"],["Locked","Locked"],["Inactive","Inactive"]] },
            { label: "KYC", val: kycF, set: setKycF, opts: [["All","All"],["APPROVED","Approved"],["PENDING","Pending"],["REJECTED","Rejected"],["NONE","None"]] },
            { label: "POOL", val: poolF, set: setPoolF, opts: [["All","All"],["Pool","Pool"],["Non-Pool","Non-Pool"]] },
            { label: "ONLINE", val: onlineF, set: setOnlineF, opts: [["All","All"],["Online","Online"],["Offline","Offline"]] },
          ] as any[]).map(({ label, val, set, opts }) => (
            <div key={label}>
              <div className="mb-0.5 text-[10px] font-medium text-gray-400">{label}</div>
              <select className={sel} value={val} onChange={(e) => { set(e.target.value); setPage(1); }} style={{ borderColor: "var(--border)" }}>
                {opts.map(([v, l]: any) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          <div className="ml-auto">
            <div className="mb-0.5 text-[10px] font-medium text-gray-400">ROWS</div>
            <select className={sel} value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} style={{ borderColor: "var(--border)" }}>
              {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="self-end pb-1.5 text-sm text-gray-500">{filtered.length} clients</div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="sa-table">
            <thead>
              <tr>
                {["CLIENT", "COUNTRY", "TENANT", "DEMO ACCOUNTS", "LIVE ACCOUNTS", "ONLINE", "JOINED", "KYC", "STATUS", ""].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paged.map((client, ci) => {
                const demos = demoAccts(client);
                const lives = liveAccts(client);
                const kyc = clientKyc(client);
                const tenantNames = [...new Set<string>(client.accounts.map((a: any) => a.company).filter((c: string) => c !== "—"))];
                return (
                  <tr key={client.userId || ci} className="cursor-pointer" onClick={() => setDetailClient(client)}>
                    <td className="px-3 py-2.5 max-w-[220px]">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: BLU }}>
                          {(client.name || "?")[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-sm">{titleCaseName(client.name)}</div>
                          {client.email && <div className="truncate text-xs text-gray-400">{client.email}</div>}
                          {client.phone && <div className="text-xs text-gray-400">{client.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-600">{client.country || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-sm">
                      {tenantNames.length > 0
                        ? tenantNames.join(", ")
                        : <span className="text-gray-400 text-xs">Own</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {demos.length === 0 ? <span className="text-gray-300 text-xs">—</span> : (
                        <span className="text-sm text-gray-600">${m(demos.reduce((s: number, a: any) => s + a.balance, 0))}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {lives.length === 0 ? <span className="text-gray-300 text-xs">—</span> : (
                        <div>
                          <div className="text-sm font-medium" style={{ color: GRN }}>{lives.length} Live</div>
                          <div className="text-xs text-gray-500">${m(lives.reduce((s: number, a: any) => s + a.balance, 0))}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={"inline-block h-2.5 w-2.5 rounded-full border-2 " + (client.isOnline ? "bg-green-400 border-green-200" : "bg-gray-300 border-gray-100")} />
                        {client.device && <i className={"fa-solid text-[10px] text-gray-400 " + (String(client.device).toLowerCase() === "mobile" ? "fa-mobile-screen-button" : "fa-laptop")} />}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{new Date(client.joined).toLocaleDateString()}</td>
                    <td className="px-3 py-2.5">{kycText(client)}</td>
                    <td className="px-3 py-2.5">{clientStatusText(client)}</td>
                    <td className="px-3 py-2.5">
                      <button className="rounded border px-2.5 py-1 text-[11px] font-medium hover:bg-blue-50" style={{ borderColor: "#bfdbfe", color: BLU }} onClick={(e) => { e.stopPropagation(); setDetailClient(client); }}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={10}>No clients found.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <span className="text-gray-500">Page {safeP} of {totalPages} · {filtered.length} total</span>
            <div className="flex gap-1">
              <button disabled={safeP <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="ui-btn px-3 py-1 text-xs disabled:opacity-40">Prev</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = safeP <= 3 ? i + 1 : safeP + i - 2;
                if (pg < 1 || pg > totalPages) return null;
                return <button key={pg} onClick={() => setPage(pg)} className={"ui-btn px-3 py-1 text-xs " + (pg === safeP ? "ui-btn-primary" : "")}>{pg}</button>;
              })}
              <button disabled={safeP >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="ui-btn px-3 py-1 text-xs disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── CLIENT DETAIL PANEL ── */}
      {detailClient && (
        <>
          <div className="fixed inset-0 z-[100] bg-black/30" onClick={() => setDetailClient(null)} />
          <div className="fixed right-0 top-0 z-[110] flex h-full w-[500px] max-w-full flex-col overflow-hidden border-l shadow-2xl" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            {/* Panel header */}
            <div className="flex shrink-0 items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: BLU }}>
                {(detailClient.name || "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold">{titleCaseName(detailClient.name)}{kycText(detailClient)}</div>
                {detailClient.email && <div className="truncate text-xs text-gray-500">{detailClient.email}</div>}
              </div>
              <button onClick={() => setDetailClient(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
            </div>

            {/* Panel body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Personal info */}
              <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Personal Info</div>
                <div className="space-y-1.5">
                  {detailClient.phone && <div className="flex items-center gap-2 text-sm"><i className="fa-solid fa-phone w-4 text-center text-gray-400 text-[10px]" />{detailClient.phone}</div>}
                  {detailClient.country && <div className="flex items-center gap-2 text-sm"><i className="fa-solid fa-globe w-4 text-center text-gray-400 text-[10px]" />{detailClient.country}</div>}
                  {detailClient.lastLoginIp && <div className="flex items-center gap-2 text-sm"><i className="fa-solid fa-location-dot w-4 text-center text-gray-400 text-[10px]" /><span className="font-mono text-xs">{detailClient.lastLoginIp}</span></div>}
                  <div className="flex items-center gap-2 text-sm"><i className="fa-solid fa-calendar w-4 text-center text-gray-400 text-[10px]" />Joined {new Date(detailClient.joined).toLocaleDateString()}</div>
                  {detailClient.isOnline && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-green-400 border-green-200" />
                      <span className="font-medium" style={{ color: GRN }}>Online now</span>
                      {detailClient.device && <span className="text-xs text-gray-400">· {detailClient.device}</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary: total balance across all accounts */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Total Demo Balance", val: demoAccts(detailClient).reduce((s: number, a: any) => s + a.balance, 0), color: BLU },
                  { label: "Total Live Balance", val: liveAccts(detailClient).reduce((s: number, a: any) => s + a.balance, 0), color: GRN },
                  { label: "All Accounts", val: detailClient.accounts.length, color: "#6b7280", isCount: true },
                ].map(({ label, val, color, isCount }) => (
                  <div key={label} className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
                    <div className="text-[10px] text-gray-400">{label}</div>
                    <div className="font-semibold text-sm" style={{ color }}>{isCount ? val : "$" + m(val as number)}</div>
                  </div>
                ))}
              </div>

              {/* Demo accounts */}
              {demoAccts(detailClient).length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: BLU }}>Demo Accounts</span>
                      <span className="text-xs text-gray-500">{demoAccts(detailClient).length}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => actAll(demoAccts(detailClient).filter((a: any) => !a.locked), "lock")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#fff1f2", color: RED }}>Lock All</button>
                      <button onClick={() => actAll(demoAccts(detailClient).filter((a: any) => a.locked), "unlock")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#f0fdf4", color: GRN }}>Unlock All</button>
                      <button onClick={() => actAll(demoAccts(detailClient).filter((a: any) => !a.deactivated), "deactivate")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#fff7ed", color: AMB }}>Deactivate All</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {demoAccts(detailClient).map((a: any) => (
                      <AccountCard key={a.id} a={a} tenants={tenants} m={m} act={act} openEdit={openEdit} openMgr={openMgr}
                        setPwRow={(r: any) => { setPwVal(""); setPwShow(false); setPwRow(r); }}
                        setIdRow={(r: any) => { setIdVal(r.login); setIdRow(r); }}
                        setDelRow={setDelRow}
                        setRepRow={(r: any) => { setRepEmail(r.email || ""); setRepMsg(""); setRepRow(r); }}
                        setMoneyRow={(r: any) => { setMoneyForm({ ...r, type: "DEPOSIT", amount: "", description: "" }); setMoneyRow(r); }}
                        setErr={setErr}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Live accounts */}
              {liveAccts(detailClient).length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: GRN }}>Live Accounts</span>
                      <span className="text-xs text-gray-500">{liveAccts(detailClient).length}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => actAll(liveAccts(detailClient).filter((a: any) => !a.locked), "lock")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#fff1f2", color: RED }}>Lock All</button>
                      <button onClick={() => actAll(liveAccts(detailClient).filter((a: any) => a.locked), "unlock")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#f0fdf4", color: GRN }}>Unlock All</button>
                      <button onClick={() => actAll(liveAccts(detailClient).filter((a: any) => !a.deactivated), "deactivate")} className="rounded px-2 py-1 text-[11px] font-medium" style={{ background: "#fff7ed", color: AMB }}>Deactivate All</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {liveAccts(detailClient).map((a: any) => (
                      <AccountCard key={a.id} a={a} tenants={tenants} m={m} act={act} openEdit={openEdit} openMgr={openMgr}
                        setPwRow={(r: any) => { setPwVal(""); setPwShow(false); setPwRow(r); }}
                        setIdRow={(r: any) => { setIdVal(r.login); setIdRow(r); }}
                        setDelRow={setDelRow}
                        setRepRow={(r: any) => { setRepEmail(r.email || ""); setRepMsg(""); setRepRow(r); }}
                        setMoneyRow={(r: any) => { setMoneyForm({ ...r, type: "DEPOSIT", amount: "", description: "" }); setMoneyRow(r); }}
                        setErr={setErr}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── EDIT MODAL ── */}
      {editRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
          <div className="ui-card ui-pop w-[540px] max-h-[90vh] overflow-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-0.5 text-lg font-semibold">Edit Account</div>
            <div className="mb-4 text-xs text-gray-400">Account ID: <span className="font-mono font-semibold text-gray-700">{editRow.login}</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-medium text-gray-500">FULL NAME</label><input className={inp} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">LOGIN ID</label><input className={inp + " font-mono"} value={ef.login} onChange={(e) => setEf({ ...ef, login: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">NEW PASSWORD</label><div className="relative"><input type={efPwShow ? "text" : "password"} className={inp + " pr-8"} placeholder="Leave blank to keep" value={ef.newPw} onChange={(e) => setEf({ ...ef, newPw: e.target.value })} /><button type="button" className="absolute right-2 top-2 text-gray-400" onClick={() => setEfPwShow((v) => !v)}><i className={"fa-solid text-xs " + (efPwShow ? "fa-eye-slash" : "fa-eye")} /></button></div></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">EMAIL</label><input className={inp} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">PHONE</label><input className={inp} value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500">COUNTRY</label><CountrySelect className={inp} value={ef.country} onChange={(v) => setEf({ ...ef, country: v })} /></div>
            </div>
            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "#bfdbfe", background: "#eff6ff" }}>
              <div className="mb-2 text-xs font-semibold text-blue-700"><i className="fa-solid fa-building mr-1.5" />TENANT ASSIGNMENT (this account only)</div>
              <select className={inp} value={ef.tenantId} onChange={(e) => setEf({ ...ef, tenantId: e.target.value })} style={{ background: "var(--bg2)" }}>
                <option value="">— No Tenant (Main Admin) —</option>
                {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-blue-500">Applies to this account only ({editRow.login}). Leave blank to keep under main admin.</p>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-btn px-4 py-2 text-sm" onClick={() => setEditRow(null)}>Cancel</button>
              <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PASSWORD MODAL ── */}
      {pwRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Reset Password</div>
            <div className="mb-3 text-xs text-gray-500">{pwRow.login} — {pwRow.name}</div>
            <div className="relative">
              <input type={pwShow ? "text" : "password"} className={inp} placeholder="New password (min 6)" value={pwVal} onChange={(e) => setPwVal(e.target.value)} autoFocus />
              <button type="button" className="absolute right-2 top-2 text-gray-400" onClick={() => setPwShow((v) => !v)}><i className={"fa-solid text-xs " + (pwShow ? "fa-eye-slash" : "fa-eye")} /></button>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setPwRow(null)}>Cancel</button>
              <button disabled={pwVal.length < 6} className="ui-btn px-3 py-1.5 text-sm text-white disabled:opacity-40" style={{ background: AMB, borderColor: "transparent" }} onClick={async () => { const ok = await act(pwRow.id, "resetPassword", { password: pwVal }); if (ok) setPwRow(null); }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE ID MODAL ── */}
      {idRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Change Login ID</div>
            <div className="mb-3 text-xs text-gray-500">Current: <span className="font-mono font-medium">{idRow.login}</span></div>
            <input className={inp + " font-mono"} value={idVal} onChange={(e) => setIdVal(e.target.value)} autoFocus />
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setIdRow(null)}>Cancel</button>
              <button disabled={!idVal || idVal === idRow.login} className="ui-btn px-3 py-1.5 text-sm text-white disabled:opacity-40" style={{ background: "#7c3aed", borderColor: "transparent" }} onClick={async () => { const ok = await act(idRow.id, "accountId", { login: idVal }); if (ok) setIdRow(null); }}>Update ID</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN MANAGER MODAL ── */}
      {mgrRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Assign Manager</div>
            <div className="mb-3 text-xs text-gray-500">{mgrRow.login} — {mgrRow.name}</div>
            <select className={inp} value={mgrVal} onChange={(e) => setMgrVal(e.target.value)}>
              <option value="">— No Manager —</option>
              {mgrTenantMgrs.map((mgr: any) => <option key={mgr.id} value={mgr.id}>{mgr.name} ({mgr.email})</option>)}
            </select>
            {mgrTenantMgrs.length === 0 && <p className="mt-1 text-xs text-gray-400">No managers found for this tenant.</p>}
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setMgrRow(null)}>Cancel</button>
              <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: GRN, borderColor: "transparent" }} onClick={async () => { const ok = await act(mgrRow.id, "assignManager", { managerId: mgrVal || null }); if (ok) setMgrRow(null); }}>Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADJUST BALANCE ── */}
      <AdjustBalanceDialog
        open={!!moneyRow}
        data={moneyRow ? { ...moneyForm, login: moneyRow.login, accountType: moneyRow.type } : null}
        setData={(v: any) => setMoneyForm(v)}
        onClose={() => { setMoneyRow(null); setErr(""); }}
        error={err}
        onApply={async () => {
          if (!moneyRow) return;
          const ok = await act(moneyRow.id, "balance", { type: moneyForm.type, amount: parseFloat(moneyForm.amount), description: moneyForm.description });
          if (ok) { setMoneyRow(null); setMoneyForm({ type: "DEPOSIT", amount: "", description: "" }); }
        }}
      />

      {/* ── STATEMENT / REPORT MODAL ── */}
      {repRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[380px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Statement / Report</div>
            <div className="mb-3 text-xs text-gray-500">{repRow.login} — {repRow.name}</div>
            <div className="mb-1 text-xs font-medium text-gray-500">Period</div>
            <div className="mb-2 grid grid-cols-5 gap-1">
              {[["week","Week"],["month","Month"],["year","Year"],["all","All"],["custom","Custom"]].map(([k,l]) => (
                <button key={k} onClick={() => setRepPreset(k)} className="rounded border px-1 py-1 text-[11px]" style={repPreset === k ? { background: BLU, color: "#fff", borderColor: "transparent" } : { borderColor: "var(--border)", color: "var(--text2)" }}>{l}</button>
              ))}
            </div>
            {repPreset === "custom" && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <div><div className="text-[10px] text-gray-400">From</div><input type="date" className={inp} value={repFrom} onChange={(e) => setRepFrom(e.target.value)} /></div>
                <div><div className="text-[10px] text-gray-400">To</div><input type="date" className={inp} value={repTo} onChange={(e) => setRepTo(e.target.value)} /></div>
              </div>
            )}
            <button className="ui-btn ui-btn-primary mb-3 w-full px-3 py-2 text-sm" onClick={() => window.open("/api/superadmin/statement?accountId=" + encodeURIComponent(repRow.id) + "&" + new URLSearchParams(repParams()).toString(), "_blank")}>
              <i className="fa-solid fa-file-pdf mr-1.5" /> Download PDF
            </button>
            <div className="mb-1 text-xs font-medium text-gray-500">Email statement to</div>
            <input type="email" className={inp} value={repEmail} onChange={(e) => { setRepEmail(e.target.value); setRepMsg(""); }} placeholder="Leave blank to use client's registered email" />
            {repMsg && <div className="mt-2 text-xs" style={{ color: repMsg.startsWith("✓") ? GRN : RED }}>{repMsg}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setRepRow(null)}>Close</button>
              <button disabled={repSending} className="ui-btn px-3 py-1.5 text-sm text-white disabled:opacity-60" style={{ background: BLU, borderColor: "transparent" }} onClick={async () => {
                setRepSending(true); setRepMsg("");
                const r = await fetch("/api/superadmin/statement/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: repRow.id, email: repEmail.trim() || undefined, ...repParams() }) }).then((x) => x.json()).catch(() => ({ ok: false }));
                setRepSending(false);
                setRepMsg(r.ok ? "✓ Sent to " + r.to : (r.error || "Failed to send"));
              }}>
                <i className="fa-solid fa-envelope mr-1.5" />{repSending ? "Sending…" : "Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {delRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[400px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold text-red-600">Delete Account</div>
            <p className="mb-4 text-sm text-gray-600">Delete <span className="font-semibold">{delRow.login} — {delRow.name}</span> and all associated trades, history, and financial data? This <strong>cannot be undone</strong>.</p>
            {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button className="ui-btn px-4 py-2 text-sm" onClick={() => setDelRow(null)}>Cancel</button>
              <button className="ui-btn px-4 py-2 text-sm text-white" style={{ background: RED, borderColor: "transparent" }} onClick={async () => { const ok = await act(delRow.id, "delete", {}); if (ok) setDelRow(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
