"use client";
import { useEffect, useState } from "react";

export default function SADashboard() {
  const [s, setS] = useState<any>(null);
  async function load() { try { const d = await fetch("/api/superadmin/stats").then((r) => r.json()); if (d.ok) setS(d.stats); } catch (e) {} }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const m = (v: number) => "$" + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const Stat = ({ label, value, color, icon }: any) => (
    <div className="stat" style={{ ["--c" as any]: color }}>
      <div className="stat-icon-tile"><i className={"fa-solid " + icon}></i></div>
      <div className="stat-lbl">{label}</div>
      <div className="stat-val" style={{ color }}>{value}</div>
    </div>
  );
  const Quick = ({ href, title, sub, color, icon }: any) => (
    <a className="quick-tile" href={href} style={{ ["--c" as any]: color }}>
      <div className="qt-ico"><i className={"fa-solid " + icon}></i></div>
      <div><div className="qt-title">{title}</div><div className="qt-sub">{sub}</div></div>
      <i className="fa-solid fa-chevron-right qt-arrow"></i>
    </a>
  );
  return (
    <div>
      <div className="page-title">Dashboard</div>
      <div className="page-sub">Platform overview &mdash; all data in one place</div>
      <div className="quick-row">
        <Quick href="/superadmin/clients" title="All Clients" sub="Browse + edit every account" color="#2e7d32" icon="fa-users" />
        <Quick href="/superadmin/outsource" title="Outsource" sub="Companies + permissions" color="#f9a825" icon="fa-handshake" />
        <Quick href="/superadmin/platform" title="Platform Control" sub="Open / Read-only / Locked" color="#c62828" icon="fa-shield-halved" />
        <Quick href="/superadmin/audit" title="Audit Log" sub="Every action, every actor" color="#1565c0" icon="fa-clipboard-list" />
        <Quick href="/superadmin/notify" title="Send Notification" sub="Broadcast a message" color="#a855f7" icon="fa-paper-plane" />
      </div>
      {!s ? <div className="card">Loading&hellip;</div> : (<>
        <div className="stats">
          <Stat label="Total Admins" value={s.totalAdmins} color="#1565c0" icon="fa-user-shield" />
          <Stat label="Total Managers" value={s.totalManagers} color="#6a1b9a" icon="fa-users-gear" />
          <Stat label="Total Clients" value={s.totalClients} color="#2e7d32" icon="fa-users" />
          <Stat label="Live Clients" value={s.liveClients} color="#2e7d32" icon="fa-user-check" />
          <Stat label="Demo Clients" value={s.demoClients} color="#e65100" icon="fa-vial" />
          <Stat label="Active Accounts" value={s.activeAccounts} color="#00897b" icon="fa-circle-check" />
          <Stat label="Locked Accounts" value={s.lockedAccounts} color="#e53935" icon="fa-lock" />
          <Stat label="Open Trades" value={s.openTrades} color="#c62828" icon="fa-arrow-right-arrow-left" />
          <Stat label="Outsource" value={s.outsource} color="#c17900" icon="fa-handshake" />
          <Stat label="Total Deposits" value={m(s.deposits)} color="#1b5e20" icon="fa-money-bill" />
          <Stat label="Withdrawals" value={m(-Math.abs(s.withdrawals))} color="#b71c1c" icon="fa-money-bill-transfer" />
          <Stat label="Credit In" value={m(s.creditIn)} color="#0277bd" icon="fa-credit-card" />
          <Stat label="Credit Out" value={m(s.creditOut)} color="#ad1457" icon="fa-credit-card" />
          <Stat label="Bonus" value={m(s.bonus)} color="#b45309" icon="fa-gift" />
        </div>
        <div className="card">
          <div className="card-title"><span><i className="fa-solid fa-gear" style={{ marginRight: 6, color: "#64748b" }}></i>Platform Status</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 8, background: s.mode === "OPEN" ? "color-mix(in srgb,var(--green) 12%,transparent)" : s.mode === "READONLY" ? "color-mix(in srgb,var(--amber) 12%,transparent)" : "color-mix(in srgb,var(--red) 12%,transparent)" }}>
            <i className={"fa-solid " + (s.mode === "LOCKED" ? "fa-lock" : s.mode === "READONLY" ? "fa-triangle-exclamation" : "fa-lock-open")} style={{ fontSize: 20, color: s.mode === "OPEN" ? "var(--green)" : s.mode === "READONLY" ? "var(--amber)" : "var(--red)" }}></i>
            <div>
              <div style={{ fontWeight: 600, color: s.mode === "OPEN" ? "var(--green)" : s.mode === "READONLY" ? "var(--amber)" : "var(--red)" }}>Platform {s.mode}</div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>{s.mode === "OPEN" ? "All users can access normally" : s.mode === "READONLY" ? "Trading disabled, viewing only" : "All access blocked"}</div>
            </div>
          </div>
        </div>
      </>)}
    </div>
  );
}