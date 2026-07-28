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
        if (d.tenants.length > 0) selectTenant(d.tenants[0]);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTenant(t: { id: string; name: string; enabled: boolean; phones: string[] }) {
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
    if (p && !phones.includes(p)) {
      const updated = [...phones, p];
      setPhones(updated);
      setNewPhone("");
      setTenants((ts) => ts.map((t) => t.id === selId ? { ...t, phones: updated } : t));
    }
  }

  function removePhone(i: number) {
    const updated = phones.filter((_, j) => j !== i);
    setPhones(updated);
    setTenants((ts) => ts.map((t) => t.id === selId ? { ...t, phones: updated } : t));
  }

  const sel = tenants.find((t) => t.id === selId);
  const inp = "ui-input rounded-md border px-3 py-2 text-sm w-full";

  return (
    <div className="max-w-3xl space-y-4 ui-fade-up">
      <div>
        <h1 className="page-title">Notify.lk SMS</h1>
        <p className="page-sub">Manage SMS notification credentials and per-tenant phone numbers</p>
      </div>

      {/* ── API Credentials ── */}
      <div className="card space-y-3">
        <div className="card-title">
          <span><i className="fa-solid fa-key mr-2" />API Credentials</span>
          <span className="badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>Global</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)" }}>
          These credentials are used to send all SMS notifications across all tenants via Notify.lk.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 4 }}>User ID</div>
            <input className={inp} placeholder="29207" value={creds.notifyLkUserId} onChange={(e) => setCreds({ ...creds, notifyLkUserId: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 4 }}>API Key</div>
            <PasswordInput className={inp} placeholder="API Key" value={creds.notifyLkApiKey} onChange={(e: any) => setCreds({ ...creds, notifyLkApiKey: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 4 }}>Service ID (Sender)</div>
            <input className={inp} placeholder="NotifyDEMO" value={creds.notifyLkServiceId} onChange={(e) => setCreds({ ...creds, notifyLkServiceId: e.target.value })} />
          </div>
        </div>
        {credsMsg && (
          <div style={{ borderRadius: 8, padding: "8px 12px", fontSize: 12, background: credsMsg.ok ? "rgba(22,199,154,0.12)" : "rgba(239,68,68,0.1)", color: credsMsg.ok ? "var(--accent)" : "#f87171" }}>
            {credsMsg.text}
          </div>
        )}
        <button className="btn btn-gold" onClick={saveCreds} disabled={credsSaving}>
          {credsSaving ? <><i className="fa-solid fa-circle-notch fa-spin" /> Saving…</> : <><i className="fa-solid fa-floppy-disk" /> Save Credentials</>}
        </button>
      </div>

      {/* ── Tenant selector + phone management ── */}
      <div className="card space-y-4">
        <div className="card-title">
          <span><i className="fa-solid fa-building mr-2" />Tenant Numbers</span>
        </div>

        {tenants.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>No tenants found</div>
        ) : (
          <>
            {/* Tenant tabs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTenant(t)}
                  style={selId === t.id
                    ? { background: "rgba(22,199,154,0.15)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }
                    : { background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text2)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  {t.name}
                  {t.enabled && t.phones.length > 0 && (
                    <span style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: "rgba(22,199,154,0.2)", color: "var(--accent)", fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>
                      {t.phones.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {sel && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Enable toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Enable SMS for {sel.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>When disabled, no SMS will be sent for this tenant</div>
                  </div>
                  <button
                    onClick={() => setEnabled((v) => !v)}
                    style={{ position: "relative", display: "inline-flex", alignItems: "center", width: 36, height: 20, borderRadius: 999, border: "none", cursor: "pointer", background: enabled ? "var(--accent)" : "var(--border)", flexShrink: 0, transition: "background .2s" }}
                  >
                    <span style={{ position: "absolute", left: enabled ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "left .2s" }} />
                  </button>
                </div>

                {/* Phone list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text3)" }}>Notification Numbers</div>
                  {phones.length === 0 && (
                    <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", padding: "4px 0" }}>No numbers added yet</div>
                  )}
                  {phones.map((phone, i) => {
                    const ts = testState[phone];
                    return (
                      <div key={i}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", padding: "5px 10px", fontSize: 12, fontFamily: "monospace" }}>
                            {phone}
                          </span>
                          <button
                            disabled={ts?.loading}
                            onClick={() => testPhone(phone)}
                            title="Send test SMS to this number"
                            style={{ borderRadius: 7, padding: "5px 10px", fontSize: 10, fontWeight: 700, background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)", cursor: "pointer", opacity: ts?.loading ? 0.5 : 1 }}
                          >
                            {ts?.loading ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Test"}
                          </button>
                          <button
                            onClick={() => removePhone(i)}
                            title="Remove"
                            style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 12 }}
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </div>
                        {ts && !ts.loading && ts.text && (
                          <div style={{ fontSize: 10, paddingLeft: 4, marginTop: 2, color: ts.ok ? "var(--accent)" : "#f87171" }}>{ts.text}</div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add phone */}
                  <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                    <input
                      style={{ flex: 1, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      placeholder="+94771234567"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }}
                    />
                    <button
                      onClick={addPhone}
                      className="btn btn-gold"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {saveMsg && (
                  <div style={{ borderRadius: 8, padding: "8px 12px", fontSize: 12, background: saveMsg.ok ? "rgba(22,199,154,0.12)" : "rgba(239,68,68,0.1)", color: saveMsg.ok ? "var(--accent)" : "#f87171" }}>
                    {saveMsg.text}
                  </div>
                )}
                <div>
                  <button onClick={saveTenant} disabled={saving} className="btn btn-gold">
                    {saving ? <><i className="fa-solid fa-circle-notch fa-spin" /> Saving…</> : <><i className="fa-solid fa-floppy-disk" /> Save</>}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
