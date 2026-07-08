"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import { ADSS_DARK, ADSS_LIGHT, ADSS_FONT, BUY, SELL, BUYBTN, SELLBTN } from "@/config/theme";
import { gnum, gmoney, gsign } from "@/lib/format";
import { contractFor } from "@/config/contracts";
import instruments from "@/config/instruments";

function dg(sym: string) { return instruments[sym]?.digits ?? 5; }
function ago(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 2) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}
function catOf(sym: string) {
  if (/^(XAU|XAG|XPT|XPD)/.test(sym)) return "metals";
  if (sym.endsWith("USDT") || sym.endsWith("BTC") || sym.endsWith("ETH")) return "crypto";
  return "forex";
}
function pnlOf(p: any, price: number) {
  const sym = String(p.symbol || "");
  const dir = (p.type || p.side) === "BUY" ? 1 : -1;
  const cs = contractFor(catOf(sym), sym);
  const diff = (price - p.openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  let pf = diff * p.lots * (cs || 100000);
  if (isFx && /^USD/i.test(sym)) pf = pf / (price || 1);
  return pf;
}

const TABS = ["Overview", "Clients", "Positions", "History", "Requests"] as const;

export default function ManagerDashboard() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { const t = localStorage.getItem("cubex-theme"); if (t === "light" || t === "dark") setTheme(t); }, []);
  function toggleTheme() { setTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("cubex-theme", n); return n; }); }
  const cv = theme === "dark" ? ADSS_DARK : ADSS_LIGHT;

  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: "", logoUrl: null });
  const [clients, setClients] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [liveSpread, setLiveSpread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [posLoaded, setPosLoaded] = useState(false);
  const [histLoaded, setHistLoaded] = useState(false);
  const [reqLoaded, setReqLoaded] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [histSearch, setHistSearch] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  // clock for position P&L refresh
  useEffect(() => { const iv = setInterval(() => setNowMs(Date.now()), 5000); return () => clearInterval(iv); }, []);

  // Brand + self info
  useEffect(() => {
    fetch("/api/public/brand").then((r) => r.json()).then((d) => { if (d.ok) setBrand({ name: d.brand?.brandName || d.brand?.name || "", logoUrl: d.brand?.logoUrl || null }); }).catch(() => {});
    fetch("/api/auth/ping").then((r) => r.json()).then((d) => { if (d.ok && d.session) setMe({ name: d.session.name || d.session.email, email: d.session.email }); setLoading(false); }).catch(() => { setLoading(false); });
  }, []);

  // Socket for live prices
  useEffect(() => {
    const sock = io({ path: "/api/socketio", transports: ["websocket"] });
    socketRef.current = sock;
    sock.on("prices", (data: any) => {
      startTransition(() => {
        if (data.prices) setPrices((p) => ({ ...p, ...data.prices }));
        if (data.spreads) setLiveSpread((s) => ({ ...s, ...data.spreads }));
      });
    });
    return () => { sock.disconnect(); };
  }, []);

  // Tab data loading
  useEffect(() => {
    if ((tab === "Overview" || tab === "Clients") && !clientsLoaded) {
      fetch("/api/manager/clients").then((r) => r.json()).then((d) => { if (d.ok) { setClients(d.clients || []); setClientsLoaded(true); } }).catch(() => {});
    }
    if ((tab === "Overview" || tab === "Positions") && !posLoaded) {
      fetch("/api/desk/trades").then((r) => r.json()).then((d) => { if (d.ok) { setPositions(d.trades || []); setPosLoaded(true); } }).catch(() => {});
    }
    if (tab === "History" && !histLoaded) {
      fetch("/api/desk/history").then((r) => r.json()).then((d) => { if (d.ok) { setHistory((d.history || []).filter((h: any) => h.kind === "TRADE" || h.pnl !== undefined)); setHistLoaded(true); } }).catch(() => {});
    }
    if ((tab === "Overview" || tab === "Requests") && !reqLoaded) {
      fetch("/api/manager/payments").then((r) => r.json()).then((d) => { if (d.ok) { setRequests(d.requests || []); setReqLoaded(true); } }).catch(() => {});
    }
    if (tab === "Overview" && !auditLoaded) {
      fetch("/api/manager/audit").then((r) => r.json()).then((d) => { if (d.ok) { setAuditLogs(d.logs || []); setAuditLoaded(true); } }).catch(() => {});
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived KPIs
  const totalBalance = clients.reduce((s, c) => s + Number(c.deposit ?? 0) + Number(c.credit ?? 0) + Number(c.bonus ?? 0) - Number(c.withdrawal ?? 0), 0);
  const floatPnl = positions.reduce((s, p) => { const price = prices[p.symbol]; return s + (price != null ? pnlOf(p, price) : 0); }, 0);
  const totalEquity = totalBalance + floatPnl + clients.reduce((s, c) => s + Number(c.pnl ?? 0), 0);
  const pendingReqs = requests.filter((r) => r.status === "PENDING").length;
  const activePositions = positions.length;
  const onlineClients = clients.filter((c) => c.isOnline).length;

  const filteredClients = clients.filter((c) =>
    !clientSearch || c.name?.toLowerCase().includes(clientSearch.toLowerCase()) || c.login?.includes(clientSearch) || c.email?.toLowerCase().includes(clientSearch.toLowerCase())
  );
  const filteredHist = history.filter((h: any) =>
    !histSearch || h.symbol?.toLowerCase().includes(histSearch.toLowerCase()) || h.accountLogin?.includes(histSearch)
  );

  function kpi(label: string, value: string, sub?: string, color?: string) {
    return (
      <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
        <div className="mt-1 text-[20px] font-bold tabular-nums" style={{ color: color || "var(--text)" }}>{value}</div>
        {sub && <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>{sub}</div>}
      </div>
    );
  }

  const thc = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap";
  const tdc = "px-3 py-2 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] tabular-nums";

  return (
    <div style={{ ...cv, fontFamily: ADSS_FONT, background: "var(--bg)", color: "var(--text)", minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        {brand.logoUrl
          ? <img src={brand.logoUrl} alt="logo" className="h-7 w-auto object-contain" />
          : <span className="text-[13px] font-bold" style={{ color: "var(--accent)" }}>{brand.name}</span>}
        <div className="ml-1 rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Manager</div>
        <div className="ml-1 text-[11px]" style={{ color: "var(--muted)" }}>{me?.name || me?.email}</div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleTheme} className="rounded p-1.5 text-[13px]" style={{ color: "var(--muted)" }} title="Toggle theme">
            <i className={`fa-solid ${theme === "dark" ? "fa-sun" : "fa-moon"}`} />
          </button>
          <a href="/admin/platform" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--soft)]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            <i className="fa-solid fa-arrow-right-from-bracket" />Logout
          </a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b px-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="relative mr-1 px-3 py-2.5 text-[11px] font-semibold transition-colors"
            style={{ color: tab === t ? "var(--accent)" : "var(--muted)", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent" }}>
            {t}
            {t === "Requests" && pendingReqs > 0 && <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: "#f97316" }}>{pendingReqs}</span>}
            {t === "Positions" && activePositions > 0 && <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: BUYBTN }}>{activePositions}</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">

        {/* ── OVERVIEW ── */}
        {tab === "Overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {kpi("My Clients", clients.length.toString(), onlineClients + " online now")}
              {kpi("Open Positions", activePositions.toString(), "across all accounts")}
              {kpi("Total Balance", "$" + gmoney(totalBalance), "deposits + credits")}
              {kpi("Float P&L", (floatPnl >= 0 ? "+" : "") + "$" + gmoney(Math.abs(floatPnl)), "on open positions", floatPnl >= 0 ? BUY : SELL)}
              {kpi("Pending Requests", pendingReqs.toString(), "awaiting approval", pendingReqs > 0 ? "#f97316" : undefined)}
            </div>

            {/* Live positions mini-table */}
            <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  <i className="fa-solid fa-circle-dot mr-1.5" style={{ color: BUY }} />Live Positions
                </div>
                <button onClick={() => setTab("Positions")} className="text-[10px]" style={{ color: "var(--accent)" }}>View all →</button>
              </div>
              {positions.length === 0 ? (
                <div className="py-6 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>{posLoaded ? "No open positions." : "Loading…"}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr style={{ background: "var(--soft)" }}>
                      <th className={thc} style={{ color: "var(--muted)" }}>Account</th>
                      <th className={thc} style={{ color: "var(--muted)" }}>Symbol</th>
                      <th className={thc} style={{ color: "var(--muted)" }}>Type</th>
                      <th className={thc} style={{ color: "var(--muted)" }}>Lots</th>
                      <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Open</th>
                      <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Price</th>
                      <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>P&L</th>
                    </tr></thead>
                    <tbody>
                      {positions.slice(0, 8).map((p) => {
                        const price = prices[p.symbol];
                        const pl = price != null ? pnlOf(p, price) : null;
                        return (
                          <tr key={p.id} className="hover:bg-[var(--soft)] transition-colors">
                            <td className={tdc}>{p.accountLogin}</td>
                            <td className={tdc + " font-semibold"}>{p.symbol}</td>
                            <td className={tdc}><span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: p.type === "BUY" ? BUYBTN : SELLBTN }}>{p.type}</span></td>
                            <td className={tdc}>{Number(p.lots).toFixed(2)}</td>
                            <td className={tdc + " text-right"}>{gnum(p.openPrice, dg(p.symbol))}</td>
                            <td className={tdc + " text-right"}>{price != null ? gnum(price, dg(p.symbol)) : "—"}</td>
                            <td className={tdc + " text-right font-semibold"} style={{ color: pl == null ? "var(--muted)" : pl >= 0 ? BUY : SELL }}>
                              {pl != null ? (pl >= 0 ? "+" : "") + "$" + gmoney(Math.abs(pl)) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pending requests mini-list */}
            {requests.filter((r) => r.status === "PENDING").length > 0 && (
              <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
                <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    <i className="fa-solid fa-clock mr-1.5" style={{ color: "#f97316" }} />Pending Requests
                  </div>
                  <button onClick={() => setTab("Requests")} className="text-[10px]" style={{ color: "var(--accent)" }}>View all →</button>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {requests.filter((r) => r.status === "PENDING").slice(0, 5).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[11px]">
                      <span className="rounded px-2 py-0.5 text-[9px] font-bold" style={{ background: r.kind === "DEPOSIT" ? BUY + "22" : SELL + "22", color: r.kind === "DEPOSIT" ? BUY : SELL }}>{r.kind}</span>
                      <span className="font-semibold">{r.account?.login}</span>
                      <span style={{ color: "var(--muted)" }}>{r.account?.name}</span>
                      <span className="ml-auto font-bold tabular-nums">${gmoney(r.amount)}</span>
                      <span style={{ color: "var(--muted)" }}>{ago(r.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent activity */}
            {auditLogs.length > 0 && (
              <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
                <div className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <i className="fa-solid fa-list-ul mr-1.5" />Recent Activity
                </div>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {auditLogs.slice(0, 8).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-4 py-2 text-[11px]">
                      <i className="fa-solid fa-circle-dot text-[8px]" style={{ color: "var(--muted)" }} />
                      <span className="font-medium">{l.action}</span>
                      {l.detail && <span style={{ color: "var(--muted)" }}>{l.detail}</span>}
                      <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>{ago(l.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CLIENTS ── */}
        {tab === "Clients" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--muted)" }} />
                <input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search name, login, email…" className="w-full rounded-lg border py-2 pl-8 pr-3 text-[11px] outline-none focus:border-[var(--accent)]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }} />
              </div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{filteredClients.length} account{filteredClients.length !== 1 ? "s" : ""}</div>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr style={{ background: "var(--soft)" }}>
                    {["Login", "Name", "Type", "Balance", "Equity (est.)", "P&L", "Group", "Status", "Last Seen"].map((h) => (
                      <th key={h} className={thc + (["Balance", "Equity (est.)", "P&L"].includes(h) ? " text-right" : "")} style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {!clientsLoaded ? (
                      <tr><td colSpan={9} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading clients…</td></tr>
                    ) : filteredClients.length === 0 ? (
                      <tr><td colSpan={9} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No clients found.</td></tr>
                    ) : filteredClients.map((c) => {
                      const bal = Number(c.deposit ?? 0) + Number(c.credit ?? 0) + Number(c.bonus ?? 0) - Number(c.withdrawal ?? 0);
                      const equity = bal + Number(c.pnl ?? 0);
                      const pnl = Number(c.pnl ?? 0);
                      const isOnline = c.isOnline;
                      return (
                        <tr key={c.id} className="hover:bg-[var(--soft)] transition-colors">
                          <td className={tdc + " font-mono font-semibold"}>{c.login}</td>
                          <td className={tdc + " font-medium"}>
                            <div>{c.name}</div>
                            {c.user?.email && <div className="text-[9px]" style={{ color: "var(--muted)" }}>{c.user.email}</div>}
                          </td>
                          <td className={tdc}><span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: c.type === "LIVE" ? BUY + "22" : "var(--soft)", color: c.type === "LIVE" ? BUY : "var(--muted)" }}>{c.type}</span></td>
                          <td className={tdc + " text-right"}>${gmoney(bal)}</td>
                          <td className={tdc + " text-right"}>${gmoney(equity)}</td>
                          <td className={tdc + " text-right font-semibold"} style={{ color: pnl >= 0 ? BUY : SELL }}>{pnl >= 0 ? "+" : ""}${gmoney(Math.abs(pnl))}</td>
                          <td className={tdc}>{c.group?.name || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                          <td className={tdc}>
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: isOnline ? BUY : "var(--muted)" }} />
                              <span style={{ color: isOnline ? BUY : "var(--muted)" }}>{isOnline ? "Online" : "Offline"}</span>
                            </div>
                          </td>
                          <td className={tdc} style={{ color: "var(--muted)" }}>{ago(c.user?.lastSeenAt || c.user?.lastLoginAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── POSITIONS ── */}
        {tab === "Positions" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <div className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{positions.length} open position{positions.length !== 1 ? "s" : ""}</div>
              <button onClick={() => { setPosLoaded(false); fetch("/api/desk/trades").then((r) => r.json()).then((d) => { if (d.ok) { setPositions(d.trades || []); setPosLoaded(true); } }); }} className="ml-auto text-[10px]" style={{ color: "var(--accent)" }}>
                <i className="fa-solid fa-rotate-right mr-1" />Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr style={{ background: "var(--soft)" }}>
                  {["Login", "Client", "Symbol", "Type", "Lots", "Open Price", "Current", "SL", "TP", "P&L", "Opened"].map((h) => (
                    <th key={h} className={thc + (["Open Price", "Current", "SL", "TP", "P&L"].includes(h) ? " text-right" : "")} style={{ color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {!posLoaded ? (
                    <tr><td colSpan={11} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading…</td></tr>
                  ) : positions.length === 0 ? (
                    <tr><td colSpan={11} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No open positions.</td></tr>
                  ) : positions.map((p) => {
                    const price = prices[p.symbol];
                    const pl = price != null ? pnlOf(p, price) : null;
                    const d = dg(p.symbol);
                    const dur = Math.floor((Date.now() - new Date(p.openedAt).getTime()) / 60000);
                    const durStr = dur < 60 ? dur + "m" : Math.floor(dur / 60) + "h " + (dur % 60) + "m";
                    return (
                      <tr key={p.id} className="hover:bg-[var(--soft)] transition-colors">
                        <td className={tdc + " font-mono"}>{p.accountLogin}</td>
                        <td className={tdc}>{p.accountName}</td>
                        <td className={tdc + " font-semibold"}>{p.symbol}</td>
                        <td className={tdc}><span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: p.type === "BUY" ? BUYBTN : SELLBTN }}>{p.type}</span></td>
                        <td className={tdc}>{Number(p.lots).toFixed(2)}</td>
                        <td className={tdc + " text-right"}>{gnum(p.openPrice, d)}</td>
                        <td className={tdc + " text-right"}>{price != null ? gnum(price, d) : "—"}</td>
                        <td className={tdc + " text-right"} style={{ color: Number(p.sl) > 0 ? SELL : "var(--muted)" }}>{Number(p.sl) > 0 ? gnum(p.sl, d) : "—"}</td>
                        <td className={tdc + " text-right"} style={{ color: Number(p.tp) > 0 ? BUY : "var(--muted)" }}>{Number(p.tp) > 0 ? gnum(p.tp, d) : "—"}</td>
                        <td className={tdc + " text-right font-semibold"} style={{ color: pl == null ? "var(--muted)" : pl >= 0 ? BUY : SELL }}>
                          {pl != null ? (pl >= 0 ? "+" : "") + "$" + gmoney(Math.abs(pl)) : "—"}
                        </td>
                        <td className={tdc} style={{ color: "var(--muted)" }}>{durStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === "History" && (
          <div className="space-y-3">
            <div className="relative max-w-xs">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--muted)" }} />
              <input value={histSearch} onChange={(e) => setHistSearch(e.target.value)} placeholder="Filter by symbol or account…" className="w-full rounded-lg border py-2 pl-8 pr-3 text-[11px] outline-none focus:border-[var(--accent)]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }} />
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr style={{ background: "var(--soft)" }}>
                    {["Ticket", "Login", "Symbol", "Side", "Lots", "Open", "Close", "P&L", "Reason", "Closed"].map((h) => (
                      <th key={h} className={thc + (["Open", "Close", "P&L"].includes(h) ? " text-right" : "")} style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {!histLoaded ? (
                      <tr><td colSpan={10} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading…</td></tr>
                    ) : filteredHist.length === 0 ? (
                      <tr><td colSpan={10} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No closed trades.</td></tr>
                    ) : filteredHist.map((h: any) => {
                      const pnl = Number(h.pnl ?? 0);
                      const d = dg(h.symbol);
                      return (
                        <tr key={h.id} className="hover:bg-[var(--soft)] transition-colors">
                          <td className={tdc + " font-mono text-[10px]"}>{h.ticket}</td>
                          <td className={tdc}>{h.accountLogin}</td>
                          <td className={tdc + " font-semibold"}>{h.symbol}</td>
                          <td className={tdc}><span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: (h.side || h.type) === "BUY" ? BUYBTN : SELLBTN }}>{h.side || h.type}</span></td>
                          <td className={tdc}>{Number(h.lots).toFixed(2)}</td>
                          <td className={tdc + " text-right"}>{gnum(h.openPrice, d)}</td>
                          <td className={tdc + " text-right"}>{gnum(h.closePrice, d)}</td>
                          <td className={tdc + " text-right font-semibold"} style={{ color: pnl >= 0 ? BUY : SELL }}>
                            {pnl >= 0 ? "+" : ""}${gmoney(Math.abs(pnl))}
                          </td>
                          <td className={tdc + " text-[10px]"} style={{ color: "var(--muted)" }}>{h.closeReason || "—"}</td>
                          <td className={tdc} style={{ color: "var(--muted)" }}>{h.closedAt ? new Date(h.closedAt).toLocaleString() : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── REQUESTS ── */}
        {tab === "Requests" && (
          <div className="space-y-3">
            <div className="flex gap-2 text-[11px]">
              {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
                <button key={s} onClick={() => setClientSearch(s === "ALL" ? "" : s)} className="rounded-lg border px-3 py-1.5 font-semibold transition-colors"
                  style={{ borderColor: "var(--border)", background: clientSearch === (s === "ALL" ? "" : s) ? "var(--accent)" : "var(--panel)", color: clientSearch === (s === "ALL" ? "" : s) ? "#fff" : "var(--muted)" }}>
                  {s}{s === "PENDING" && pendingReqs > 0 ? ` (${pendingReqs})` : ""}
                </button>
              ))}
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr style={{ background: "var(--soft)" }}>
                    {["Account", "Name", "Type", "Amount", "Method", "Status", "Submitted"].map((h) => (
                      <th key={h} className={thc + (["Amount"].includes(h) ? " text-right" : "")} style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {!reqLoaded ? (
                      <tr><td colSpan={7} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading…</td></tr>
                    ) : (requests.filter((r) => !clientSearch || r.status === clientSearch).length === 0) ? (
                      <tr><td colSpan={7} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No requests found.</td></tr>
                    ) : requests.filter((r) => !clientSearch || r.status === clientSearch).map((r) => (
                      <tr key={r.id} className="hover:bg-[var(--soft)] transition-colors">
                        <td className={tdc + " font-mono"}>{r.account?.login}</td>
                        <td className={tdc}>{r.account?.name}</td>
                        <td className={tdc}>
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: r.kind === "DEPOSIT" ? BUY + "22" : SELL + "22", color: r.kind === "DEPOSIT" ? BUY : SELL }}>{r.kind}</span>
                        </td>
                        <td className={tdc + " text-right font-bold tabular-nums"}>${gmoney(r.amount)}</td>
                        <td className={tdc} style={{ color: "var(--muted)" }}>{r.method || "—"}</td>
                        <td className={tdc}>
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{
                            background: r.status === "APPROVED" ? BUY + "22" : r.status === "REJECTED" ? SELL + "22" : "#f9731622",
                            color: r.status === "APPROVED" ? BUY : r.status === "REJECTED" ? SELL : "#f97316",
                          }}>{r.status}</span>
                        </td>
                        <td className={tdc} style={{ color: "var(--muted)" }}>{ago(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
