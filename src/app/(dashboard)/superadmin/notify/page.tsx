"use client";
import { useEffect, useRef, useState } from "react";

// 4 scopes only — no manager-wise or admin-wise
const SCOPES = [
  { key: "global",   label: "Global",          icon: "fa-globe",   desc: "All users on the platform",      color: "#2563eb" },
  { key: "tenant",   label: "By Tenant",        icon: "fa-building",desc: "Everyone in a specific tenant",  color: "#7c3aed" },
  { key: "clients",  label: "All Clients",      icon: "fa-users",   desc: "All clients (optionally filtered)", color: "#15803d" },
  { key: "specific", label: "Specific Client",  icon: "fa-user",    desc: "Search and pick one client",    color: "#b45309" },
] as const;

type ScopeKey = typeof SCOPES[number]["key"];


export default function SANotifyPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [scope, setScope] = useState<ScopeKey>("global");
  const [tenantId, setTenantId] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [preview, setPreview] = useState<{ count: number } | null>(null);
  const [form, setForm] = useState({ title: "", body: "", image: "" });
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [sending, setSending] = useState(false);
  const searchTimer = useRef<any>(null);

  async function load() {
    try {
      const d = await fetch("/api/superadmin/notify").then((r) => r.json());
      if (d.ok) { setTenants(d.tenants || []); setHistory(d.history || []); }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  // Live recipient count preview (not for "specific")
  useEffect(() => {
    if (scope === "specific") { setPreview(null); return; }
    const qs = new URLSearchParams({ scope });
    if (scope === "tenant" && tenantId) qs.set("tenantId", tenantId);
    if (scope === "clients" && tenantId) qs.set("tenantId", tenantId);
    fetch("/api/superadmin/notify?" + qs.toString())
      .then((r) => r.json())
      .then((d) => { if (d.ok) setPreview({ count: d.count }); })
      .catch(() => {});
  }, [scope, tenantId]);

  // Debounced client search (specific scope only — clients only)
  useEffect(() => {
    if (scope !== "specific") return;
    clearTimeout(searchTimer.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        // Search clients only
        const qs = new URLSearchParams({ scope: "clients", q: searchQ });
        if (tenantId) qs.set("tenantId", tenantId);
        const d = await fetch("/api/superadmin/notify?" + qs.toString()).then((r) => r.json());
        if (d.ok) setSearchResults(d.users || []);
      } catch {}
    }, 300);
  }, [searchQ, tenantId, scope]);

  async function send() {
    setErr(""); setSuccess(""); setSending(true);
    try {
      const body: any = { ...form, scope };
      // Tenant scope always needs tenantId
      if (scope === "tenant") {
        if (!tenantId) { setErr("Select a tenant to target"); setSending(false); return; }
        body.tenantId = tenantId;
      }
      // Clients scope — optionally filter by tenant
      if (scope === "clients" && tenantId) body.tenantId = tenantId;
      // Specific scope — needs a selected client
      if (scope === "specific") {
        if (!selectedUser) { setErr("Search and select a client first"); setSending(false); return; }
        body.userId = selectedUser.id;
      }
      const r = await fetch("/api/superadmin/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Failed"); return; }
      setSuccess(`✓ Sent to ${d.count} recipient${d.count !== 1 ? "s" : ""}`);
      setForm({ title: "", body: "", image: "" });
      setSelectedUser(null); setSearchQ(""); setSearchResults([]);
      load();
      setTimeout(() => setSuccess(""), 5000);
    } finally { setSending(false); }
  }

  function changeScope(s: ScopeKey) {
    setScope(s);
    setSelectedUser(null);
    setSearchQ("");
    setSearchResults([]);
    setPreview(null);
    setErr("");
    // Reset tenant filter when switching to global
    if (s === "global") setTenantId("");
  }

  const inp = "ui-input px-3 py-2 text-sm w-full bg-white";
  const currentScope = SCOPES.find((s) => s.key === scope)!;
  const showTenantFilter = scope !== "global";    // Global has no tenant filter
  const tenantRequired  = scope === "tenant";     // Tenant scope must have a tenant selected

  return (
    <div className="space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">Send Notification</h1>
        <p className="text-sm text-gray-500">Broadcast messages to your users</p>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 360px" }}>
        {/* ── LEFT: Compose ── */}
        <div className="space-y-4">

          {/* Scope Tabs */}
          <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
            <div className="text-xs font-semibold uppercase text-gray-400 mb-3">
              <i className="fa-solid fa-crosshairs mr-1.5" />Target Audience
            </div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {SCOPES.map((sc) => (
                <button key={sc.key} onClick={() => changeScope(sc.key)} className="flex flex-col items-center gap-2 rounded-xl border p-3 transition-all text-center" style={{
                  borderColor: scope === sc.key ? sc.color : "#e2e8f0",
                  background:  scope === sc.key ? sc.color + "10" : "#fafafa",
                  color:       scope === sc.key ? sc.color : "#94a3b8",
                }}>
                  <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: scope === sc.key ? sc.color + "20" : "#f1f5f9" }}>
                    <i className={"fa-solid " + sc.icon} style={{ fontSize: 15, color: scope === sc.key ? sc.color : "#94a3b8" }} />
                  </div>
                  <span className="text-xs font-semibold leading-tight">{sc.label}</span>
                  <span className="text-[10px] text-gray-400 leading-tight">{sc.desc}</span>
                </button>
              ))}
            </div>

            {/* Scope info bar */}
            <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: currentScope.color + "0d", border: `1px solid ${currentScope.color}25` }}>
              <i className={"fa-solid " + currentScope.icon} style={{ color: currentScope.color, fontSize: 13 }} />
              <div className="flex-1">
                {scope === "global"   && <span className="text-xs text-gray-600">Sends to <strong>all users</strong> across every tenant on the platform.</span>}
                {scope === "tenant"   && <span className="text-xs text-gray-600">Sends to <strong>all clients, admins, and managers</strong> inside the selected tenant.</span>}
                {scope === "clients"  && <span className="text-xs text-gray-600">Sends to <strong>all clients</strong> {tenantId ? "in the selected tenant" : "across the platform"}.</span>}
                {scope === "specific" && <span className="text-xs text-gray-600">Search for a <strong>specific client</strong> and send only to them.</span>}
              </div>
              {preview && scope !== "specific" && (
                <span className="text-xs font-semibold rounded-full px-2.5 py-1 shrink-0" style={{ background: currentScope.color + "18", color: currentScope.color }}>
                  <i className="fa-solid fa-users mr-1" />{preview.count} recipients
                </span>
              )}
            </div>

            {/* Tenant selector — hidden for Global */}
            {showTenantFilter && (
              <div className="mt-3">
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  <i className="fa-solid fa-building mr-1" />
                  {tenantRequired ? "Tenant *" : "Filter by Tenant (optional)"}
                </label>
                <select className={inp} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                  <option value="">{tenantRequired ? "— Select a tenant —" : "All Tenants"}</option>
                  {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {tenantRequired && !tenantId && (
                  <p className="text-[10px] text-amber-500 mt-1"><i className="fa-solid fa-triangle-exclamation mr-1" />A tenant must be selected for Tenant targeting.</p>
                )}
              </div>
            )}

            {/* Specific client search */}
            {scope === "specific" && (
              <div className="mt-3 space-y-2">
                <label className="text-xs font-medium text-gray-500 block">
                  <i className="fa-solid fa-magnifying-glass mr-1" />Search Client (by name, email, or ID)
                </label>
                <input className={inp} placeholder="Type to search clients…" value={searchQ} onChange={(e) => { setSearchQ(e.target.value); if (selectedUser) setSelectedUser(null); }} />

                {/* Search dropdown */}
                {searchResults.length > 0 && !selectedUser && (
                  <div className="ui-pop rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: "#e2e8f0" }}>
                    {searchResults.slice(0, 8).map((u: any) => (
                      <button key={u.id} onClick={() => { setSelectedUser(u); setSearchQ(""); setSearchResults([]); }} className="ui-row flex w-full items-center gap-3 px-3 py-2.5 text-left border-b last:border-0" style={{ borderColor: "#f0f4f8" }}>
                        <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-green-100">
                          <i className="fa-solid fa-user text-xs text-green-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-800 text-sm">{u.name}</span>
                            {u.login && (
                              <span className="font-mono text-xs rounded px-1.5 py-0.5 font-bold" style={{ background: "#f1f5f9", color: "#475569" }}>
                                {u.login}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 truncate">{u.email}</div>
                        </div>
                        <span className="text-[10px] rounded-full px-2 py-0.5 font-medium bg-green-100 text-green-700 shrink-0">
                          {u.accountType || "CLIENT"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected client card */}
                {selectedUser && (
                  <div className="rounded-xl border-2 p-3.5" style={{ borderColor: currentScope.color + "50", background: currentScope.color + "06" }}>
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-full flex items-center justify-center shrink-0" style={{ background: currentScope.color + "18" }}>
                        <i className="fa-solid fa-user" style={{ color: currentScope.color, fontSize: 16 }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Row 1: Name + Login ID */}
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-bold text-gray-800 text-base">{selectedUser.name}</span>
                          {selectedUser.login && (
                            <span className="font-mono text-xs font-bold rounded-md px-2 py-0.5" style={{ background: currentScope.color + "18", color: currentScope.color, letterSpacing: "0.02em" }}>
                              ID: {selectedUser.login}
                            </span>
                          )}
                          {selectedUser.accountType && (
                            <span className="text-[10px] rounded-full px-2 py-0.5 font-semibold" style={{ background: selectedUser.accountType === "DEMO" ? "#dbeafe" : "#dcfce7", color: selectedUser.accountType === "DEMO" ? "#1d4ed8" : "#15803d" }}>
                              {selectedUser.accountType}
                            </span>
                          )}
                        </div>
                        {/* Row 2: Email */}
                        <div className="flex items-center gap-1.5 text-sm text-gray-500">
                          <i className="fa-solid fa-envelope text-[10px]" style={{ color: currentScope.color }} />
                          <span>{selectedUser.email}</span>
                        </div>
                        {/* Row 3: Confirmation */}
                        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium" style={{ color: currentScope.color }}>
                          <i className="fa-solid fa-circle-check" />
                          This client will receive the notification
                        </div>
                      </div>
                      <button onClick={() => { setSelectedUser(null); setSearchQ(""); }} className="rounded-lg border p-1.5 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors shrink-0" title="Deselect">
                        <i className="fa-solid fa-xmark text-xs" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Compose */}
          <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
            <div className="text-xs font-semibold uppercase text-gray-400 mb-3">
              <i className="fa-solid fa-pen-to-square mr-1.5" />Compose Message
            </div>

            {/* Template quick-fill */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { label: "Maintenance", icon: "fa-wrench",              title: "Scheduled Maintenance", body: "Our platform will undergo scheduled maintenance. Trading may be briefly unavailable. We apologize for any inconvenience." },
                { label: "Notice",      icon: "fa-circle-info",         title: "Important Notice",      body: "Please review this important notice regarding your trading account." },
                { label: "Promotion",   icon: "fa-tag",                 title: "Special Promotion",     body: "A new promotion is now available. Contact your account manager to learn more." },
                { label: "News",        icon: "fa-newspaper",           title: "Market News",           body: "Stay informed with the latest market updates and analysis from our team." },
                { label: "Custom",      icon: "fa-pen",                 title: "",                      body: "" },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => setForm({ ...form, title: t.title, body: t.body })}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all hover:shadow-sm"
                  style={{
                    borderColor: (form.title === t.title && t.title) ? "#2563eb" : "#e2e8f0",
                    background:  (form.title === t.title && t.title) ? "#eff6ff" : "#fafafa",
                    color:       (form.title === t.title && t.title) ? "#2563eb" : "#475569",
                  }}
                >
                  <i className={"fa-solid " + t.icon} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">TITLE <span className="text-red-400">*</span></label>
                <input className={inp} placeholder="Notification title…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">MESSAGE</label>
                <textarea className={inp} rows={4} placeholder="Write your message here…" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">IMAGE URL (optional)</label>
                <input className={inp} placeholder="https://…" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} />
              </div>
            </div>

            {err && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <i className="fa-solid fa-circle-exclamation" />{err}
              </div>
            )}
            {success && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                <i className="fa-solid fa-circle-check" />{success}
              </div>
            )}

            <button
              disabled={sending || !form.title.trim() || (scope === "tenant" && !tenantId) || (scope === "specific" && !selectedUser)}
              onClick={send}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: currentScope.color }}
            >
              {sending ? (
                <><i className="fa-solid fa-spinner fa-spin" />Sending…</>
              ) : scope === "global" ? (
                <><i className="fa-solid fa-globe" />Send to All Platform Users</>
              ) : scope === "tenant" ? (
                <><i className="fa-solid fa-building" />Send to All in {tenants.find((t) => t.id === tenantId)?.name || "selected tenant"}</>
              ) : scope === "clients" ? (
                <><i className="fa-solid fa-users" />Send to All Clients{tenantId ? " · Tenant Filtered" : ""}{preview ? ` · ${preview.count} recipients` : ""}</>
              ) : selectedUser ? (
                <><i className="fa-solid fa-paper-plane" />Send to {selectedUser.name} ({selectedUser.login || selectedUser.email})</>
              ) : (
                <><i className="fa-solid fa-paper-plane" />Select a client above</>
              )}
            </button>
          </div>
        </div>

        {/* ── RIGHT: History ── */}
        <div className="ui-card bg-white" style={{ borderColor: "#e2e8f0", alignSelf: "start" }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "#e2e8f0" }}>
            <div className="text-sm font-semibold text-gray-700">
              <i className="fa-solid fa-clock-rotate-left mr-2 text-gray-400" />Sent History
            </div>
            <button onClick={load} className="ui-btn px-2 py-1 text-xs text-gray-500" title="Refresh">
              <i className="fa-solid fa-rotate-right" />
            </button>
          </div>
          <div className="max-h-[600px] overflow-y-auto divide-y" style={{ borderColor: "#f0f4f8" }}>
            {history.length === 0 && (
              <div className="px-4 py-10 text-center">
                <i className="fa-solid fa-bell-slash text-3xl text-gray-200 mb-3 block" />
                <div className="text-sm text-gray-400">No notifications sent yet</div>
              </div>
            )}
            {history.map((h: any, i: number) => {
              const scopeKey = (h.targetScope || "").split(":")[0];
              const sc = SCOPES.find((s) => s.key === scopeKey);
              return (
                <div key={i} className="ui-row px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: (sc?.color || "#64748b") + "16" }}>
                      <i className={"fa-solid " + (sc?.icon || "fa-bell")} style={{ fontSize: 12, color: sc?.color || "#64748b" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-800 truncate">{h.title}</div>
                      {h.body && <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{h.body}</div>}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: (sc?.color || "#64748b") + "14", color: sc?.color || "#64748b" }}>
                          <i className={"fa-solid mr-0.5 " + (sc?.icon || "fa-bell")} style={{ fontSize: 8 }} />
                          {sc?.label || scopeKey || "—"}
                        </span>
                        <span className="text-[10px] text-gray-400">{new Date(h.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
