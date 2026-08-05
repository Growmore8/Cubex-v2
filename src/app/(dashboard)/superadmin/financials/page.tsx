"use client";
import { useEffect, useState, useCallback, useRef } from "react";

type Tenant = { id: string; name: string };

type PayRow = {
  id: string;
  kind: string;
  amount: string;
  method: string | null;
  slipUrl: string | null;
  note: string | null;
  status: string;
  createdAt: string;
  account: { login: number; name: string | null; email: string | null; tenant: { name: string } };
};

type LedRow = {
  id: string;
  type: string;
  amount: string;
  description: string | null;
  mode: string;
  appliedAt: string;
  createdBy: string | null;
  account: { login: number; name: string | null; tenantId: string; tenant: { name: string } };
};

const KINDS = ["", "DEPOSIT", "WITHDRAWAL", "CREDIT_REQUEST", "CREDIT_CLEAR"];
const STATUSES = ["", "PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const FIN_TYPES = ["", "DEPOSIT", "WITHDRAWAL", "CREDIT_IN", "CREDIT_OUT", "BONUS", "REFERRAL", "INSURANCE", "TRANSFER_IN", "TRANSFER_OUT", "PNL_ADJUST"];

const kindColor = (k: string) =>
  k === "DEPOSIT" || k === "CREDIT_IN" || k === "CREDIT_REQUEST" ? "#15803d" :
  k === "WITHDRAWAL" || k === "CREDIT_OUT" || k === "CREDIT_CLEAR" ? "#b91c1c" :
  k === "BONUS" || k === "REFERRAL" ? "#7c3aed" : "#64748b";

const statusColor = (s: string) =>
  s === "APPROVED" ? "#15803d" : s === "REJECTED" || s === "CANCELLED" ? "#b91c1c" : "#b45309";

const fmt = (v: string | number) => "$" + parseFloat(v as string).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (dt: string) => { const d = new Date(dt); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

export default function SAFinancials() {
  const [tab, setTab] = useState<"requests" | "ledger">("requests");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [pending, setPending] = useState(0);
  const [kindAgg, setKindAgg] = useState<any[]>([]);
  const [agg, setAgg]  = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // filters
  const [tenantId, setTenantId] = useState("");
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [kind, setKind]         = useState("");
  const [type, setType]         = useState("");

  const [slip, setSlip] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (pg = 0) => {
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ tab, page: String(pg) });
      if (tenantId) p.set("tenantId", tenantId);
      if (search)   p.set("search", search);
      if (status)   p.set("status", status);
      if (kind)     p.set("kind", kind);
      if (type)     p.set("type", type);
      const d = await fetch("/api/superadmin/financials?" + p).then((r) => r.json());
      if (!d.ok) { setErr(d.error || "Failed to load"); return; }
      setRows(d.rows || []);
      setTotal(d.total || 0);
      setPage(d.page || 0);
      setPages(d.pages || 0);
      setTenants(d.tenants || []);
      setPending(d.pending || 0);
      setKindAgg(d.kindAgg || []);
      setAgg(d.agg || []);
    } catch (e: any) { setErr(e.message || "Error"); }
    finally { setLoading(false); }
  }, [tab, tenantId, search, status, kind, type]);

  useEffect(() => { load(0); }, [tab, tenantId, status, kind, type]);
  // debounce search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => load(0), 400);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
    // eslint-disable-next-line
  }, [search]);

  function switchTab(t: "requests" | "ledger") {
    setTab(t); setPage(0); setRows([]);
    setStatus(""); setKind(""); setType(""); setSearch("");
  }

  // Summary cards derived from agg / kindAgg
  const approvedDeposits = kindAgg.filter((r) => r.kind === "DEPOSIT" && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r._sum?.amount || "0"), 0);
  const approvedWithdrawals = kindAgg.filter((r) => r.kind === "WITHDRAWAL" && r.status === "APPROVED").reduce((s, r) => s + parseFloat(r._sum?.amount || "0"), 0);
  const pendingAmt = kindAgg.filter((r) => r.status === "PENDING").reduce((s, r) => s + parseFloat(r._sum?.amount || "0"), 0);

  const ledgerDeposits = agg.filter((r) => ["DEPOSIT", "CREDIT_IN", "BONUS"].includes(r.type)).reduce((s, r) => s + parseFloat(r._sum?.amount || "0"), 0);
  const ledgerWithdrawals = agg.filter((r) => ["WITHDRAWAL", "CREDIT_OUT"].includes(r.type)).reduce((s, r) => s + parseFloat(r._sum?.amount || "0"), 0);

  const sel = "background:var(--accent);color:#04221c;font-weight:700;";
  const unsel = "background:var(--bg2);color:var(--text2);";

  return (
    <div>
      <div className="page-title"><i className="fa-solid fa-money-bill-transfer" style={{ marginRight: 8 }}></i>Client Financials</div>
      <div className="page-sub">Cross-tenant view of all deposits, withdrawals and financial ledger entries</div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button onClick={() => switchTab("requests")} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12, ...(tab === "requests" ? { background: "var(--accent)", color: "#04221c", fontWeight: 700 } : { background: "var(--bg2)", color: "var(--text2)" }) }}>
          <i className="fa-solid fa-inbox" style={{ marginRight: 6 }}></i>Payment Requests
          {pending > 0 && <span style={{ marginLeft: 6, background: "#dc2626", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{pending}</span>}
        </button>
        <button onClick={() => switchTab("ledger")} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12, ...(tab === "ledger" ? { background: "var(--accent)", color: "#04221c", fontWeight: 700 } : { background: "var(--bg2)", color: "var(--text2)" }) }}>
          <i className="fa-solid fa-book" style={{ marginRight: 6 }}></i>Financial Ledger
        </button>
      </div>

      {/* Summary cards */}
      {tab === "requests" && (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat" style={{ "--c": "#15803d" } as any}>
            <div className="stat-lbl">Approved Deposits</div>
            <div className="stat-val" style={{ color: "#15803d" }}>{fmt(approvedDeposits)}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-arrow-down-to-line" /></div>
          </div>
          <div className="stat" style={{ "--c": "#b91c1c" } as any}>
            <div className="stat-lbl">Approved Withdrawals</div>
            <div className="stat-val" style={{ color: "#b91c1c" }}>{fmt(approvedWithdrawals)}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-arrow-up-from-line" /></div>
          </div>
          <div className="stat" style={{ "--c": "#d97706" } as any}>
            <div className="stat-lbl">Pending (all kinds)</div>
            <div className="stat-val" style={{ color: "#d97706" }}>{pending} requests</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-clock" /></div>
          </div>
          <div className="stat" style={{ "--c": "#64748b" } as any}>
            <div className="stat-lbl">Total Rows (filtered)</div>
            <div className="stat-val">{total.toLocaleString()}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-list" /></div>
          </div>
        </div>
      )}
      {tab === "ledger" && (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat" style={{ "--c": "#15803d" } as any}>
            <div className="stat-lbl">Total Inflows (filtered)</div>
            <div className="stat-val" style={{ color: "#15803d" }}>{fmt(ledgerDeposits)}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-arrow-down-to-line" /></div>
          </div>
          <div className="stat" style={{ "--c": "#b91c1c" } as any}>
            <div className="stat-lbl">Total Outflows (filtered)</div>
            <div className="stat-val" style={{ color: "#b91c1c" }}>{fmt(ledgerWithdrawals)}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-arrow-up-from-line" /></div>
          </div>
          <div className="stat" style={{ "--c": "#1d4ed8" } as any}>
            <div className="stat-lbl">Net (filtered)</div>
            <div className="stat-val" style={{ color: ledgerDeposits - ledgerWithdrawals >= 0 ? "#15803d" : "#b91c1c" }}>{fmt(ledgerDeposits - ledgerWithdrawals)}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-scale-balanced" /></div>
          </div>
          <div className="stat" style={{ "--c": "#64748b" } as any}>
            <div className="stat-lbl">Total Rows</div>
            <div className="stat-val">{total.toLocaleString()}</div>
            <div className="stat-icon-tile"><i className="fa-solid fa-list" /></div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          placeholder="Search client name / login / email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 180, padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }}
        />
        <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(0); }} style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }}>
          <option value="">All Tenants</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {tab === "requests" && (
          <>
            <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }}>
              <option value="">All Types</option>
              {KINDS.filter(Boolean).map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }}>
              <option value="">All Statuses</option>
              {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        {tab === "ledger" && (
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }}>
            <option value="">All Types</option>
            {FIN_TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        )}
        <button onClick={() => load(page)} style={{ padding: "7px 12px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
          <i className="fa-solid fa-rotate-right" style={{ marginRight: 5 }}></i>Refresh
        </button>
        {(search || tenantId || status || kind || type) && (
          <button onClick={() => { setSearch(""); setTenantId(""); setStatus(""); setKind(""); setType(""); setPage(0); }} style={{ padding: "7px 12px", fontSize: 12, borderRadius: 8, border: "1px solid #dc2626", background: "#fee2e2", color: "#b91c1c", cursor: "pointer" }}>
            <i className="fa-solid fa-xmark" style={{ marginRight: 5 }}></i>Clear
          </button>
        )}
      </div>

      {err && <div style={{ padding: "10px 14px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, marginBottom: 12, fontSize: 12 }}><i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>{err}</div>}
      {loading && <div style={{ padding: "14px 0", textAlign: "center", color: "var(--text2)", fontSize: 12 }}><i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: 6 }}></i>Loading…</div>}

      {/* Payment Requests table */}
      {tab === "requests" && !loading && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tenant</th>
                <th>Login</th>
                <th>Client</th>
                <th>Type</th>
                <th>Method</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Status</th>
                <th>Proof</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text2)", padding: "24px 0", fontSize: 12 }}>No records found</td></tr>
              )}
              {(rows as PayRow[]).map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, color: "var(--text2)", whiteSpace: "nowrap" }}>{fmtDate(r.createdAt)}</td>
                  <td style={{ fontSize: 11 }}><span style={{ background: "var(--bg2)", padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 600 }}>{r.account.tenant.name}</span></td>
                  <td style={{ fontWeight: 700, fontFamily: "monospace" }}>{r.account.login}</td>
                  <td style={{ fontSize: 11 }}>{r.account.name || r.account.email || "—"}</td>
                  <td><span style={{ fontWeight: 700, fontSize: 11, color: kindColor(r.kind) }}>{r.kind.replace("_", " ")}</span></td>
                  <td style={{ fontSize: 11, color: "var(--text2)" }}>{r.method || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: r.kind === "DEPOSIT" || r.kind === "CREDIT_REQUEST" ? "#15803d" : "#b91c1c" }}>{fmt(r.amount)}</td>
                  <td><span style={{ fontWeight: 700, fontSize: 11, color: statusColor(r.status) }}>{r.status}</span></td>
                  <td>
                    {r.slipUrl
                      ? <button onClick={() => setSlip(r.slipUrl!)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: "#1d4ed8" }}><i className="fa-solid fa-image" style={{ marginRight: 4 }}></i>View</button>
                      : <span style={{ color: "var(--text3)", fontSize: 11 }}>—</span>
                    }
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text2)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Financial Ledger table */}
      {tab === "ledger" && !loading && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tenant</th>
                <th>Login</th>
                <th>Client</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Mode</th>
                <th>Applied By</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text2)", padding: "24px 0", fontSize: 12 }}>No records found</td></tr>
              )}
              {(rows as LedRow[]).map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, color: "var(--text2)", whiteSpace: "nowrap" }}>{fmtDate(r.appliedAt)}</td>
                  <td style={{ fontSize: 11 }}><span style={{ background: "var(--bg2)", padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 600 }}>{r.account.tenant.name}</span></td>
                  <td style={{ fontWeight: 700, fontFamily: "monospace" }}>{r.account.login}</td>
                  <td style={{ fontSize: 11 }}>{r.account.name || "—"}</td>
                  <td><span style={{ fontWeight: 700, fontSize: 11, color: kindColor(r.type) }}>{r.type.replace("_", " ")}</span></td>
                  <td style={{ fontSize: 11, color: "var(--text2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: ["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"].includes(r.type) ? "#15803d" : "#b91c1c" }}>{fmt(r.amount)}</td>
                  <td style={{ fontSize: 10, color: r.mode === "REALTIME" ? "#1d4ed8" : "#64748b" }}>{r.mode}</td>
                  <td style={{ fontSize: 11, color: "var(--text2)" }}>{r.createdBy || "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, justifyContent: "center" }}>
          <button disabled={page === 0} onClick={() => { setPage(0); load(0); }} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", cursor: page === 0 ? "not-allowed" : "pointer", color: "var(--text2)", opacity: page === 0 ? 0.4 : 1, fontSize: 11 }}>«</button>
          <button disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); load(p); }} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", cursor: page === 0 ? "not-allowed" : "pointer", color: "var(--text2)", opacity: page === 0 ? 0.4 : 1, fontSize: 11 }}>‹ Prev</button>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Page {page + 1} of {pages} &nbsp;·&nbsp; {total.toLocaleString()} rows</span>
          <button disabled={page >= pages - 1} onClick={() => { const p = page + 1; setPage(p); load(p); }} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", cursor: page >= pages - 1 ? "not-allowed" : "pointer", color: "var(--text2)", opacity: page >= pages - 1 ? 0.4 : 1, fontSize: 11 }}>Next ›</button>
          <button disabled={page >= pages - 1} onClick={() => { const p = pages - 1; setPage(p); load(p); }} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", cursor: page >= pages - 1 ? "not-allowed" : "pointer", color: "var(--text2)", opacity: page >= pages - 1 ? 0.4 : 1, fontSize: 11 }}>»</button>
        </div>
      )}

      {/* Slip preview modal */}
      {slip && (
        <div onClick={() => setSlip(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 12, padding: 20, maxWidth: 640, width: "92vw", maxHeight: "85vh", overflow: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}><i className="fa-solid fa-image" style={{ marginRight: 6 }}></i>Payment Proof</span>
              <button onClick={() => setSlip(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text2)" }}>✕</button>
            </div>
            <img src={slip} alt="Payment slip" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <a href={slip} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 10, textAlign: "center", fontSize: 12, color: "#1d4ed8" }}>Open in new tab ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
