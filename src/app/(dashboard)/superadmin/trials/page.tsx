"use client";
import { useEffect, useState, useCallback } from "react";

type Trial = { id: string; name: string; subdomain: string; customDomain: string | null; plan: string; endsAt: string | null; clients: number; daysLeft: number | null; expired: boolean; adminEmail: string | null; supportEmail: string | null };

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition"
      style={{ background: copied ? "rgba(22,199,154,.18)" : "rgba(255,255,255,.08)", color: copied ? "#16c79a" : "#94a3b8" }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function SATrials() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [baseDomain, setBaseDomain] = useState("cubexenterprises.com");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [confirmDel, setConfirmDel] = useState<Trial | null>(null);
  const [welcome, setWelcome] = useState<{ trial: Trial; pw: string; to: string; sending: boolean; sent: boolean } | null>(null);
  // Keep the last generated password per tenant so reopening shows the same one until Applied.
  const [savedPw, setSavedPw] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { const d = await fetch("/api/superadmin/trials").then((r) => r.json()); if (d.ok) { setTrials(d.trials || []); setBaseDomain(d.baseDomain || "cubexenterprises.com"); } } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, body: any, ok?: string) {
    setErr(""); setMsg("");
    const r = await fetch("/api/superadmin/outsource/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Failed"); return false; }
    if (ok) setMsg(ok);
    load();
    return true;
  }

  const extend = (t: Trial, days: number) => act(t.id, { action: "updateSub", status: "TRIALING", endsAt: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }, `Extended ${t.name} by ${days} days`);
  const convert = (t: Trial) => act(t.id, { action: "updateSub", status: "ACTIVE", endsAt: null }, `${t.name} converted to paid`);
  const seed = (t: Trial) => act(t.id, { action: "seedDemo" }, `Seeded demo data for ${t.name}`);
  const urlFor = (t: Trial) => "https://" + (t.customDomain || `${t.subdomain}.${baseDomain}`);

  function openWelcome(t: Trial) {
    const pw = savedPw[t.id] || genPassword();
    if (!savedPw[t.id]) setSavedPw((p) => ({ ...p, [t.id]: pw }));
    setWelcome({ trial: t, pw, to: t.supportEmail || "", sending: false, sent: false });
  }

  async function applyWelcome(sendEmail: boolean) {
    if (!welcome) return;
    const { trial, pw, to } = welcome;
    if (sendEmail && !to.trim()) { setErr("Enter the prospect email to send to"); return; }
    setWelcome({ ...welcome, sending: true });
    const body: any = { action: "sendWelcome", password: pw };
    if (sendEmail) body.to = to.trim();
    else body.to = "__skip__"; // signal server: set pw but don't send email
    const r = await fetch("/api/superadmin/outsource/" + trial.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Failed"); setWelcome({ ...welcome, sending: false }); return; }
    setWelcome({ ...welcome, sending: false, sent: true });
    setMsg(sendEmail ? `Welcome email sent to ${to.trim()} for ${trial.name}` : `Password set for ${trial.name}`);
    // Clear saved password after apply so next open generates a fresh one
    setSavedPw((p) => { const n = { ...p }; delete n[trial.id]; return n; });
    load();
  }

  const sec = { background: "var(--bg2)", color: "var(--text)", border: "1px solid var(--border)" } as React.CSSProperties;

  return (<div className="max-w-5xl space-y-4 ui-fade-up">
    <div><h1 className="text-2xl font-bold">Demo Trials</h1><p className="text-sm text-gray-500">All tenants on a trial — extend, convert to paid, seed demo data, or delete.</p></div>
    {err && <div className="text-sm text-red-500">{err}</div>}{msg && <div className="text-sm text-green-500">{msg}</div>}

    <div className="ui-card bg-white p-0" style={{ borderColor: "#e2e8f0", overflow: "hidden" }}>
      {trials.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No active trials. Start one from Tenants → Subscription → "Start 30-day trial".</div> : (
        <div className="divide-y" style={{ borderColor: "#e2e8f0" }}>
          {trials.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 p-3" style={{ borderColor: "#e2e8f0" }}>
              <div className="min-w-[180px] flex-1">
                <div className="font-semibold">{t.name}</div>
                <a href={urlFor(t)} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">{urlFor(t).replace("https://", "")}</a>
                <div className="text-[11px] text-gray-400">{t.clients} client{t.clients === 1 ? "" : "s"} · {t.plan}</div>
              </div>
              <div className="text-center">
                {t.expired
                  ? <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "rgba(246,70,93,.16)", color: "#f6465d" }}>Expired</span>
                  : <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: (t.daysLeft ?? 99) <= 5 ? "rgba(234,179,8,.18)" : "rgba(22,199,154,.16)", color: (t.daysLeft ?? 99) <= 5 ? "#b45309" : "#0f9d77" }}>{t.daysLeft} days left</span>}
                {t.endsAt && <div className="mt-1 text-[10px] text-gray-400">ends {new Date(t.endsAt).toLocaleDateString()}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => openWelcome(t)} className="px-2.5 py-1.5 text-xs font-semibold" style={sec}><i className="fa-solid fa-key mr-1" />Credentials</button>
                <button onClick={() => extend(t, 30)} className="px-2.5 py-1.5 text-xs font-semibold" style={sec}>+30d</button>
                <button onClick={() => seed(t)} className="px-2.5 py-1.5 text-xs font-semibold" style={sec}>Seed data</button>
                <button onClick={() => convert(t)} className="px-2.5 py-1.5 text-xs font-semibold" style={{ background: "var(--accent)", color: "#04221c", border: "none" }}>Convert</button>
                <button onClick={() => setConfirmDel(t)} className="px-2.5 py-1.5 text-xs font-semibold" style={{ background: "color-mix(in srgb, var(--red) 14%, transparent)", color: "var(--red)", border: "1px solid color-mix(in srgb, var(--red) 35%, transparent)" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Credentials Modal */}
    {welcome && (() => {
      const { trial, pw, to, sending, sent } = welcome;
      const url = urlFor(trial);
      const adminEmail = trial.adminEmail || `admin@${trial.subdomain}.demo`;
      const clientEmail = `client@${trial.subdomain}.demo`;
      const allText = `Platform: ${url}\nAdmin: ${adminEmail} / ${pw}\nClient: ${clientEmail} / ${pw}${trial.endsAt ? `\nExpires: ${new Date(trial.endsAt).toLocaleDateString()}` : ""}`;
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="ui-card ui-pop w-full max-w-md rounded-xl p-5" style={{ background: "var(--bg)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-bold text-base">{trial.name} — Demo Credentials</div>
                <div className="text-xs text-gray-400 mt-0.5">{url.replace("https://", "")}</div>
              </div>
              <button onClick={() => setWelcome(null)} className="text-gray-400 hover:text-gray-200 text-lg leading-none">✕</button>
            </div>

            {/* Password row */}
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Auto-generated Password</div>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <span className="font-mono text-sm font-bold flex-1" style={{ color: "var(--accent)" }}>{pw}</span>
                <CopyBtn text={pw} />
                <button onClick={() => { const np = genPassword(); setSavedPw((p) => ({ ...p, [welcome.trial.id]: np })); setWelcome({ ...welcome, pw: np, sent: false }); }} className="text-xs text-gray-400 hover:text-gray-200 ml-1" title="Generate new">↻</button>
              </div>
            </div>

            {/* Credentials block */}
            <div className="mb-4 rounded-lg p-3 space-y-2 text-sm" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs w-20">URL</span>
                <span className="font-mono text-xs flex-1 truncate">{url}</span>
                <CopyBtn text={url} />
              </div>
              <div className="border-t" style={{ borderColor: "var(--border)" }} />
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin Login</div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs w-20">Email</span>
                <span className="font-mono text-xs flex-1">{adminEmail}</span>
                <CopyBtn text={adminEmail} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs w-20">Password</span>
                <span className="font-mono text-xs flex-1">{pw}</span>
                <CopyBtn text={pw} />
              </div>
              <div className="border-t" style={{ borderColor: "var(--border)" }} />
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Client Login</div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs w-20">Email</span>
                <span className="font-mono text-xs flex-1">{clientEmail}</span>
                <CopyBtn text={clientEmail} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs w-20">Password</span>
                <span className="font-mono text-xs flex-1">{pw}</span>
                <CopyBtn text={pw} />
              </div>
              {trial.endsAt && (
                <><div className="border-t" style={{ borderColor: "var(--border)" }} />
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs w-20">Expires</span>
                  <span className="text-xs flex-1">{new Date(trial.endsAt).toLocaleDateString()}</span>
                </div></>
              )}
            </div>

            {/* Copy all */}
            <div className="mb-4 flex justify-end">
              <CopyBtn text={allText} />
              <span className="text-xs text-gray-400 ml-1 self-center">Copy all credentials</span>
            </div>

            {/* Optional email send */}
            <div className="border-t pt-4 space-y-2" style={{ borderColor: "var(--border)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Send via Email (optional)</div>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text)" }}
                placeholder="Prospect email address"
                type="email"
                value={to}
                onChange={(e) => setWelcome({ ...welcome, to: e.target.value, sent: false })}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => applyWelcome(false)}
                  disabled={sending}
                  className="flex-1 rounded-lg py-2 text-sm font-semibold"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text)", opacity: sending ? .5 : 1 }}>
                  {sent ? "✓ Applied" : "Apply (no email)"}
                </button>
                <button
                  onClick={() => applyWelcome(true)}
                  disabled={sending || !to.trim()}
                  className="flex-1 rounded-lg py-2 text-sm font-semibold"
                  style={{ background: "var(--accent)", color: "#04221c", opacity: (sending || !to.trim()) ? .5 : 1 }}>
                  {sending ? "Sending…" : sent ? "✓ Sent" : "Apply & Send Email"}
                </button>
              </div>
              <p className="text-[10px] text-gray-400">Applying sets this password on the admin &amp; client accounts. You can then copy and share credentials manually (WhatsApp, chat, etc.).</p>
            </div>
          </div>
        </div>
      );
    })()}

    {confirmDel && (<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6">
      <div className="ui-card ui-pop w-[380px] bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold text-red-600">Delete demo tenant?</div>
        <div className="mb-3 text-xs text-gray-500">{confirmDel.name} and all its clients/data will be permanently removed. This cannot be undone.</div>
        <div className="flex justify-end gap-2"><button className="ui-btn px-3 py-1.5 text-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="ui-btn px-3 py-1.5 text-sm text-white" style={{ background: "#dc2626", borderColor: "transparent" }} onClick={() => { act(confirmDel.id, { action: "delete" }, "Demo deleted"); setConfirmDel(null); }}>Delete</button></div>
      </div>
    </div>)}
  </div>);
}
