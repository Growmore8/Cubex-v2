"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";

type Tenant = { id: string; name: string };
type DispFields = { login: string; name: string; email: string; type: string; tenantName: string };
type PayRow = {
  id: string; kind: string; amount: string; method: string | null;
  slipUrl: string | null; note: string | null; status: string; createdAt: string;
  account?: { login: string; name: string | null; email: string | null; type: string; tenant: { name: string } } | null;
  _display?: DispFields;
};
type LedRow = {
  id: string; type: string; amount: string; description: string | null;
  mode: string; appliedAt: string; createdBy: string | null;
  account?: { login: string; name: string | null; type: string; tenantId: string; tenant: { name: string } } | null;
  _display?: DispFields;
};
// Resolve display fields using live account or snapshot fallback
function ra(r: PayRow | LedRow): DispFields {
  if (r._display) return r._display;
  const a = r.account;
  return {
    login:      a?.login ?? "—",
    name:       a?.name  ?? "—",
    email:      (a as any)?.email ?? "—",
    type:       a?.type  ?? "—",
    tenantName: a?.tenant?.name ?? "—",
  };
}

const KINDS    = ["DEPOSIT","WITHDRAWAL","CREDIT_REQUEST","CREDIT_CLEAR"];
const STATUSES = ["PENDING","APPROVED","REJECTED","CANCELLED"];
const FIN_TYPES= ["DEPOSIT","WITHDRAWAL","CREDIT_IN","CREDIT_OUT","BONUS","REFERRAL","INSURANCE","TRANSFER_IN","TRANSFER_OUT","PNL_ADJUST"];

const INFLOW_TYPES = new Set(["DEPOSIT","CREDIT_IN","BONUS","REFERRAL","INSURANCE","TRANSFER_IN"]);

const typeIcon = (t: string) =>
  t==="DEPOSIT"||t==="CREDIT_IN"||t==="CREDIT_REQUEST" ? "fa-download" :
  t==="WITHDRAWAL"||t==="CREDIT_OUT"||t==="CREDIT_CLEAR" ? "fa-upload" :
  t==="BONUS" ? "fa-gift" : t==="REFERRAL" ? "fa-user-plus" :
  t==="TRANSFER_IN"||t==="TRANSFER_OUT" ? "fa-right-left" :
  t==="PNL_ADJUST" ? "fa-chart-line" : "fa-coins";

const typeClr = (t: string) =>
  t==="DEPOSIT"||t==="CREDIT_IN"||t==="CREDIT_REQUEST" ? { bg:"#dcfce7",c:"#15803d" } :
  t==="WITHDRAWAL"||t==="CREDIT_OUT"||t==="CREDIT_CLEAR" ? { bg:"#fee2e2",c:"#b91c1c" } :
  t==="BONUS"||t==="REFERRAL" ? { bg:"#f3e8ff",c:"#7c3aed" } :
  t==="TRANSFER_IN"||t==="TRANSFER_OUT" ? { bg:"#dbeafe",c:"#1d4ed8" } :
  { bg:"#f1f5f9",c:"#64748b" };

const statusClr = (s: string) =>
  s==="APPROVED" ? { bg:"#dcfce7",c:"#15803d" } :
  s==="PENDING"  ? { bg:"#fef3c7",c:"#b45309" } :
  s==="REJECTED" ? { bg:"#fee2e2",c:"#b91c1c" } :
                   { bg:"#f1f5f9",c:"#64748b" };

const fmt = (v: number|string) => {
  const n = parseFloat(v as string);
  if (n >= 1_000_000) return "$" + (n/1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return "$" + n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  return "$" + n.toFixed(2);
};
const fmtFull = (v: number|string) => "$" + parseFloat(v as string).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate = (dt: string) => {
  const d = new Date(dt);
  return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})+" "+
         d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
};

const CSS = `
.fin-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
@media(max-width:900px){.fin-kpi-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:540px){.fin-kpi-grid{grid-template-columns:1fr;}}
.fin-kpi{position:relative;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;overflow:hidden;transition:box-shadow .15s,transform .15s;}
.fin-kpi:hover{box-shadow:var(--shadow-lg);transform:translateY(-1px);}
.fin-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc);border-radius:12px 0 0 12px;}
.fin-kpi-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}
.fin-kpi-ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.fin-kpi-ico i{font-size:16px;}
.fin-kpi-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text2);margin-bottom:4px;}
.fin-kpi-val{font-size:22px;font-weight:800;letter-spacing:-.5px;line-height:1;}
.fin-kpi-sub{font-size:10.5px;color:var(--text2);margin-top:5px;}
.fin-tabs{display:flex;gap:4px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:16px;width:fit-content;}
.fin-tab{display:flex;align-items:center;gap:7px;padding:7px 16px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:none;color:var(--text2);transition:all .15s;position:relative;}
.fin-tab.active{background:var(--card);color:var(--text);box-shadow:0 1px 6px rgba(0,0,0,.12);}
.fin-tab-badge{background:#dc2626;color:#fff;border-radius:9px;padding:1px 6px;font-size:9.5px;font-weight:700;line-height:1.4;}
.fin-filter-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;}
.fin-filter-bar input,.fin-filter-bar select{padding:7px 10px;font-size:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);outline:none;}
.fin-filter-bar input:focus,.fin-filter-bar select:focus{border-color:var(--accent);}
.fin-filter-bar input{flex:1 1 200px;min-width:160px;}
.fin-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;transition:all .15s;white-space:nowrap;}
.fin-btn:hover{border-color:var(--accent);color:var(--text);}
.fin-btn.export{background:var(--accent);color:#04221c;border-color:transparent;}
.fin-btn.export:hover{opacity:.9;}
.fin-btn.danger{background:#fee2e2;color:#b91c1c;border-color:#fca5a5;}
.fin-export-wrap{position:relative;}
.fin-export-main{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;font-size:12px;font-weight:700;border-radius:8px 0 0 8px;border:1px solid transparent;background:var(--accent);color:#04221c;cursor:pointer;transition:opacity .15s;}
.fin-export-main:hover{opacity:.88;}
.fin-export-caret{display:inline-flex;align-items:center;justify-content:center;width:30px;padding:7px 0;font-size:11px;border-radius:0 8px 8px 0;border:1px solid transparent;border-left:1px solid rgba(4,34,28,.25);background:var(--accent);color:#04221c;cursor:pointer;transition:opacity .15s;}
.fin-export-caret:hover{opacity:.88;}
.fin-export-main:disabled,.fin-export-caret:disabled{opacity:.5;cursor:not-allowed;}
.fin-export-drop{position:absolute;top:calc(100% + 4px);right:0;min-width:160px;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:999;overflow:hidden;}
.fin-export-opt{display:flex;align-items:center;gap:9px;padding:10px 14px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text);transition:background .12s;}
.fin-export-opt:hover{background:var(--bg2);}
.fin-export-opt i{font-size:13px;width:16px;text-align:center;}
.fin-active-filters{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;}
.fin-filter-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:color-mix(in srgb,var(--accent) 15%,transparent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);color:var(--text);font-size:10.5px;font-weight:600;}
.fin-filter-chip i{font-size:9px;color:var(--text2);}
.fin-tbl-wrap{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.fin-tbl{width:100%;border-collapse:collapse;}
.fin-tbl thead{position:sticky;top:0;z-index:2;}
.fin-tbl th{background:var(--bg);padding:9px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text2);border-bottom:2px solid var(--border);white-space:nowrap;}
.fin-tbl th.r{text-align:right;}
.fin-tbl td{padding:9px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text);vertical-align:middle;}
.fin-tbl tbody tr:last-child td{border-bottom:none;}
.fin-tbl tbody tr:hover{background:var(--bg2);}
.fin-tbl tbody tr:hover td{background:transparent;}
.fin-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:700;white-space:nowrap;}
.fin-badge i{font-size:9px;}
.fin-tenant-chip{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);}
.fin-mono{font-family:'Courier New',monospace;font-weight:700;}
.fin-deleted-tag{display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;margin-left:5px;vertical-align:middle;white-space:nowrap;}
.fin-amount-pos{color:#15803d;font-family:'Courier New',monospace;font-weight:700;text-align:right;}
.fin-amount-neg{color:#b91c1c;font-family:'Courier New',monospace;font-weight:700;text-align:right;}
.fin-empty{text-align:center;padding:40px 0;color:var(--text2);font-size:13px;}
.fin-empty i{font-size:32px;margin-bottom:10px;display:block;opacity:.3;}
.fin-pager{display:flex;align-items:center;gap:6px;justify-content:center;padding:12px;border-top:1px solid var(--border);}
.fin-pager button{padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;font-size:11px;transition:all .15s;}
.fin-pager button:hover:not(:disabled){border-color:var(--accent);color:var(--text);}
.fin-pager button:disabled{opacity:.35;cursor:not-allowed;}
.fin-pager-info{font-size:11px;color:var(--text2);padding:0 6px;}
.fin-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:36px;color:var(--text2);font-size:13px;}
.fin-err{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fee2e2;color:#b91c1c;border-radius:8px;margin-bottom:12px;font-size:12px;}
.fin-expand-btn{width:24px;height:24px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
.fin-expand-btn:hover{border-color:var(--accent);color:var(--text);}
.fin-expand-btn.open{background:color-mix(in srgb,var(--accent) 12%,transparent);border-color:var(--accent);color:var(--accent);}
.fin-action-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;border:none;transition:all .15s;white-space:nowrap;}
.fin-action-btn.approve{background:#dcfce7;color:#15803d;}
.fin-action-btn.approve:hover{background:#bbf7d0;}
.fin-action-btn.reject{background:#fee2e2;color:#b91c1c;}
.fin-action-btn.reject:hover{background:#fecaca;}
.fin-action-btn:disabled{opacity:.5;cursor:not-allowed;}
.fin-modal-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;}
.fin-modal{background:var(--card);border-radius:14px;padding:22px;width:380px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.4);}
.fin-modal-title{font-weight:700;font-size:14px;margin-bottom:14px;}
.fin-modal textarea{width:100%;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text);padding:10px;font-size:12px;resize:vertical;min-height:80px;outline:none;}
.fin-modal textarea:focus{border-color:var(--accent);}
.fin-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}
.fin-detail-row td{padding:0 !important;border-bottom:2px solid var(--accent) !important;}
.fin-detail-inner{padding:10px 14px 12px 42px;background:color-mix(in srgb,var(--accent) 5%,var(--bg2));display:flex;flex-wrap:wrap;gap:18px;}
.fin-detail-item{display:flex;flex-direction:column;gap:3px;min-width:120px;}
.fin-detail-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);}
.fin-detail-val{font-size:12px;color:var(--text);font-weight:500;word-break:break-word;}
.fin-detail-note{flex:1 1 280px;}
`;

export default function SAFinancials() {
  const [tab, setTab]       = useState<"requests"|"ledger">("requests");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [rows, setRows]     = useState<any[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(0);
  const [pages, setPages]   = useState(0);
  const [pending, setPending] = useState(0);
  const [kindAgg, setKindAgg] = useState<any[]>([]);
  const [agg, setAgg]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr]       = useState("");
  const [tenantId, setTenantId]       = useState("");
  const [search, setSearch]           = useState("");
  const [status, setStatus]           = useState("");
  const [kind, setKind]               = useState("");
  const [type, setType]               = useState("");
  const [accountType, setAccountType] = useState("");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [slip, setSlip]         = useState<string|null>(null); // stores paymentRequest.id
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exportMenu, setExportMenu] = useState(false);
  const [acting, setActing]     = useState<string|null>(null);
  const [rejectModal, setRejectModal] = useState<{id:string}|null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const buildParams = useCallback((pg: number, exp = false) => {
    const p = new URLSearchParams({ tab, page: String(pg) });
    if (tenantId)    p.set("tenantId", tenantId);
    if (search)      p.set("search", search);
    if (status)      p.set("status", status);
    if (kind)        p.set("kind", kind);
    if (type)        p.set("type", type);
    if (accountType) p.set("accountType", accountType);
    if (dateFrom)    p.set("dateFrom", dateFrom);
    if (dateTo)      p.set("dateTo", dateTo);
    if (exp)         p.set("export", "1");
    return p;
  }, [tab, tenantId, search, status, kind, type, accountType, dateFrom, dateTo]);

  const load = useCallback(async (pg = 0) => {
    setLoading(true); setErr("");
    try {
      const d = await fetch("/api/superadmin/financials?" + buildParams(pg)).then(r => r.json());
      if (!d.ok) { setErr(d.error || "Failed"); return; }
      setRows(d.rows||[]); setTotal(d.total||0); setPage(d.page||0);
      setPages(d.pages||0); setTenants(d.tenants||[]); setPending(d.pending||0);
      setKindAgg(d.kindAgg||[]); setAgg(d.agg||[]);
    } catch (e: any) { setErr(e.message||"Error"); }
    finally { setLoading(false); }
  }, [buildParams]);

  useEffect(() => { load(0); }, [tab, tenantId, status, kind, type, accountType, dateFrom, dateTo]);
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => load(0), 380);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
    // eslint-disable-next-line
  }, [search]);

  function switchTab(t: "requests"|"ledger") {
    setTab(t); setPage(0); setRows([]);
    setStatus(""); setKind(""); setType(""); setSearch(""); setAccountType(""); setDateFrom(""); setDateTo("");
  }

  function toggleRow(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function doAction(id: string, action: "approve"|"reject", reason?: string) {
    setActing(id);
    try {
      const d = await fetch(`/api/superadmin/financials/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectReason: reason }),
      }).then(r => r.json());
      if (!d.ok) { setErr(d.error || "Action failed"); }
      else { load(page); }
    } catch { setErr("Network error"); }
    finally { setActing(null); }
  }

  // close export menu when clicking outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenu(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function doExport(fmt: "csv"|"pdf") {
    setExportMenu(false);
    setExporting(true);
    try {
      const p = new URLSearchParams({ tab });
      if (tenantId)    p.set("tenantId", tenantId);
      if (search)      p.set("search", search);
      if (status)      p.set("status", status);
      if (kind)        p.set("kind", kind);
      if (type)        p.set("type", type);
      if (accountType) p.set("accountType", accountType);
      if (dateFrom)    p.set("dateFrom", dateFrom);
      if (dateTo)      p.set("dateTo", dateTo);
      p.set("export", fmt);
      const res  = await fetch("/api/superadmin/financials?" + p);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = fmt === "pdf"
        ? (tab === "ledger" ? "financial-ledger.pdf" : "payment-requests.pdf")
        : (tab === "ledger" ? "ledger-export.csv"    : "payment-requests-export.csv");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message||"Export failed"); }
    finally { setExporting(false); }
  }

  // KPI calculations
  const approvedDep = kindAgg.filter(r=>r.kind==="DEPOSIT"&&r.status==="APPROVED").reduce((s,r)=>s+parseFloat(r._sum?.amount||"0"),0);
  const approvedWd  = kindAgg.filter(r=>r.kind==="WITHDRAWAL"&&r.status==="APPROVED").reduce((s,r)=>s+parseFloat(r._sum?.amount||"0"),0);
  const pendingCnt  = pending;
  const pendingAmt  = kindAgg.filter(r=>r.status==="PENDING").reduce((s,r)=>s+parseFloat(r._sum?.amount||"0"),0);
  const approvedCnt = kindAgg.filter(r=>r.status==="APPROVED").reduce((s,r)=>s+r._count?.id,0);

  const ledIn   = agg.filter(r=>INFLOW_TYPES.has(r.type)).reduce((s,r)=>s+parseFloat(r._sum?.amount||"0"),0);
  const ledOut  = agg.filter(r=>["WITHDRAWAL","CREDIT_OUT"].includes(r.type)).reduce((s,r)=>s+parseFloat(r._sum?.amount||"0"),0);
  const ledNet  = ledIn - ledOut;
  const ledCnt  = agg.reduce((s,r)=>s+r._count?.id,0);

  const hasFilter = !!(search||tenantId||status||kind||type||accountType||dateFrom||dateTo);

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <div className="page-title">
            <i className="fa-solid fa-money-bill-transfer" style={{ marginRight:8, color:"var(--accent)" }}></i>
            Client Financials
          </div>
          <div className="page-sub">Cross-tenant view of all deposits, withdrawals &amp; ledger entries</div>
        </div>
        <div className="fin-export-wrap" ref={exportMenuRef}>
          <div style={{ display:"flex" }}>
            <button className="fin-export-main" onClick={()=>doExport("csv")} disabled={exporting}>
              {exporting ? <><i className="fa-solid fa-circle-notch fa-spin"></i>Exporting…</> : <><i className="fa-solid fa-file-export"></i>Export</>}
            </button>
            <button className="fin-export-caret" onClick={()=>setExportMenu(m=>!m)} disabled={exporting}>
              <i className="fa-solid fa-chevron-down"></i>
            </button>
          </div>
          {exportMenu && (
            <div className="fin-export-drop">
              <div className="fin-export-opt" onClick={()=>doExport("csv")}>
                <i className="fa-solid fa-file-csv" style={{ color:"#15803d" }}></i>Download CSV
              </div>
              <div className="fin-export-opt" onClick={()=>doExport("pdf")}>
                <i className="fa-solid fa-file-pdf" style={{ color:"#dc2626" }}></i>Download PDF
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="fin-tabs">
        <button className={"fin-tab"+(tab==="requests"?" active":"")} onClick={()=>switchTab("requests")}>
          <i className="fa-solid fa-inbox"></i>Payment Requests
          {pendingCnt>0 && <span className="fin-tab-badge">{pendingCnt}</span>}
        </button>
        <button className={"fin-tab"+(tab==="ledger"?" active":"")} onClick={()=>switchTab("ledger")}>
          <i className="fa-solid fa-book-open"></i>Financial Ledger
        </button>
      </div>

      {/* KPI cards — requests */}
      {tab==="requests" && (
        <div className="fin-kpi-grid">
          <div className="fin-kpi" style={{ "--kc":"#16a34a" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Approved Deposits</div>
                <div className="fin-kpi-val" style={{ color:"#16a34a" }}>{fmt(approvedDep)}</div>
                <div className="fin-kpi-sub">{fmtFull(approvedDep)}</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"#dcfce7" }}>
                <i className="fa-solid fa-download" style={{ color:"#16a34a" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc":"#dc2626" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Approved Withdrawals</div>
                <div className="fin-kpi-val" style={{ color:"#dc2626" }}>{fmt(approvedWd)}</div>
                <div className="fin-kpi-sub">{fmtFull(approvedWd)}</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"#fee2e2" }}>
                <i className="fa-solid fa-upload" style={{ color:"#dc2626" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc":"#d97706" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Pending Review</div>
                <div className="fin-kpi-val" style={{ color:"#d97706" }}>{pendingCnt}</div>
                <div className="fin-kpi-sub">{fmt(pendingAmt)} awaiting approval</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"#fef3c7" }}>
                <i className="fa-solid fa-clock" style={{ color:"#d97706" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc":"var(--accent)" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Approved Requests</div>
                <div className="fin-kpi-val">{approvedCnt}</div>
                <div className="fin-kpi-sub">{total.toLocaleString()} total (filtered)</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"color-mix(in srgb,var(--accent) 18%,transparent)" }}>
                <i className="fa-solid fa-circle-check" style={{ color:"var(--accent)" }}></i>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI cards — ledger */}
      {tab==="ledger" && (
        <div className="fin-kpi-grid">
          <div className="fin-kpi" style={{ "--kc":"#16a34a" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Total Inflows</div>
                <div className="fin-kpi-val" style={{ color:"#16a34a" }}>{fmt(ledIn)}</div>
                <div className="fin-kpi-sub">Deposits + credits + bonuses</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"#dcfce7" }}>
                <i className="fa-solid fa-download" style={{ color:"#16a34a" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc":"#dc2626" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Total Outflows</div>
                <div className="fin-kpi-val" style={{ color:"#dc2626" }}>{fmt(ledOut)}</div>
                <div className="fin-kpi-sub">Withdrawals + credit outs</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"#fee2e2" }}>
                <i className="fa-solid fa-upload" style={{ color:"#dc2626" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc": ledNet>=0 ? "#16a34a" : "#dc2626" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Net Balance</div>
                <div className="fin-kpi-val" style={{ color: ledNet>=0?"#16a34a":"#dc2626" }}>{fmt(ledNet)}</div>
                <div className="fin-kpi-sub">Inflows minus outflows</div>
              </div>
              <div className="fin-kpi-ico" style={{ background: ledNet>=0?"#dcfce7":"#fee2e2" }}>
                <i className="fa-solid fa-scale-balanced" style={{ color: ledNet>=0?"#16a34a":"#dc2626" }}></i>
              </div>
            </div>
          </div>
          <div className="fin-kpi" style={{ "--kc":"var(--accent)" } as any}>
            <div className="fin-kpi-top">
              <div>
                <div className="fin-kpi-label">Transactions</div>
                <div className="fin-kpi-val">{total.toLocaleString()}</div>
                <div className="fin-kpi-sub">{agg.length} distinct types</div>
              </div>
              <div className="fin-kpi-ico" style={{ background:"color-mix(in srgb,var(--accent) 18%,transparent)" }}>
                <i className="fa-solid fa-list-ul" style={{ color:"var(--accent)" }}></i>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="fin-filter-bar">
        <i className="fa-solid fa-magnifying-glass" style={{ color:"var(--text3)", fontSize:13 }}></i>
        <input
          placeholder="Search by name, login or email…"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />
        <select value={tenantId} onChange={e=>{setTenantId(e.target.value);setPage(0);}}>
          <option value="">All Tenants</option>
          {tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={accountType} onChange={e=>{setAccountType(e.target.value);setPage(0);}}>
          <option value="">Live &amp; Demo</option>
          <option value="LIVE">Live only</option>
          <option value="DEMO">Demo only</option>
        </select>
        <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(0);}} title="From date" style={{ flex:"0 0 auto", width:130 }} />
        <input type="date" value={dateTo}   onChange={e=>{setDateTo(e.target.value);setPage(0);}}   title="To date"   style={{ flex:"0 0 auto", width:130 }} />
        {tab==="requests" && <>
          <select value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}>
            <option value="">All Types</option>
            {KINDS.map(k=><option key={k} value={k}>{k.replace(/_/g," ")}</option>)}
          </select>
          <select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}>
            <option value="">All Statuses</option>
            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </>}
        {tab==="ledger" &&
          <select value={type} onChange={e=>{setType(e.target.value);setPage(0);}}>
            <option value="">All Types</option>
            {FIN_TYPES.map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
          </select>
        }
        <button className="fin-btn" onClick={()=>load(page)}>
          <i className="fa-solid fa-rotate-right"></i>Refresh
        </button>
        {hasFilter &&
          <button className="fin-btn danger" onClick={()=>{setSearch("");setTenantId("");setStatus("");setKind("");setType("");setAccountType("");setDateFrom("");setDateTo("");setPage(0);}}>
            <i className="fa-solid fa-xmark"></i>Clear
          </button>
        }
      </div>

      {/* Active filter chips */}
      {hasFilter && (
        <div className="fin-active-filters">
          <span style={{ fontSize:10.5, color:"var(--text2)", fontWeight:600, alignSelf:"center" }}>Active filters:</span>
          {search      && <span className="fin-filter-chip"><i className="fa-solid fa-magnifying-glass"></i>Search: {search}</span>}
          {tenantId    && <span className="fin-filter-chip"><i className="fa-solid fa-building"></i>Tenant: {tenants.find(t=>t.id===tenantId)?.name||tenantId}</span>}
          {accountType && <span className="fin-filter-chip"><i className="fa-solid fa-layer-group"></i>{accountType === "LIVE" ? "Live accounts" : "Demo accounts"}</span>}
          {kind        && <span className="fin-filter-chip"><i className="fa-solid fa-tag"></i>{kind.replace(/_/g," ")}</span>}
          {status      && <span className="fin-filter-chip"><i className="fa-solid fa-circle-half-stroke"></i>{status}</span>}
          {type        && <span className="fin-filter-chip"><i className="fa-solid fa-tag"></i>{type.replace(/_/g," ")}</span>}
          {dateFrom    && <span className="fin-filter-chip"><i className="fa-solid fa-calendar-days"></i>From: {dateFrom}</span>}
          {dateTo      && <span className="fin-filter-chip"><i className="fa-solid fa-calendar-days"></i>To: {dateTo}</span>}
          <span style={{ fontSize:10, color:"var(--text3)", alignSelf:"center" }}>— exports will reflect these filters</span>
        </div>
      )}

      {err && <div className="fin-err"><i className="fa-solid fa-triangle-exclamation"></i>{err}</div>}

      {/* Table */}
      <div className="fin-tbl-wrap">
        {loading
          ? <div className="fin-loading"><i className="fa-solid fa-circle-notch fa-spin"></i>Loading…</div>
          : tab==="requests"
            ? (
              <div style={{ overflowX:"auto" }}>
                <table className="fin-tbl">
                  <thead><tr>
                    <th style={{ width:32 }}></th>
                    <th>Date / Time</th>
                    <th>Tenant</th>
                    <th>Login</th>
                    <th>Client</th>
                    <th>Acct</th>
                    <th>Type</th>
                    <th>Method</th>
                    <th className="r">Amount</th>
                    <th>Status</th>
                    <th>Proof</th>
                    <th>Actions</th>
                  </tr></thead>
                  <tbody>
                    {rows.length===0
                      ? <tr><td colSpan={12}><div className="fin-empty"><i className="fa-regular fa-folder-open"></i>No records match your filters</div></td></tr>
                      : (rows as PayRow[]).map(r=>{
                          const d=ra(r);
                          const tc=typeClr(r.kind), sc=statusClr(r.status);
                          const isIn=r.kind==="DEPOSIT"||r.kind==="CREDIT_REQUEST";
                          const isOpen=expanded.has(r.id);
                          const hasDetail=!!(r.note||d.email!=="—"||d.name!=="—");
                          return (
                            <React.Fragment key={r.id}>
                              <tr>
                                <td style={{ width:32, paddingRight:4 }}>
                                  <button
                                    className={"fin-expand-btn"+(isOpen?" open":"")}
                                    onClick={()=>toggleRow(r.id)}
                                    title={isOpen?"Hide details":"Show details"}
                                  >
                                    <i className={"fa-solid fa-chevron-"+(isOpen?"up":"down")} style={{ fontSize:9 }}></i>
                                  </button>
                                </td>
                                <td style={{ whiteSpace:"nowrap", color:"var(--text2)", fontSize:11 }}>{fmtDate(r.createdAt)}</td>
                                <td><span className="fin-tenant-chip">{d.tenantName}</span></td>
                                <td>
                                  <span className="fin-mono">{d.login}</span>
                                  {!r.account && <span className="fin-deleted-tag" title="Account was deleted — data shown from snapshot"><i className="fa-solid fa-triangle-exclamation"></i>Deleted</span>}
                                </td>
                                <td style={{ fontSize:11 }}>{d.name!=="—"?d.name:d.email!=="—"?d.email:"—"}</td>
                                <td>
                                  <span className="fin-badge" style={{ background: d.type==="DEMO"?"#f3e8ff":"#dbeafe", color: d.type==="DEMO"?"#7c3aed":"#1d4ed8", fontSize:10 }}>
                                    {d.type}
                                  </span>
                                </td>
                                <td>
                                  <span className="fin-badge" style={{ background:tc.bg, color:tc.c }}>
                                    <i className={"fa-solid "+typeIcon(r.kind)}></i>
                                    {r.kind.replace(/_/g," ")}
                                  </span>
                                </td>
                                <td style={{ fontSize:11, color:"var(--text2)" }}>{r.method||"—"}</td>
                                <td className={isIn?"fin-amount-pos":"fin-amount-neg"}>{fmtFull(r.amount)}</td>
                                <td>
                                  <span className="fin-badge" style={{ background:sc.bg, color:sc.c }}>{r.status}</span>
                                </td>
                                <td>
                                  {r.slipUrl
                                    ? <button onClick={()=>setSlip(r.id)} style={{ background:"none", border:"1px solid var(--border)", borderRadius:6, padding:"3px 8px", cursor:"pointer", fontSize:11, color:"#1d4ed8", display:"inline-flex", alignItems:"center", gap:4 }}>
                                        <i className="fa-solid fa-image"></i>View
                                      </button>
                                    : <span style={{ color:"var(--text3)", fontSize:11 }}>—</span>
                                  }
                                </td>
                                <td>
                                  {r.status==="PENDING" && (r.kind === "DEPOSIT" || r.kind === "WITHDRAWAL") ? (
                                    <div style={{ display:"flex", gap:4 }}>
                                      <button className="fin-action-btn approve" disabled={acting===r.id} onClick={()=>doAction(r.id,"approve")}>
                                        <i className="fa-solid fa-check"></i>Approve
                                      </button>
                                      <button className="fin-action-btn reject" disabled={acting===r.id} onClick={()=>{setRejectReason("");setRejectModal({id:r.id});}}>
                                        <i className="fa-solid fa-xmark"></i>Reject
                                      </button>
                                    </div>
                                  ) : <span style={{ color:"var(--text3)", fontSize:11 }}>—</span>}
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="fin-detail-row">
                                  <td colSpan={12}>
                                    <div className="fin-detail-inner">
                                      <div className="fin-detail-item">
                                        <span className="fin-detail-label"><i className="fa-solid fa-hashtag" style={{ marginRight:3 }}></i>Account</span>
                                        <span className="fin-detail-val fin-mono">{d.login} <span style={{ fontFamily:"inherit", fontWeight:400, color:"var(--text2)", fontSize:11 }}>({d.type})</span></span>
                                      </div>
                                      <div className="fin-detail-item">
                                        <span className="fin-detail-label"><i className="fa-solid fa-user" style={{ marginRight:3 }}></i>Client</span>
                                        <span className="fin-detail-val">{d.name!=="—"?d.name:"—"}</span>
                                      </div>
                                      {d.email!=="—" && (
                                        <div className="fin-detail-item">
                                          <span className="fin-detail-label"><i className="fa-solid fa-envelope" style={{ marginRight:3 }}></i>Email</span>
                                          <span className="fin-detail-val">{d.email}</span>
                                        </div>
                                      )}
                                      <div className="fin-detail-item">
                                        <span className="fin-detail-label"><i className="fa-solid fa-wallet" style={{ marginRight:3 }}></i>Method / Way</span>
                                        <span className="fin-detail-val">{r.method||"—"}</span>
                                      </div>
                                      {r.note && (() => {
                                        const isBankNote = /bank.?transfer/i.test(r.note);
                                        const parts = isBankNote ? r.note.replace(/^Bank Transfer\s*[—–-]\s*/i,"").split("·").map((s:string)=>s.trim()).filter(Boolean) : [];
                                        const acNum = parts.find((s:string)=>/^A\/C\s+/i.test(s))?.replace(/^A\/C\s+/i,"");
                                        const ifsc  = parts.find((s:string)=>/^IFSC\s+/i.test(s))?.replace(/^IFSC\s+/i,"");
                                        const bank  = parts.find((s:string)=>!/^A\/C/i.test(s)&&!/^IFSC/i.test(s)&&s!==parts[0]&&/^[A-Z]/i.test(s));
                                        function CopyInline({v}:{v:string}) {
                                          const [c,setC]=React.useState(false);
                                          return <button onClick={()=>{navigator.clipboard.writeText(v);setC(true);setTimeout(()=>setC(false),1500);}} style={{marginLeft:5,padding:"1px 6px",fontSize:9,borderRadius:4,border:"1px solid var(--border)",background:"var(--bg2)",color:c?"#15803d":"var(--text3)",cursor:"pointer"}}><i className={"fa-solid "+(c?"fa-check":"fa-copy")} style={{fontSize:8}}/></button>;
                                        }
                                        return (
                                          <>
                                            {isBankNote && acNum && (
                                              <div className="fin-detail-item">
                                                <span className="fin-detail-label"><i className="fa-solid fa-credit-card" style={{marginRight:3}}></i>A/C Number</span>
                                                <span className="fin-detail-val fin-mono">{acNum}<CopyInline v={acNum}/></span>
                                              </div>
                                            )}
                                            {isBankNote && bank && (
                                              <div className="fin-detail-item">
                                                <span className="fin-detail-label"><i className="fa-solid fa-building-columns" style={{marginRight:3}}></i>Bank</span>
                                                <span className="fin-detail-val">{bank}</span>
                                              </div>
                                            )}
                                            {isBankNote && ifsc && (
                                              <div className="fin-detail-item">
                                                <span className="fin-detail-label"><i className="fa-solid fa-barcode" style={{marginRight:3}}></i>IFSC</span>
                                                <span className="fin-detail-val fin-mono">{ifsc}<CopyInline v={ifsc}/></span>
                                              </div>
                                            )}
                                            <div className="fin-detail-item fin-detail-note">
                                              <span className="fin-detail-label"><i className="fa-solid fa-note-sticky" style={{marginRight:3}}></i>Full Note</span>
                                              <span className="fin-detail-val" style={{whiteSpace:"pre-wrap"}}>{r.note}<CopyInline v={r.note}/></span>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>
            )
            : (
              <div style={{ overflowX:"auto" }}>
                <table className="fin-tbl">
                  <thead><tr>
                    <th>Date / Time</th>
                    <th>Tenant</th>
                    <th>Login</th>
                    <th>Client</th>
                    <th>Acct</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="r">Amount</th>
                    <th>Mode</th>
                    <th>Applied By</th>
                  </tr></thead>
                  <tbody>
                    {rows.length===0
                      ? <tr><td colSpan={10}><div className="fin-empty"><i className="fa-regular fa-folder-open"></i>No records match your filters</div></td></tr>
                      : (rows as LedRow[]).map(r=>{
                          const d=ra(r);
                          const tc=typeClr(r.type);
                          const isIn=INFLOW_TYPES.has(r.type);
                          return (
                            <tr key={r.id}>
                              <td style={{ whiteSpace:"nowrap", color:"var(--text2)", fontSize:11 }}>{fmtDate(r.appliedAt)}</td>
                              <td><span className="fin-tenant-chip">{d.tenantName}</span></td>
                              <td>
                                <span className="fin-mono">{d.login}</span>
                                {!r.account && <span className="fin-deleted-tag" title="Account was deleted — data shown from snapshot"><i className="fa-solid fa-triangle-exclamation"></i>Deleted</span>}
                              </td>
                              <td style={{ fontSize:11 }}>{d.name!=="—"?d.name:"—"}</td>
                              <td>
                                <span className="fin-badge" style={{ background: d.type==="DEMO"?"#f3e8ff":"#dbeafe", color: d.type==="DEMO"?"#7c3aed":"#1d4ed8", fontSize:10 }}>
                                  {d.type}
                                </span>
                              </td>
                              <td>
                                <span className="fin-badge" style={{ background:tc.bg, color:tc.c }}>
                                  <i className={"fa-solid "+typeIcon(r.type)}></i>
                                  {r.type.replace(/_/g," ")}
                                </span>
                              </td>
                              <td style={{ fontSize:11, color:"var(--text2)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.description||""}>{r.description||"—"}</td>
                              <td className={isIn?"fin-amount-pos":"fin-amount-neg"}>{fmtFull(r.amount)}</td>
                              <td>
                                <span className="fin-badge" style={{ background: r.mode==="REALTIME"?"#dbeafe":"#f1f5f9", color: r.mode==="REALTIME"?"#1d4ed8":"#64748b" }}>
                                  <i className={"fa-solid "+(r.mode==="REALTIME"?"fa-bolt":"fa-hand")}></i>
                                  {r.mode}
                                </span>
                              </td>
                              <td style={{ fontSize:11, color:"var(--text2)" }}>{r.createdBy||"system"}</td>
                            </tr>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>
            )
        }

        {/* Pagination inside the card */}
        {pages>1 && (
          <div className="fin-pager">
            <button disabled={page===0} onClick={()=>{setPage(0);load(0);}}>«</button>
            <button disabled={page===0} onClick={()=>{const p=page-1;setPage(p);load(p);}}>‹ Prev</button>
            <span className="fin-pager-info">Page {page+1} of {pages} · {total.toLocaleString()} rows</span>
            <button disabled={page>=pages-1} onClick={()=>{const p=page+1;setPage(p);load(p);}}>Next ›</button>
            <button disabled={page>=pages-1} onClick={()=>{const p=pages-1;setPage(p);load(p);}}>»</button>
          </div>
        )}
      </div>

      {/* Reject reason modal */}
      {rejectModal && (
        <div className="fin-modal-overlay" onClick={()=>setRejectModal(null)}>
          <div className="fin-modal" onClick={e=>e.stopPropagation()}>
            <div className="fin-modal-title"><i className="fa-solid fa-xmark" style={{ color:"#b91c1c", marginRight:8 }}></i>Reject Payment</div>
            <div style={{ fontSize:12, color:"var(--text2)", marginBottom:10 }}>Optionally provide a reason to the client:</div>
            <textarea
              placeholder="Reason for rejection (optional)…"
              value={rejectReason}
              onChange={e=>setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="fin-modal-actions">
              <button className="fin-btn" onClick={()=>setRejectModal(null)}>Cancel</button>
              <button
                className="fin-action-btn reject"
                disabled={!!acting}
                onClick={async()=>{
                  await doAction(rejectModal.id,"reject",rejectReason||undefined);
                  setRejectModal(null);
                }}
              >
                {acting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-xmark"></i>}
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slip modal */}
      {slip && (
        <div onClick={()=>setSlip(null)} style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"var(--card)", borderRadius:14, padding:20, maxWidth:640, width:"92vw", maxHeight:"88vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.6)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <span style={{ fontWeight:700, fontSize:13 }}><i className="fa-solid fa-image" style={{ marginRight:6, color:"var(--accent)" }}></i>Payment Proof</span>
              <button onClick={()=>setSlip(null)} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:7, width:30, height:30, cursor:"pointer", fontSize:14, color:"var(--text2)" }}>✕</button>
            </div>
            <img src={"/api/files/slip/" + slip} alt="Payment slip" style={{ width:"100%", borderRadius:8, border:"1px solid var(--border)", display:"block" }}
              onError={e=>{(e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement("div"),{textContent:"Image could not be loaded.",style:"padding:20px;text-align:center;color:var(--text2);font-size:12px;border:1px dashed var(--border);border-radius:8px;"} as any));}}
            />
          </div>
        </div>
      )}
    </div>
  );
}
