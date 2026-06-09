"use client";
import { useEffect, useState } from "react";

// In-desk Payment Methods manager (no page navigation). Shows ONLY the tenant's
// own deposit methods (add / edit / delete). When the tenant is allowed to add
// its own methods, the global platform-default list is hidden. Deposit/withdrawal
// requests are NOT shown here (those live in the desk Payments tab).
const NETS = ["BEP20", "ERC20", "TRC20"];

export default function PaymentMethodsModal({ onClose }: { onClose: () => void }) {
  const [allowed, setAllowed] = useState(false);
  const [own, setOwn] = useState<any[]>([]);
  const [globals, setGlobals] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [err, setErr] = useState("");

  async function load() {
    const m = await fetch("/api/admin/payment-methods").then((r) => r.json()).catch(() => ({}));
    if (m.ok) { setAllowed(!!m.allowed); setOwn(m.own || []); setGlobals(m.globals || []); }
  }
  useEffect(() => { load(); }, []);

  async function post(body: any, after?: () => void) {
    setErr("");
    const r = await fetch("/api/admin/payment-methods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    if (after) after();
    load();
  }
  function saveMethod() {
    const e = edit; if (!e) return;
    if (e.type === "CRYPTO" && !e.address) { setErr("Address required"); return; }
    if (e.type === "UPI" && !e.address) { setErr("UPI id required"); return; }
    if (e.type === "LINK" && !e.url) { setErr("Link URL required"); return; }
    const payload = { type: e.type, network: e.network, asset: e.asset, address: e.address, label: e.label, url: e.url, active: e.active !== false };
    post(e.id ? { ...payload, action: "update", id: e.id } : { ...payload, action: "add" }, () => setEdit(null));
  }
  function newMethod(type: string) {
    setEdit(type === "CRYPTO" ? { type, network: "BEP20", asset: "USDT", address: "", active: true }
      : type === "UPI" ? { type, asset: "UPI", address: "", label: "", active: true }
        : { type, label: "Local Payment", url: "", active: true });
  }

  const inp = "w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bg)] text-[var(--text)] border-[var(--border)] outline-none focus:border-[var(--accent)]";
  const ovl = "fixed inset-0 z-[120] flex items-center justify-center bg-black/20 p-6";
  const card = "ui-pop desk-modal rounded-2xl border p-5 shadow-2xl bg-[var(--panel)] text-[var(--text)] border-[var(--border)]";
  const typeBadge = (t: string) => t === "UPI" ? { bg: "rgba(14,116,144,.18)", c: "#22d3ee" } : t === "LINK" ? { bg: "rgba(217,119,6,.18)", c: "#f59e0b" } : { bg: "var(--soft)", c: "var(--muted)" };

  function MethodRow({ w }: { w: any }) {
    const tb = typeBadge(w.type);
    return (<div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--soft)] p-2">
      <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: tb.bg, color: tb.c }}>{w.type === "CRYPTO" ? w.network : w.type}</span>
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{w.label || w.asset}</div><div className="break-all text-xs text-[var(--muted)]">{w.type === "LINK" ? w.url : w.address}</div></div>
      <span className="text-xs" style={{ color: w.active ? "#16a34a" : "var(--muted)" }}>{w.active ? "Active" : "Off"}</span>
      <button title="Edit" className="rounded px-2 py-1" style={{ background: "var(--soft)", color: "var(--accent)" }} onClick={() => setEdit({ ...w })}><i className="fa-solid fa-pen" /></button>
      <button title="Delete" className="rounded px-2 py-1" style={{ background: "rgba(220,38,38,.15)", color: "#dc2626" }} onClick={() => setConfirmDel(w)}><i className="fa-solid fa-trash" /></button>
    </div>);
  }

  return (
    <div className={ovl} onMouseDown={onClose}>
      <div className={card + " w-[560px] max-w-[95vw] max-h-[88vh] overflow-auto"} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">My Payment Methods</div>
            <div className="text-[11px] text-[var(--muted)]">Shown to your clients on the deposit page.</div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
        </div>

        {!allowed ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] p-4 text-center text-sm text-[var(--muted)]">
            Your plan doesn&apos;t allow adding your own payment methods. Contact the platform owner to enable this.
          </div>
        ) : (<>
          <div className="mb-3 flex justify-end gap-1.5">
            <button className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--accent)" }} onClick={() => newMethod("CRYPTO")}>+ Crypto</button>
            <button className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]" onClick={() => newMethod("UPI")}>+ UPI</button>
            <button className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]" onClick={() => newMethod("LINK")}>+ Local Link</button>
          </div>
          <div className="space-y-2">
            {own.map((w) => <MethodRow key={w.id} w={w} />)}
            {own.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] py-6 text-center text-sm text-[var(--muted)]">No methods added yet. Add one above.</div>}
          </div>
          {/* Global/platform defaults are intentionally NOT shown once the tenant can
              manage its own methods (clients see only the tenant's methods then). */}
        </>)}

        {err && <div className="mt-3 text-sm text-red-500">{err}</div>}

        {/* Edit / Add */}
        {edit && (
          <div className={ovl} onMouseDown={() => setEdit(null)}>
            <div className={card + " w-[420px]"} onMouseDown={(e) => e.stopPropagation()}>
              <div className="mb-3 text-base font-semibold">{edit.id ? "Edit" : "Add"} {edit.type === "CRYPTO" ? "Crypto Wallet" : edit.type === "UPI" ? "UPI" : "Local Link"}</div>
              <div className="space-y-2">
                {edit.type === "CRYPTO" && (<>
                  <select className={inp} value={edit.network} onChange={(e) => setEdit({ ...edit, network: e.target.value })}>{NETS.map((n) => <option key={n}>{n}</option>)}</select>
                  <input className={inp} placeholder="Asset (e.g. USDT)" value={edit.asset || ""} onChange={(e) => setEdit({ ...edit, asset: e.target.value })} />
                  <input className={inp} placeholder="Wallet address" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                </>)}
                {edit.type === "UPI" && (<>
                  <input className={inp} placeholder="Label (e.g. GPay / PhonePe)" value={edit.label || ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                  <input className={inp} placeholder="UPI id (name@bank)" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                </>)}
                {edit.type === "LINK" && (<>
                  <input className={inp} placeholder="Label (e.g. Local Payment)" value={edit.label || ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                  <input className={inp} placeholder="https://payment-partner.com/..." value={edit.url || ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
                </>)}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]" onClick={() => setEdit(null)}>Cancel</button>
                <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--accent)" }} onClick={saveMethod}>Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {confirmDel && (
          <div className={ovl} onMouseDown={() => setConfirmDel(null)}>
            <div className={card + " w-[360px]"} onMouseDown={(e) => e.stopPropagation()}>
              <div className="mb-1 font-semibold text-red-500">Delete method?</div>
              <div className="mb-3 text-xs text-[var(--muted)]">{confirmDel.label || confirmDel.address || confirmDel.url}</div>
              <div className="flex justify-end gap-2">
                <button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]" onClick={() => setConfirmDel(null)}>Cancel</button>
                <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: "#dc2626" }} onClick={() => { post({ action: "delete", id: confirmDel.id }); setConfirmDel(null); }}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
