"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

export default function SASmsPage() {
  const [creds, setCreds] = useState({ notifyLkUserId: "", notifyLkApiKey: "", notifyLkServiceId: "" });
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsMsg, setCredsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tenants, setTenants] = useState<{ id: string; name: string; enabled: boolean; phones: string[] }[]>([]);
  const [selId, setSelId] = useState<string>("");
  const [enabled, setEnabled] = useState(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testState, setTestState] = useState<Record<string, { loading: boolean; ok?: boolean; text?: string }>>({});

  useEffect(() => {
    fetch("/api/superadmin/settings").then((r) => r.json()).then((d) => {
      if (d.ok) setCreds({ notifyLkUserId: d.notifyLkUserId || "", notifyLkApiKey: d.notifyLkApiKey || "", notifyLkServiceId: d.notifyLkServiceId || "" });
    }).catch(() => {});

    fetch("/api/superadmin/sms").then((r) => r.json()).then((d) => {
      if (d.ok && Array.isArray(d.tenants)) {
        setTenants(d.tenants);
        if (d.tenants.length > 0) selectTenant(d.tenants[0], d.tenants);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTenant(t: { id: string; name: string; enabled: boolean; phones: string[] }, list?: typeof tenants) {
    setSelId(t.id);
    setEnabled(t.enabled);
    setPhones(t.phones);
    setNewPhone("");
    setSaveMsg(null);
    setTestState({});
  }

  async function saveCreds() {
    setCredsSaving(true); setCredsMsg(null);
    const r = await fetch("/api/superadmin/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setCredsSaving(false);
    setCredsMsg(r.ok ? { ok: true, text: "Credentials saved" } : { ok: false, text: r.error || "Failed" });
    if (r.ok) setTimeout(() => setCredsMsg(null), 2000);
  }

  async function saveTenant() {
    if (!selId) return;
    setSaving(true); setSaveMsg(null);
    const r = await fetch("/api/superadmin/sms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: selId, enabled, phones }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setSaving(false);
    setSaveMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error || "Failed" });
    if (r.ok) {
      setTenants((ts) => ts.map((t) => t.id === selId ? { ...t, enabled, phones } : t));
      setTimeout(() => setSaveMsg(null), 2000);
    }
  }

  async function testPhone(phone: string) {
    setTestState((s) => ({ ...s, [phone]: { loading: true } }));
    const r = await fetch("/api/superadmin/sms-test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setTestState((s) => ({ ...s, [phone]: { loading: false, ok: r.ok, text: r.ok ? "Sent ✓" : (r.error || "Failed") } }));
    setTimeout(() => setTestState((s) => { const n = { ...s }; delete n[phone]; return n; }), 4000);
  }

  function addPhone() {
    const p = newPhone.trim();
    if (p && !phones.includes(p)) { setPhones((ps) => [...ps, p]); setNewPhone(""); }
  }

  const sel = tenants.find((t) => t.id === selId);
  const inp = "ui-input rounded-md border px-3 py-2 text-sm w-full";
  const G = "#16a34a";

  return (
    <div className="max-w-3xl space-y-4 ui-fade-up">
      <div>
        <h1 className="text-2xl font-bold">Notify.lk SMS</h1>
        <p className="text-sm text-gray-500">Manage SMS notification credentials and per-tenant phone numbers</p>
      </div>

      {/* ── API Credentials ── */}
      <div className="space-y-3 ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-key text-sm text-gray-500" />
          <div className="text-sm font-semibold text-gray-700">API Credentials</div>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">Global</span>
        </div>
        <p className="text-xs text-gray-500">
          These credentials are used to send all SMS notifications across all tenants via Notify.lk.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">User ID</div>
            <input className={inp} placeholder="29207" value={creds.notifyLkUserId} onChange={(e) => setCreds({ ...creds, notifyLkUserId: e.target.value })} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">API Key</div>
            <PasswordInput className={inp} placeholder="API Key" value={creds.notifyLkApiKey} onChange={(e: any) => setCreds({ ...creds, notifyLkApiKey: e.target.value })} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Service ID (Sender)</div>
            <input className={inp} placeholder="NotifyDEMO" value={creds.notifyLkServiceId} onChange={(e) => setCreds({ ...creds, notifyLkServiceId: e.target.value })} />
          </div>
        </div>
        {credsMsg && (
          <div className="rounded px-3 py-2 text-xs" style={{ background: credsMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: credsMsg.ok ? G : "#dc2626" }}>
            {credsMsg.text}
          </div>
        )}
        <button className="ui-btn ui-btn-primary px-3 py-1.5 text-sm disabled:opacity-50" onClick={saveCreds} disabled={credsSaving}>
          {credsSaving ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />Saving…</> : <><i className="fa-solid fa-floppy-disk mr-1" />Save Credentials</>}
        </button>
      </div>

      {/* ── Tenant selector + phone management ── */}
      <div className="ui-card bg-white p-4 space-y-4" style={{ borderColor: "#e2e8f0" }}>
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-building text-sm text-gray-500" />
          <div className="text-sm font-semibold text-gray-700">Tenant Numbers</div>
        </div>

        {tenants.length === 0 ? (
          <div className="text-xs text-gray-400 italic py-4 text-center">No tenants found</div>
        ) : (
          <>
            {/* Tenant tabs */}
            <div className="flex flex-wrap gap-2">
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTenant(t)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors border"
                  style={selId === t.id
                    ? { background: "#16c79a22", borderColor: "#16c79a", color: "#0a6b52" }
                    : { background: "#f8fafc", borderColor: "#e2e8f0", color: "#64748b" }}
                >
                  {t.name}
                  {t.enabled && t.phones.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-green-100 px-1.5 text-[9px] font-bold text-green-700">
                      {t.phones.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {sel && (
              <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: "#e2e8f0" }}>
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-gray-700">Enable SMS for {sel.name}</div>
                    <div className="text-[10px] text-gray-500">When disabled, no SMS will be sent for this tenant</div>
                  </div>
                  <button
                    onClick={() => setEnabled((v) => !v)}
                    className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors"
                    style={{ background: enabled ? "#16c79a" : "#d1d5db" }}
                  >
                    <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform" style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>

                {/* Phone list */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Notification Numbers</div>
                  {phones.length === 0 && (
                    <div className="py-1 text-xs italic text-gray-400">No numbers added yet</div>
                  )}
                  {phones.map((phone, i) => {
                    const ts = testState[phone];
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 rounded border px-2 py-1 text-xs font-mono tabular-nums text-gray-700" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
                            {phone}
                          </span>
                          <button
                            disabled={ts?.loading}
                            onClick={() => testPhone(phone)}
                            className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-50 transition-opacity"
                            style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)" }}
                            title="Send test SMS to this number"
                          >
                            {ts?.loading ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Test"}
                          </button>
                          <button
                            onClick={() => setPhones((ps) => ps.filter((_, j) => j !== i))}
                            className="flex h-6 w-6 items-center justify-center rounded text-xs text-red-400 hover:bg-red-50 transition-colors"
                            title="Remove"
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </div>
                        {ts && !ts.loading && ts.text && (
                          <div className="pl-1 text-[10px]" style={{ color: ts.ok ? G : "#dc2626" }}>{ts.text}</div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add phone input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none focus:border-[#16c79a]"
                      style={{ borderColor: "#e2e8f0", background: "#f8fafc", color: "#1e293b" }}
                      placeholder="+94771234567"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }}
                    />
                    <button
                      onClick={addPhone}
                      className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ background: "#16c79a" }}
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Save row */}
                {saveMsg && (
                  <div className="rounded px-3 py-2 text-xs" style={{ background: saveMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: saveMsg.ok ? G : "#dc2626" }}>
                    {saveMsg.text}
                  </div>
                )}
                <button
                  onClick={saveTenant}
                  disabled={saving}
                  className="ui-btn ui-btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {saving ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />Saving…</> : <><i className="fa-solid fa-floppy-disk mr-1" />Save</>}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
