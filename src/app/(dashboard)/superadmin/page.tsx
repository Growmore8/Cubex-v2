"use client";
import { useEffect, useState } from "react";

export default function SADashboard() {
  const [s, setS] = useState<any>(null);
  const [online, setOnline] = useState<any[]>([]);

  async function load() {
    try {
      const [sd, od] = await Promise.all([
        fetch("/api/superadmin/stats").then((r) => r.json()),
        fetch("/api/superadmin/platform").then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (sd.ok) setS(sd.stats);
      if (od.ok && od.online) setOnline(od.online);
    } catch {}
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const m = (v: number) => "$" + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function Stat({ label, value, color, icon, href }: any) {
    return (
      <div className="stat" style={{ ["--c" as any]: color }}>
        <div className="stat-icon-tile"><i className={"fa-solid " + icon} /></div>
        <div className="stat-lbl">{label}</div>
        <div className="stat-val" style={{ color }}>{value}</div>
      </div>
    );
  }

  function Section({ title, icon, children, cols }: any) {
    return (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="card-title">
          <span><i className={"fa-solid " + icon} style={{ marginRight: 6, color: "var(--text3)" }} />{title}</span>
        </div>
        <div className="stats ui-fade-up-stagger" style={{ marginBottom: 0, gridTemplateColumns: cols || "repeat(auto-fill,minmax(130px,1fr))" }}>{children}</div>
      </div>
    );
  }

  const Quick = ({ href, title, sub, color, icon, badge }: any) => (
    <a className="quick-tile" href={href} style={{ ["--c" as any]: color }}>
      <div className="qt-ico"><i className={"fa-solid " + icon} /></div>
      <div style={{ flex: 1 }}>
        <div className="qt-title">{title}</div>
        <div className="qt-sub">{sub}</div>
      </div>
      {badge && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 700, padding: "2px 7px", marginRight: 4 }}>{badge}</span>}
      <i className="fa-solid fa-chevron-right qt-arrow" />
    </a>
  );

  return (
    <div className="ui-fade-up">
      <div className="page-title">Dashboard</div>
      <div className="page-sub">Platform overview — structured data at a glance</div>

      {/* Quick access */}
      <div className="quick-row ui-fade-up-stagger">
        <Quick href="/superadmin/clients" title="All Clients" sub="Browse + edit every account" color="#2e7d32" icon="fa-users" />
        <Quick href="/superadmin/tenants" title="Tenants" sub="Companies + permissions" color="#f9a825" icon="fa-building" />
        <Quick href="/superadmin/billing" title="Billing" sub="Invoices + payments" color="#1565c0" icon="fa-file-invoice-dollar" badge={s?.pendingInvoices || undefined} />
        <Quick href="/superadmin/analytics" title="Analytics" sub="Per-tenant breakdown" color="#7c3aed" icon="fa-chart-column" />
        <Quick href="/superadmin/audit" title="Audit Log" sub="Every action, every actor" color="#c62828" icon="fa-clipboard-list" />
      </div>

      {!s ? (
        <div className="card">Loading dashboard data…</div>
      ) : (
        <>
          {/* Users Section */}
          <Section title="Users" icon="fa-users">
            <Stat label="Total Admins" value={s.totalAdmins} color="#1565c0" icon="fa-user-shield" />
            <Stat label="Total Managers" value={s.totalManagers} color="#6a1b9a" icon="fa-users-gear" />
            <Stat label="Total Clients" value={s.totalClients} color="#2e7d32" icon="fa-users" />
            <Stat label="Live Clients" value={s.liveClients} color="#1b5e20" icon="fa-user-check" />
            <Stat label="Demo Clients" value={s.demoClients} color="#e65100" icon="fa-vial" />
            <Stat label="Online Now" value={s.onlineClients} color="#00897b" icon="fa-circle" />
          </Section>

          {/* Accounts Section */}
          <Section title="Accounts" icon="fa-address-card">
            <Stat label="Active Accounts" value={s.activeAccounts} color="#00897b" icon="fa-circle-check" />
            <Stat label="Locked Accounts" value={s.lockedAccounts} color="#e53935" icon="fa-lock" />
            <Stat label="Deactivated" value={s.deactivatedAccounts} color="#9e9e9e" icon="fa-ban" />
            <Stat label="Open Trades" value={s.openTrades} color="#c62828" icon="fa-arrow-right-arrow-left" />
            <Stat label="Tenants" value={s.outsource} color="#c17900" icon="fa-building" />
          </Section>

          {/* Transactions Section */}
          <Section title="Transactions" icon="fa-money-bill-transfer">
            <Stat label="Total Deposits" value={m(s.deposits)} color="#1b5e20" icon="fa-arrow-down-to-bracket" />
            <Stat label="Withdrawals" value={m(s.withdrawals)} color="#b71c1c" icon="fa-arrow-up-from-bracket" />
            <Stat label="Net Balance" value={m(s.deposits - s.withdrawals)} color="#0277bd" icon="fa-scale-balanced" />
            <Stat label="Credit In" value={m(s.creditIn)} color="#0277bd" icon="fa-credit-card" />
            <Stat label="Credit Out" value={m(Math.abs(s.creditOut))} color="#ad1457" icon="fa-credit-card" />
            <Stat label="Bonus" value={m(s.bonus)} color="#b45309" icon="fa-gift" />
          </Section>

          {/* Platform status */}
          <div className="card">
            <div className="card-title">
              <span><i className="fa-solid fa-shield-halved" style={{ marginRight: 8, color: "var(--text2)" }} />Platform Status</span>
              <a href="/superadmin/platform" style={{ fontSize: 12, color: "var(--accent2)" }}>Manage →</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: s.mode === "OPEN" ? "color-mix(in srgb,var(--green) 12%,transparent)" : s.mode === "READONLY" ? "color-mix(in srgb,var(--amber) 12%,transparent)" : "color-mix(in srgb,var(--red) 12%,transparent)" }}>
              <i className={"fa-solid fa-3x " + (s.mode === "LOCKED" ? "fa-lock" : s.mode === "READONLY" ? "fa-triangle-exclamation" : "fa-lock-open")} style={{ fontSize: 28, color: s.mode === "OPEN" ? "var(--green)" : s.mode === "READONLY" ? "var(--amber)" : "var(--red)" }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: s.mode === "OPEN" ? "var(--green)" : s.mode === "READONLY" ? "var(--amber)" : "var(--red)" }}>Platform {s.mode}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                  {s.mode === "OPEN" ? "All users can access normally" : s.mode === "READONLY" ? "Trading disabled — view only" : "All access blocked"}
                </div>
              </div>
              {s.pendingInvoices > 0 && (
                <a href="/superadmin/billing" style={{ marginLeft: "auto", padding: "6px 14px", background: "#ef4444", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                  <i className="fa-solid fa-file-invoice mr-1" />{s.pendingInvoices} Pending Invoice{s.pendingInvoices > 1 ? "s" : ""}
                </a>
              )}
            </div>
          </div>

          {/* Online users from platform API */}
          {online.length > 0 && (
            <div className="card">
              <div className="card-title">
                <span><i className="fa-solid fa-circle" style={{ marginRight: 8, color: "#22c55e", fontSize: 10 }} />Online Users ({online.length})</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {online.slice(0, 10).map((u: any, i: number) => (
                  <div key={i} className="ui-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, borderBottom: "1px solid var(--border)" }}>
                    <i className="fa-solid fa-desktop" style={{ color: "var(--text2)", fontSize: 12, width: 16 }} />
                    <span style={{ fontWeight: 500 }}>{u.name || u.accountName}</span>
                    {u.ip && <span style={{ fontSize: 11, color: "var(--text2)" }}>{u.ip}</span>}
                    <span className="sab sab-green" style={{ marginLeft: "auto", fontSize: 10 }}>{u.role || "CLIENT"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
