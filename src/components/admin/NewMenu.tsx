"use client";
import { useEffect, useState } from "react";
import { BUY, SELL } from "@/config/theme";
import PasswordInput from "@/components/ui/PasswordInput";
import CountrySelect from "@/components/ui/CountrySelect";

export default function NewMenu({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<"" | "client" | "manager" | "group" | "notify">("");
  const [form, setForm] = useState<any>({ type: "LIVE", leverage: 100, currency: "USD" });
  const [managers, setManagers] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => { fetch("/api/admin/managers").then((r) => r.json()).then((d) => { if (d.ok) setManagers(d.managers || []); }).catch(() => {}); }, [modal]);

  function openModal(k: any) { setOpen(false); setErr(""); setForm({ type: "LIVE", leverage: 100, currency: "USD" }); setModal(k); }
  const f = (k: string, v: any) => setForm((o: any) => ({ ...o, [k]: v }));
  async function submit(url: string, body: any) {
    setErr("");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setModal(""); onCreated();
  }
  const inp = "ui-input mt-1 w-full bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]";
  const lab = "text-[10px] text-[var(--muted)]";

  return (<>
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="ui-btn ui-btn-primary px-3 py-1 text-[11px]" style={{ background: "var(--accent)", color: "#fff" }}>New +</button>
      {open && (<>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="ui-pop absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border text-[11px] shadow-lg" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <button onClick={() => openModal("client")} className="ui-row block w-full px-3 py-1.5 text-left">New Client</button>
          <button onClick={() => openModal("manager")} className="ui-row block w-full px-3 py-1.5 text-left">New Manager</button>
          <button onClick={() => openModal("group")} className="ui-row block w-full px-3 py-1.5 text-left">New Group</button>
          <button onClick={() => openModal("notify")} className="ui-row block w-full px-3 py-1.5 text-left">Send Notification</button>
        </div>
      </>)}
    </div>

    {modal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.5)" }}>
        <div className="ui-card ui-pop w-[330px] p-4 text-left" style={{ background: "var(--panel)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 text-sm font-semibold">{modal === "client" ? "New Client" : modal === "manager" ? "New Manager" : modal === "group" ? "New Group" : "Send Notification"}</div>

          {modal === "client" && (<>
            <div className="flex gap-1">
              <button onClick={() => f("type", "LIVE")} className="ui-transition flex-1 rounded-xl py-1.5 text-xs" style={form.type === "LIVE" ? { background: BUY, color: "#04140e" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Live</button>
              <button onClick={() => f("type", "DEMO")} className="ui-transition flex-1 rounded-xl py-1.5 text-xs" style={form.type === "DEMO" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Demo</button>
            </div>
            <div className={lab + " mt-2"}>Name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
            <div className={lab + " mt-2"}>Phone</div><input className={inp} value={form.phone || ""} onChange={(e) => f("phone", e.target.value)} />
            <div className={lab + " mt-2"}>Email</div><input className={inp} value={form.email || ""} onChange={(e) => f("email", e.target.value)} />
            <div className={lab + " mt-2"}>Password</div><PasswordInput className={inp} value={form.password || ""} onChange={(e) => f("password", e.target.value)} />
            <div className={lab + " mt-2"}>Country</div><CountrySelect className={inp} value={form.country || ""} onChange={(v) => f("country", v)} />
            <label className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}><input type="checkbox" checked={!!form.isPool} onChange={(e) => f("isPool", e.target.checked)} /> Pool account</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><div className={lab}>Leverage</div><input type="number" className={inp} value={form.leverage} onChange={(e) => f("leverage", Number(e.target.value))} /></div>
              <div><div className={lab}>Currency</div><select className={inp} value={form.currency} onChange={(e) => f("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
            </div>
            <div className={lab + " mt-2"}>Manager (optional)</div>
            <select className={inp} value={form.managerId || ""} onChange={(e) => f("managerId", e.target.value || null)}><option value="">- none -</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <button onClick={() => submit("/api/admin/clients", { name: form.name, email: form.email, password: form.password, type: form.type, leverage: Number(form.leverage) || 100, currency: form.currency, managerId: form.managerId || null, phone: form.phone, country: form.country, isPool: !!form.isPool })} className="ui-btn mt-3 w-full py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Create {form.type} Client</button>
          </>)}

          {modal === "manager" && (<>
            <div className={lab + " mt-1"}>Name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
            <div className={lab + " mt-2"}>Email</div><input className={inp} value={form.email || ""} onChange={(e) => f("email", e.target.value)} />
            <div className={lab + " mt-2"}>Password</div><input className={inp} value={form.password || ""} onChange={(e) => f("password", e.target.value)} />
            <button onClick={() => submit("/api/admin/managers", { name: form.name, email: form.email, password: form.password })} className="ui-btn mt-3 w-full py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Create Manager</button>
          </>)}

          {modal === "group" && (<>
            <div className={lab + " mt-1"}>Group name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
            <button onClick={() => submit("/api/admin/groups", { name: form.name, spread: 0 })} className="ui-btn mt-3 w-full py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Create Group</button>
          </>)}

          {modal === "notify" && (<>
            <div className={lab + " mt-1"}>Title</div><input className={inp} value={form.title || ""} onChange={(e) => f("title", e.target.value)} />
            <div className={lab + " mt-2"}>Message</div><textarea className={inp} rows={3} value={form.body || ""} onChange={(e) => f("body", e.target.value)} />
            <button onClick={() => submit("/api/admin/broadcast", { title: form.title, body: form.body })} className="ui-btn mt-3 w-full py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Send to all clients</button>
          </>)}

          {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
          <button onClick={() => setModal("")} className="ui-btn ui-btn-ghost mt-2 w-full py-1.5 text-xs">Cancel</button>
        </div>
      </div>
    )}
  </>);
}
