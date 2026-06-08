"use client";
import { useEffect, useState } from "react";
import CountrySelect from "@/components/ui/CountrySelect";

export default function SAClientsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [err, setErr] = useState("");

  // Filters
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("All");
  const [statusF, setStatusF] = useState("All");
  const [kycF, setKycF] = useState("All");
  const [poolF, setPoolF] = useState("All");
  const [onlineF, setOnlineF] = useState("All");
  const [perPage, setPerPage] = useState(30);
  const [page, setPage] = useState(1);

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

  async function load() {
    try {
      const [cd, td] = await Promise.all([
        fetch("/api/superadmin/clients").then((r) => r.json()),
        fetch("/api/superadmin/outsource").then((r) => r.json()),
      ]);
      if (cd.ok) setRows(cd.clients);
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

  function openEdit(row: any) {
    setErr("");
    setEfPwShow(false);
    setEf({
      name: row.name || "",
      login: row.login || "",
      email: row.email || "",
      phone: row.phone || "",
      country: row.country || "",
      tenantId: row.tenantId || "",
      newPw: "",
    });
    setEditRow(row);
  }

  async function saveEdit() {
    if (!editRow) return;
    setErr("");
    const id = editRow.id;
    const nameChanged = ef.name !== editRow.name || ef.email !== (editRow.email || "") ||
      ef.phone !== (editRow.phone || "") || ef.country !== (editRow.country || "");
    if (nameChanged) {
      const ok = await act(id, "rename", { name: ef.name, email: ef.email, phone: ef.phone, country: ef.country });
      if (!ok) return;
    }
    if (ef.login !== editRow.login) {
      const ok = await act(id, "accountId", { login: ef.login });
      if (!ok) return;
    }
    if (ef.newPw && ef.newPw.length >= 6) {
      const ok = await act(id, "resetPassword", { password: ef.newPw });
      if (!ok) return;
    }
    if (ef.tenantId !== (editRow.tenantId || "")) {
      const ok = await act(id, "assignTenant", { tenantId: ef.tenantId || null });
      if (!ok) return;
    }
    setEditRow(null);
  }

  async function openMgr(row: any) {
    setMgrVal(row.managerId || "");
    setMgrTenantMgrs([]);
    setMgrRow(row);
    if (row.tenantId) {
      try {
        const sd = await fetch("/api/superadmin/staff?role=MANAGER&tenantId=" + row.tenantId).then((r) => r.json());
        if (sd.ok) setMgrTenantMgrs(sd.staff || sd.users || []);
      } catch {}
    }
  }

  // Filtering
  const filtered = rows.filter((r) => {
    if (typeF !== "All" && r.type !== typeF) return false;
    if (statusF !== "All") {
      if (statusF === "Active" && (r.locked || r.deactivated)) return false;
      if (statusF === "Locked" && !r.locked) return false;
      if (statusF === "Inactive" && !r.deactivated) return false;
    }
    if (kycF !== "All" && (r.kyc || "NONE") !== kycF) return false;
    if (poolF !== "All") {
      if (poolF === "Pool" && !r.isPool) return false;
      if (poolF === "Non-Pool" && r.isPool) return false;
    }
    if (onlineF !== "All") {
      if (onlineF === "Online" && !r.isOnline) return false;
      if (onlineF === "Offline" && r.isOnline) return false;
    }
    if (q) {
      const sq = q.toLowerCase();
      if (!(
        (r.login || "").toLowerCase().includes(sq) ||
        (r.name || "").toLowerCase().includes(sq) ||
        (r.email || "").toLowerCase().includes(sq) ||
        (r.phone || "").includes(sq)
      )) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safeP = Math.min(Math.max(1, page), totalPages);
  const paged = filtered.slice((safeP - 1) * perPage, safeP * perPage);

  const m = (v: number) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm w-full";

  function statusBadge(r: any) {
    if (r.deactivated) return <span className="sab sab-amber">Inactive</span>;
    if (r.locked) return <span className="sab sab-red">Locked</span>;
    return <span className="sab sab-green">Active</span>;
  }

  const selStyle = "ui-input rounded border px-2 py-1.5 text-sm";
  const btnStyle = (bg: string) => ({ background: bg, padding: "4px 8px", borderRadius: 4, border: "1px solid transparent", cursor: "pointer" });

  return (
    <div className="space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">All Clients</h1>
        <p className="text-sm text-gray-500">View all accounts across the platform</p>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="ui-card bg-white" style={{ borderColor: "#e2e8f0" }}>
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2.5" style={{ borderColor: "#e2e8f0" }}>
          <div className="relative min-w-[220px] flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-2.5 text-[11px] text-gray-400" />
            <input
              className="ui-input w-full rounded border py-1.5 pl-7 pr-2 text-sm"
              placeholder="Search..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              style={{ borderColor: "#cbd5e1" }}
            />
          </div>
          {[
            { label: "TYPE", val: typeF, set: setTypeF, opts: [["All","All"],["LIVE","Live"],["DEMO","Demo"]] },
            { label: "STATUS", val: statusF, set: setStatusF, opts: [["All","All"],["Active","Active"],["Locked","Locked"],["Inactive","Inactive"]] },
            { label: "KYC", val: kycF, set: setKycF, opts: [["All","All"],["APPROVED","Approved"],["PENDING","Pending"],["REJECTED","Rejected"],["NONE","None"]] },
            { label: "POOL", val: poolF, set: setPoolF, opts: [["All","All"],["Pool","Pool"],["Non-Pool","Non-Pool"]] },
            { label: "ONLINE", val: onlineF, set: setOnlineF, opts: [["All","All"],["Online","Online"],["Offline","Offline"]] },
          ].map(({ label, val, set, opts }) => (
            <div key={label}>
              <div className="mb-0.5 text-[10px] font-medium text-gray-400">{label}</div>
              <select className={selStyle} value={val} onChange={(e) => { (set as any)(e.target.value); setPage(1); }} style={{ borderColor: "#cbd5e1" }}>
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          <div className="ml-auto">
            <div className="mb-0.5 text-[10px] font-medium text-gray-400">ROWS</div>
            <select className={selStyle} value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} style={{ borderColor: "#cbd5e1" }}>
              {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="self-end pb-1.5 text-sm text-gray-500">{filtered.length} rows</div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
                {["ID","NAME / EMAIL / PHONE","COUNTRY","COMPANY / MANAGER","TYPE","BALANCE","ONLINE","IP","JOINED","STATUS","ACTIONS"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="ui-row border-b" style={{ borderColor: "#f0f4f8" }}>
                  <td className="px-3 py-2.5">
                    <button className="font-mono text-blue-600 font-semibold hover:underline text-sm" onClick={() => openEdit(r)}>{r.login}</button>
                    {r.isPool && <div className="mt-0.5 text-[10px] font-medium" style={{ color: "#b45309" }}>POOL</div>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    <div className="font-medium flex items-center gap-1.5">
                      <span className="truncate">{r.name}</span>
                      {r.kyc === "APPROVED" && <span className="sab sab-green shrink-0" style={{ fontSize: 9 }}>KYC</span>}
                      {r.kyc === "PENDING" && <span className="sab sab-amber shrink-0" style={{ fontSize: 9 }}>KYC</span>}
                      {r.kyc === "REJECTED" && <span className="sab sab-red shrink-0" style={{ fontSize: 9 }}>KYC</span>}
                    </div>
                    {r.email && <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><i className="fa-solid fa-envelope text-[9px]" /><span className="truncate">{r.email}</span></div>}
                    {r.phone && <div className="text-xs text-gray-400 flex items-center gap-1"><i className="fa-solid fa-phone text-[9px]" />{r.phone}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-gray-600">{r.country || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5">
                    {r.company !== "—" ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#dbeafe", color: "#1d4ed8" }}>{r.company}</span>
                    ) : <span className="text-xs text-gray-400">Own</span>}
                    {r.manager && <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1"><i className="fa-solid fa-user text-[9px]" />{r.manager}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={"sab " + (r.type === "DEMO" ? "sab-blue" : "sab-green")} style={{ fontSize: 11 }}>
                      {r.type === "DEMO" ? "Demo" : "Live"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">{m(r.balance)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={"inline-block h-2.5 w-2.5 rounded-full border-2 " + (r.isOnline ? "bg-green-400 border-green-200" : "bg-gray-300 border-gray-100")}
                        title={r.isOnline ? "Online" : r.lastPing ? "Last seen: " + new Date(r.lastPing).toLocaleString() : "Offline"}
                      />
                      {r.device && <i className={"fa-solid text-[10px] text-gray-400 " + (String(r.device).toLowerCase() === "mobile" ? "fa-mobile-screen-button" : String(r.device).toLowerCase() === "tablet" ? "fa-tablet-screen-button" : "fa-laptop")} title={r.device} />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.lastLoginIp || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{new Date(r.joined).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5">{statusBadge(r)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {/* Edit */}
                    <button title="Edit" style={btnStyle("#f1f5f9")} onClick={() => openEdit(r)} className="mr-0.5">
                      <i className="fa-solid fa-pen text-xs" style={{ color: "#475569" }} />
                    </button>
                    {/* Password */}
                    <button title="Reset Password" style={btnStyle("#fff7ed")} onClick={() => { setPwVal(""); setPwShow(false); setPwRow(r); }} className="mr-0.5">
                      <i className="fa-solid fa-key text-xs" style={{ color: "#b45309" }} />
                    </button>
                    {/* Change ID */}
                    <button title="Change Login ID" style={btnStyle("#f1f5f9")} onClick={() => { setIdVal(r.login); setIdRow(r); }} className="mr-0.5">
                      <i className="fa-solid fa-hashtag text-xs" style={{ color: "#7c3aed" }} />
                    </button>
                    {/* Assign Manager */}
                    <button title="Assign Manager" style={btnStyle("#f0fdf4")} onClick={() => openMgr(r)} className="mr-0.5">
                      <i className="fa-solid fa-user-tie text-xs" style={{ color: "#15803d" }} />
                    </button>
                    {/* Lock */}
                    <button title={r.locked ? "Unlock" : "Lock"} style={btnStyle(r.locked ? "#f0fdf4" : "#fff1f2")} onClick={() => act(r.id, r.locked ? "unlock" : "lock", {})} className="mr-0.5">
                      <i className={"fa-solid text-xs " + (r.locked ? "fa-lock-open" : "fa-lock")} style={{ color: r.locked ? "#15803d" : "#dc2626" }} />
                    </button>
                    {/* Deactivate */}
                    <button title={r.deactivated ? "Activate" : "Deactivate"} style={btnStyle("#fff7ed")} onClick={() => act(r.id, r.deactivated ? "activate" : "deactivate", {})} className="mr-0.5">
                      <i className={"fa-solid text-xs " + (r.deactivated ? "fa-circle-check" : "fa-ban")} style={{ color: "#b45309" }} />
                    </button>
                    {/* Delete */}
                    <button title="Statement / Report" style={btnStyle("#eff6ff")} onClick={() => { setRepEmail(r.email || ""); setRepMsg(""); setRepRow(r); }} className="mr-0.5">
                      <i className="fa-solid fa-file-invoice text-xs" style={{ color: "#2563eb" }} />
                    </button>
                    <button title="Delete" style={btnStyle("#fff1f2")} onClick={() => setDelRow(r)}>
                      <i className="fa-solid fa-trash text-xs" style={{ color: "#dc2626" }} />
                    </button>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={11}>No clients found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-sm" style={{ borderColor: "#e2e8f0" }}>
            <span className="text-gray-500">Page {safeP} of {totalPages} &nbsp;·&nbsp; {filtered.length} total</span>
            <div className="flex gap-1">
              <button disabled={safeP <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="ui-btn px-3 py-1 text-xs disabled:opacity-40">Prev</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = safeP <= 3 ? i + 1 : safeP + i - 2;
                if (pg < 1 || pg > totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)} className={"ui-btn px-3 py-1 text-xs " + (pg === safeP ? "ui-btn-primary" : "")}>{pg}</button>
                );
              })}
              <button disabled={safeP >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="ui-btn px-3 py-1 text-xs disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── EDIT MODAL ── */}
      {editRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="ui-card ui-pop w-[540px] max-h-[90vh] overflow-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-0.5 text-lg font-semibold">Edit Client</div>
            <div className="mb-4 text-xs text-gray-400">Account ID: <span className="font-mono font-semibold text-gray-700">{editRow.login}</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">FULL NAME</label>
                <input className={inp} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">LOGIN ID</label>
                <input className={inp + " font-mono"} value={ef.login} onChange={(e) => setEf({ ...ef, login: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">NEW PASSWORD</label>
                <div className="relative">
                  <input type={efPwShow ? "text" : "password"} className={inp + " pr-8"} placeholder="Leave blank to keep" value={ef.newPw} onChange={(e) => setEf({ ...ef, newPw: e.target.value })} />
                  <button type="button" className="absolute right-2 top-2 text-gray-400" onClick={() => setEfPwShow((v) => !v)}>
                    <i className={"fa-solid text-xs " + (efPwShow ? "fa-eye-slash" : "fa-eye")} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">EMAIL</label>
                <input className={inp} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">PHONE</label>
                <input className={inp} value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">COUNTRY</label>
                <CountrySelect className={inp} value={ef.country} onChange={(v) => setEf({ ...ef, country: v })} />
              </div>
            </div>
            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "#bfdbfe", background: "#eff6ff" }}>
              <div className="mb-2 text-xs font-semibold text-blue-700">
                <i className="fa-solid fa-building mr-1.5" />TENANT ASSIGNMENT (this account only)
              </div>
              <select className={inp} value={ef.tenantId} onChange={(e) => setEf({ ...ef, tenantId: e.target.value })} style={{ background: "#fff" }}>
                <option value="">— No Tenant (Main Admin) —</option>
                {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-blue-500">Applies to this account only ({editRow.login}). Sibling accounts under the same client stay where they are. Leave blank to keep under main admin.</p>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Reset Password</div>
            <div className="mb-3 text-xs text-gray-500">{pwRow.login} — {pwRow.name}</div>
            <div className="relative">
              <input type={pwShow ? "text" : "password"} className={inp} placeholder="New password (min 6)" value={pwVal} onChange={(e) => setPwVal(e.target.value)} autoFocus />
              <button type="button" className="absolute right-2 top-2 text-gray-400" onClick={() => setPwShow((v) => !v)}>
                <i className={"fa-solid text-xs " + (pwShow ? "fa-eye-slash" : "fa-eye")} />
              </button>
            </div>
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setPwRow(null)}>Cancel</button>
              <button disabled={pwVal.length < 6} className="ui-btn px-3 py-1.5 text-sm text-white disabled:opacity-40" style={{ background: "#d97706", borderColor: "transparent" }} onClick={async () => { const ok = await act(pwRow.id, "resetPassword", { password: pwVal }); if (ok) setPwRow(null); }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE ID MODAL ── */}
      {idRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[360px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Assign Manager</div>
            <div className="mb-3 text-xs text-gray-500">{mgrRow.login} — {mgrRow.name}</div>
            <select className={inp} value={mgrVal} onChange={(e) => setMgrVal(e.target.value)}>
              <option value="">— No Manager —</option>
              {mgrTenantMgrs.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
            </select>
            {mgrTenantMgrs.length === 0 && <p className="mt-1 text-xs text-gray-400">No managers found for this tenant.</p>}
            {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setMgrRow(null)}>Cancel</button>
              <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#16a34a", borderColor: "transparent" }} onClick={async () => { const ok = await act(mgrRow.id, "assignManager", { managerId: mgrVal || null }); if (ok) setMgrRow(null); }}>Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* ── STATEMENT / REPORT MODAL ── */}
      {repRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setRepRow(null)}>
          <div className="ui-card ui-pop w-[380px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Statement / Report</div>
            <div className="mb-3 text-xs text-gray-500">{repRow.login} — {repRow.name}</div>
            <button className="ui-btn ui-btn-primary mb-3 w-full px-3 py-2 text-sm" onClick={() => window.open("/api/superadmin/statement?accountId=" + encodeURIComponent(repRow.id), "_blank")}>
              <i className="fa-solid fa-file-pdf mr-1.5" /> Download PDF
            </button>
            <div className="mb-1 text-xs font-medium text-gray-500">Email statement to</div>
            <input type="email" className={inp} value={repEmail} onChange={(e) => { setRepEmail(e.target.value); setRepMsg(""); }} placeholder="Leave blank to use client's registered email" />
            {repMsg && <div className="mt-2 text-xs" style={{ color: repMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>{repMsg}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setRepRow(null)}>Close</button>
              <button disabled={repSending} className="ui-btn px-3 py-1.5 text-sm text-white disabled:opacity-60" style={{ background: "#2563eb", borderColor: "transparent" }} onClick={async () => {
                const dest = repEmail.trim() || "the client's registered email";
                if (!confirm(`Email this statement (PDF) to ${dest}?`)) return;
                setRepSending(true); setRepMsg("");
                const r = await fetch("/api/superadmin/statement/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: repRow.id, email: repEmail.trim() || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false }));
                setRepSending(false);
                setRepMsg(r.ok ? "✓ Sent to " + r.to : (r.error || "Failed to send"));
              }}>
                <i className="fa-solid fa-envelope mr-1.5" /> {repSending ? "Sending…" : "Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {delRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="ui-card ui-pop w-[400px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold text-red-600">Delete Client</div>
            <p className="mb-4 text-sm text-gray-600">
              Delete <span className="font-semibold">{delRow.login} — {delRow.name}</span> and all associated trades, history, and financial data? This <strong>cannot be undone</strong>.
            </p>
            {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button className="ui-btn px-4 py-2 text-sm" onClick={() => setDelRow(null)}>Cancel</button>
              <button className="ui-btn px-4 py-2 text-sm text-white" style={{ background: "#dc2626", borderColor: "transparent" }} onClick={async () => { const ok = await act(delRow.id, "delete", {}); if (ok) setDelRow(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
