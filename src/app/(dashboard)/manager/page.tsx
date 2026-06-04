"use client";
import { useEffect, useState } from "react";

const BUY = "#2f81f7";
const SELL = "#e05260";
const GOLD = "#e3a855";

export default function ManagerPage() {
  const [tab, setTab] = useState<"clients" | "trades">("clients");
  const [clients, setClients] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("ALL");
  const [statusF, setStatusF] = useState("ALL");
  const [act, setAct] = useState<any>(null);
  const [aform, setAform] = useState<any>({});
  const [err, setErr] = useState("");

  async function load() {
    const [c, t] = await Promise.all([
      fetch("/api/admin/clients").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/desk/trades").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
    if (c.ok) setClients(c.clients);
    if (t.ok) setTrades(t.trades);
  }
  useEffect(() => { load(); }, []);

  async function manage(id: string, action: string, extra: any = {}) {
    setErr("");
    const r = await fetch("/api/admin/clients/" + id + "/manage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }

  function openEdit(c: any) {
    setErr("");
    setAform({ name: c.name, email: c.user?.email || "", phone: c.phone || "", country: c.country || "" });
    setAct({ kind: "rename", acc: c });
  }

  async function submitEdit() {
    if (!act) return;
    await manage(act.acc.id, "rename", { name: aform.name, email: aform.email, country: aform.country });
    setAct(null);
  }

  const balOf = (c: any) => Number(c.deposit) - Number(c.withdrawal) + Number(c.credit) + Number(c.bonus) + Number(c.pnl);

  const rows = clients.filter((c: any) => {
    if (typeF !== "ALL" && c.type !== typeF) return false;
    if (statusF === "ACTIVE" && (c.locked || c.deactivated)) return false;
    if (statusF === "LOCKED" && !c.locked) return false;
    if (statusF === "INACTIVE" && !c.deactivated) return false;
    if (q) {
      const sq = q.toLowerCase();
      const email = c.user?.email || c.email || "";
      if (!(c.login.toLowerCase().includes(sq) || c.name.toLowerCase().includes(sq) || email.toLowerCase().includes(sq))) return false;
    }
    return true;
  });

  const inp = "w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)]";

  return (
    <div className="flex h-full flex-col gap-0">
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-4 py-2 text-sm">
        <button onClick={() => setTab("clients")} className="rounded px-3 py-1.5" style={tab === "clients" ? { background: "var(--brand-primary)", color: "#fff" } : { color: "var(--muted-foreground)" }}>
          Clients ({clients.length})
        </button>
        <button onClick={() => setTab("trades")} className="rounded px-3 py-1.5" style={tab === "trades" ? { background: "var(--brand-primary)", color: "#fff" } : { color: "var(--muted-foreground)" }}>
          Open Trades ({trades.length})
        </button>
      </div>

      {err && <div className="px-4 py-1 text-xs text-red-500">{err}</div>}

      {tab === "clients" && (
        <div className="flex flex-col flex-1 overflow-hidden p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search login / name / email" className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm min-w-[200px] flex-1" style={{ color: "var(--foreground)" }} />
            <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm" style={{ color: "var(--foreground)" }}>
              <option value="ALL">All Types</option><option value="LIVE">Live</option><option value="DEMO">Demo</option>
            </select>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm" style={{ color: "var(--foreground)" }}>
              <option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="LOCKED">Locked</option><option value="INACTIVE">Inactive</option>
            </select>
            <span className="text-sm" style={{ color: "var(--muted-foreground)", alignSelf: "center" }}>{rows.length} clients</span>
          </div>
          <div className="flex-1 overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "var(--card)" }}>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Login", "Name / Email", "Phone", "Country", "Type", "Balance", "Online", "Last IP", "Status", "Joined", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="px-3 py-4 text-sm" style={{ color: "var(--muted-foreground)" }} colSpan={11}>No clients assigned to you.</td></tr>
                ) : rows.map((c: any) => {
                  const email = c.user?.email || c.email || "—";
                  const lastIp = c.user?.lastLoginIp || "—";
                  const bal = balOf(c);
                  const isActive = !c.locked && !c.deactivated;
                  return (
                    <tr key={c.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td className="px-3 py-2 font-medium">
                        {c.login}
                        {c.isPool && <span className="ml-1 text-[10px] rounded px-1" style={{ background: GOLD + "22", color: GOLD }}>POOL</span>}
                      </td>
                      <td className="px-3 py-2">
                        {c.name}
                        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{email}</div>
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{c.phone || "—"}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{c.country || "—"}</td>
                      <td className="px-3 py-2 text-xs">{c.type}</td>
                      <td className="px-3 py-2 text-right" style={{ color: bal >= 0 ? BUY : SELL }}>
                        {bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={"inline-block h-2 w-2 rounded-full " + (c.isOnline ? "bg-green-500" : "bg-gray-400")} title={c.isOnline ? "Online" : "Offline"} />
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{lastIp}</td>
                      <td className="px-3 py-2">
                        <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: (c.deactivated ? GOLD : c.locked ? SELL : BUY) + "22", color: c.deactivated ? GOLD : c.locked ? SELL : BUY }}>
                          {c.deactivated ? "Inactive" : c.locked ? "Locked" : "Active"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button title="Edit details" onClick={() => openEdit(c)} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <i className="fa-solid fa-pen-to-square" style={{ color: BUY }} />
                        </button>
                        <button title={c.locked ? "Unlock" : "Lock"} onClick={() => manage(c.id, "status", { locked: !c.locked })} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <i className={"fa-solid " + (c.locked ? "fa-lock-open" : "fa-lock")} style={{ color: c.locked ? BUY : SELL }} />
                        </button>
                        <button title={c.deactivated ? "Activate" : "Deactivate"} onClick={() => manage(c.id, "deactivate", { deactivated: !c.deactivated })} className="mr-1 rounded px-2 py-1 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <i className={"fa-solid " + (c.deactivated ? "fa-circle-check" : "fa-ban")} style={{ color: GOLD }} />
                        </button>
                        <button title={c.isPool ? "Demote from Pool" : "Promote to Pool"} onClick={() => manage(c.id, "pool", { promote: !c.isPool })} className="rounded px-2 py-1 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                          <i className={"fa-solid " + (c.isPool ? "fa-circle-minus" : "fa-circle-plus")} style={{ color: "#a78bfa" }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "trades" && (
        <div className="flex-1 overflow-auto p-4">
          <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--card)" }}>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Ticket", "Account", "Symbol", "Side", "Lots", "Open Price", "S/L", "T/P", "Opened"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr><td className="px-3 py-4 text-sm" style={{ color: "var(--muted-foreground)" }} colSpan={9}>No open trades.</td></tr>
                ) : trades.map((t: any) => (
                  <tr key={t.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2 font-mono">{t.ticket}</td>
                    <td className="px-3 py-2">{t.accountLogin}<span className="ml-1 text-xs" style={{ color: "var(--muted-foreground)" }}>{t.accountName}</span></td>
                    <td className="px-3 py-2">{t.symbol}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: t.type === "BUY" ? BUY : SELL }}>{t.type}</td>
                    <td className="px-3 py-2">{t.lots}</td>
                    <td className="px-3 py-2 font-mono">{Number(t.openPrice).toFixed(5)}</td>
                    <td className="px-3 py-2 font-mono">{t.sl ? Number(t.sl).toFixed(5) : "—"}</td>
                    <td className="px-3 py-2 font-mono">{t.tp ? Number(t.tp).toFixed(5) : "—"}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(t.openedAt || t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {act && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setAct(null)}>
          <div className="w-[360px] rounded-lg border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold" style={{ color: "var(--foreground)" }}>Edit Client — {act.acc.login}</div>
            <div className="space-y-2">
              <div><label className="text-xs mb-1 block" style={{ color: "var(--muted-foreground)" }}>Name</label><input className={inp} value={aform.name} onChange={(e) => setAform({ ...aform, name: e.target.value })} /></div>
              <div><label className="text-xs mb-1 block" style={{ color: "var(--muted-foreground)" }}>Phone</label><input className={inp} value={aform.phone} onChange={(e) => setAform({ ...aform, phone: e.target.value })} /></div>
              <div><label className="text-xs mb-1 block" style={{ color: "var(--muted-foreground)" }}>Country</label><input className={inp} value={aform.country} onChange={(e) => setAform({ ...aform, country: e.target.value })} /></div>
            </div>
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setAct(null)}>Cancel</button>
              <button className="flex-1 rounded px-3 py-2 text-sm text-white" style={{ background: "var(--brand-primary)" }} onClick={submitEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
