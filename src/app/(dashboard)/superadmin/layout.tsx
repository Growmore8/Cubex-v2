"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string; icon: string; sub?: boolean; section?: string };
const NAV: Item[] = [
  { href: "/superadmin", label: "Dashboard", icon: "fa-gauge-high" },
  { section: "Users", href: "/superadmin/clients", label: "Clients", icon: "fa-user-group", sub: true },
  { href: "/superadmin/kyc", label: "KYC", icon: "fa-id-card", sub: true },
  { href: "/superadmin/managers", label: "Managers", icon: "fa-users-gear", sub: true },
  { href: "/superadmin/admins", label: "Admins", icon: "fa-user-shield", sub: true },
  { href: "/superadmin/outsource", label: "Outsource Business", icon: "fa-handshake" },
  { section: "Settings", href: "/superadmin/platform", label: "Platform Control", icon: "fa-lock", sub: true },
  { href: "/superadmin/audit", label: "Audit Log", icon: "fa-clipboard-list", sub: true },
  { href: "/superadmin/notify", label: "Send Notification", icon: "fa-paper-plane", sub: true },
  { href: "/superadmin/payments", label: "Payment Methods", icon: "fa-credit-card", sub: true },
  { href: "/superadmin/symbols", label: "Symbols", icon: "fa-coins", sub: true },
  { href: "/superadmin/settings", label: "SA Settings", icon: "fa-sliders", sub: true },
];

const CSS = `
.sa-shell{position:fixed;inset:0;z-index:40;display:flex;font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;
  --navy:#0d1b3e;--gold:#f9a825;--accent:#1565c0;--accent2:#1976d2;--green:#2e7d32;--red:#c62828;--amber:#e65100;
  --bg:#f0f4f8;--bg2:#e3e8ef;--card:#fff;--border:#dde3ec;--border-strong:#c4cbd6;--text:#1a2332;--text2:#5a6a82;--text3:#8a96aa;
  --shadow:0 2px 12px rgba(13,27,62,.10);--shadow-lg:0 8px 28px rgba(13,27,62,.18);--ring:rgba(21,101,192,.18);
  background:var(--bg);color:var(--text);}
.sa-shell.dark{--bg:#0b1220;--bg2:#0f1a2e;--card:#152238;--border:#27344c;--border-strong:#3a4a66;--text:#e6ecf5;--text2:#9aa8c0;--text3:#6f7d96;--shadow:0 2px 12px rgba(0,0,0,.35);--shadow-lg:0 8px 28px rgba(0,0,0,.5);--ring:rgba(25,118,210,.32);}
.sa-shell *{box-sizing:border-box;}
.sa-shell .sidebar{width:220px;background:var(--navy);height:100vh;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;}
.sa-shell .sb-brand{padding:20px 18px 14px;border-bottom:1px solid rgba(255,255,255,.08);}
.sa-shell .sb-brand-title{color:var(--gold);font-size:14px;font-weight:700;letter-spacing:.5px;}
.sa-shell .sb-menu{flex:1;padding:10px 0;overflow-y:auto;}
.sa-shell .sb-menu::-webkit-scrollbar{width:4px;}
.sa-shell .sb-menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px;}
.sa-shell .sb-item{display:flex;align-items:center;gap:10px;padding:10px 18px;color:rgba(255,255,255,.55);text-decoration:none;font-size:13px;border-left:3px solid transparent;transition:all .18s;}
.sa-shell .sb-item.sb-sub{padding-left:32px;font-size:12.5px;}
.sa-shell .sb-item:hover{background:rgba(255,255,255,.06);color:#fff;}
.sa-shell .sb-item.active{background:rgba(249,168,37,.12);color:var(--gold);border-left-color:var(--gold);}
.sa-shell .sb-item i{font-size:16px;width:20px;text-align:center;}
.sa-shell .sb-section{padding:10px 18px 4px;color:rgba(255,255,255,.3);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-top:6px;font-weight:700;}
.sa-shell .sb-footer{padding:14px 18px;border-top:1px solid rgba(255,255,255,.08);}
.sa-shell .sb-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
.sa-shell .sb-tool{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:rgba(255,255,255,.78);cursor:pointer;font:inherit;transition:all .18s;}
.sa-shell .sb-tool:hover{background:rgba(249,168,37,.14);border-color:rgba(249,168,37,.45);color:var(--gold);transform:translateY(-1px);}
.sa-shell .sb-tool-ico{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);}
.sa-shell .sb-tool-ico i{font-size:14px;}
.sa-shell .sb-tool-lbl{font-size:10px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.7;}
.sa-shell .sb-bell-badge{position:absolute;top:4px;right:6px;min-width:18px;height:18px;padding:0 5px;background:#ef5350;color:#fff;border-radius:9px;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;border:2px solid var(--navy);}
.sa-shell .sb-bell-badge.show{display:inline-flex;}
.sa-shell .sb-tool.has-alerts{border-color:rgba(239,83,80,.4);background:rgba(239,83,80,.08);}
.sa-shell .sb-vol-row{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;color:rgba(255,255,255,.55);}
.sa-shell .sb-vol-ico{font-size:11px;flex-shrink:0;}
.sa-shell .sb-vol-slider{flex:1;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.12);border-radius:3px;outline:none;cursor:pointer;}
.sa-shell .sb-vol-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--gold);border:2px solid var(--navy);cursor:pointer;}
.sa-shell .sb-vol-val{font-size:10px;font-weight:600;min-width:30px;text-align:right;color:rgba(255,255,255,.6);}
.sa-shell .sb-user{color:rgba(255,255,255,.6);font-size:11px;margin-bottom:8px;}
.sa-shell .sb-logout{color:rgba(239,83,80,.8);font-size:12px;cursor:pointer;background:none;border:none;padding:0;}
.sa-shell .sb-logout:hover{color:#ef5350;}
.sa-shell .sa-main{flex:1;overflow-y:auto;padding:24px;}
.sa-shell .page-title{font-size:20px;font-weight:700;margin-bottom:4px;}
.sa-shell .page-sub{font-size:13px;color:var(--text2);margin-bottom:20px;}
.sa-shell .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px;}
.sa-shell .stat{position:relative;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow);transition:transform .18s,box-shadow .18s,border-color .18s;overflow:hidden;}
.sa-shell .stat:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:var(--border-strong);}
.sa-shell .stat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,var(--accent));border-radius:14px 0 0 14px;}
.sa-shell .stat-lbl{font-size:10.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;font-weight:600;}
.sa-shell .stat-val{font-size:22px;font-weight:700;letter-spacing:-.3px;}
.sa-shell .stat-icon-tile{position:absolute;right:12px;top:12px;width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--c,var(--accent)) 14%,transparent);}
.sa-shell .stat-icon-tile i{font-size:14px;color:var(--c,var(--accent));}
.sa-shell .quick-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:20px;}
.sa-shell .quick-tile{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:14px;cursor:pointer;text-decoration:none;color:inherit;transition:all .18s;box-shadow:var(--shadow);}
.sa-shell .quick-tile:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:var(--border-strong);}
.sa-shell .qt-ico{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--c,var(--accent)) 14%,transparent);flex-shrink:0;}
.sa-shell .qt-ico i{font-size:18px;color:var(--c,var(--accent));}
.sa-shell .qt-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;}
.sa-shell .qt-sub{font-size:11px;color:var(--text2);}
.sa-shell .qt-arrow{margin-left:auto;font-size:12px;color:var(--text3);}
.sa-shell .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;box-shadow:var(--shadow);margin-bottom:16px;}
.sa-shell .card-title{font-size:14px;font-weight:600;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;}
.sa-shell .btn{padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s;text-decoration:none;}
.sa-shell .btn-primary{background:var(--accent2);color:#fff;}
.sa-shell .btn-gold{background:var(--gold);color:var(--navy);font-weight:700;}
.sa-shell .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
.sa-shell .sab{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;}
.sa-shell .sab-green{background:color-mix(in srgb,var(--green) 16%,transparent);color:#15803d;}
.sa-shell .sab-red{background:color-mix(in srgb,var(--red) 16%,transparent);color:#b91c1c;}
.sa-shell .sab-amber{background:color-mix(in srgb,var(--amber) 16%,transparent);color:#b45309;}
.sa-shell.dark .sab-green{background:rgba(34,197,94,.16);color:#4ade80;}
.sa-shell.dark .sab-red{background:rgba(239,68,68,.16);color:#f87171;}
.sa-shell.dark .sab-amber{background:rgba(245,158,11,.18);color:#fbbf24;}
.sa-shell .tbl{width:100%;border-collapse:collapse;}
.sa-shell .tbl th{background:var(--bg);padding:8px 10px;text-align:left;font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;font-weight:500;border-bottom:2px solid var(--border);}
.sa-shell .tbl td{padding:10px;border-bottom:1px solid var(--border);}
/* ── dark-aware overrides for the Tailwind-built sub-pages ── */
.sa-shell .bg-white{background:var(--card)!important;}
.sa-shell .bg-gray-50,.sa-shell .bg-gray-100{background:var(--bg2)!important;}
.sa-shell .text-gray-400,.sa-shell .text-gray-500,.sa-shell .text-gray-600{color:var(--text2)!important;}
.sa-shell .text-gray-700,.sa-shell .text-gray-800,.sa-shell .text-gray-900{color:var(--text)!important;}
.sa-shell.dark .border{border-color:var(--border)!important;}
.sa-shell input:not([type=range]):not([type=checkbox]):not([type=radio]),.sa-shell select,.sa-shell textarea{background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:8px;}
.sa-shell input:focus,.sa-shell select:focus,.sa-shell textarea:focus{border-color:var(--accent2);box-shadow:0 0 0 3px var(--ring);}
.sa-shell.dark select{color-scheme:dark;}
.sa-shell input::placeholder,.sa-shell textarea::placeholder{color:var(--text3);}
.sa-shell table{color:var(--text);}
/* ── notification panel ── */
.sa-shell .sa-notif-panel{position:fixed;top:0;right:-360px;width:340px;max-width:90vw;height:100vh;background:var(--card);border-left:1px solid var(--border);box-shadow:-12px 0 24px rgba(0,0,0,.18);z-index:9990;display:flex;flex-direction:column;transition:right .25s ease;}
.sa-shell .sa-notif-panel.open{right:0;}
.sa-shell .sa-notif-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--navy);color:#fff;}
.sa-shell .sa-notif-head h3{font-size:14px;font-weight:700;margin:0;}
.sa-shell .sa-notif-head button{background:none;border:none;color:#fff;cursor:pointer;font-size:18px;}
.sa-shell .sa-notif-list{flex:1;overflow-y:auto;}
.sa-shell .sa-notif-item{padding:12px 16px;border-bottom:1px solid var(--border);}
.sa-shell .sa-notif-title{font-size:12.5px;font-weight:600;color:var(--text);margin-bottom:2px;}
.sa-shell .sa-notif-detail{font-size:11px;color:var(--text2);line-height:1.4;}
.sa-shell .sa-notif-time{font-size:10px;color:var(--text3);margin-top:4px;}
.sa-shell .sa-notif-empty{padding:40px 20px;text-align:center;color:var(--text2);font-size:12px;}
`;

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [dark, setDark] = useState(false);
  const [vol, setVol] = useState(1.5);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [panel, setPanel] = useState(false);
  const ac = useRef<any>(null);
  const prev = useRef<number>(-1);
  const volRef = useRef(1.5);

  function beep(f: number, d: number, g: number) {
    try {
      if (!ac.current) ac.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const c = ac.current; if (c.state === "suspended") c.resume();
      const o = c.createOscillator(), gain = c.createGain();
      o.connect(gain); gain.connect(c.destination); o.type = "sine"; o.frequency.value = f;
      gain.gain.value = Math.min(0.9, g * volRef.current);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d);
      o.start(); o.stop(c.currentTime + d);
    } catch (e) {}
  }
  async function loadNotifs() {
    try {
      const d = await fetch("/api/superadmin/notify").then((r) => r.json());
      if (d.ok) {
        const items = d.recent || [];
        if (prev.current >= 0 && items.length > prev.current) { beep(880, 0.12, 0.25); setUnread((u) => u + (items.length - prev.current)); }
        prev.current = items.length; setNotifs(items);
      }
    } catch (e) {}
  }
  useEffect(() => {
    if (!document.getElementById("fa6")) {
      const l = document.createElement("link"); l.id = "fa6"; l.rel = "stylesheet";
      l.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
      document.head.appendChild(l);
    }
    try { if (localStorage.getItem("sa_theme") === "dark") setDark(true); } catch (e) {}
    try { const v = parseFloat(localStorage.getItem("sa_notifVol") || "1.5"); volRef.current = v; setVol(v); } catch (e) {}
    loadNotifs(); const t = setInterval(loadNotifs, 30000); return () => clearInterval(t);
  }, []);
  function toggleTheme() { const n = !dark; setDark(n); try { localStorage.setItem("sa_theme", n ? "dark" : "light"); } catch (e) {} }
  function setVolume(v: number) { volRef.current = v; setVol(v); try { localStorage.setItem("sa_notifVol", String(v)); } catch (e) {} beep(880, 0.08, 0.25); }
  function openPanel() { setPanel((p) => { const n = !p; if (n) setUnread(0); return n; }); }

  return (
    <div className={"sa-shell" + (dark ? " dark" : "")}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <aside className="sidebar">
        <div className="sb-brand"><div className="sb-brand-title"><i className="fa-solid fa-crown" style={{ marginRight: 6 }}></i>Super Admin</div></div>
        <div className="sb-menu">
          {NAV.map((n) => (
            <div key={n.href}>
              {n.section && <div className="sb-section">{n.section}</div>}
              <Link href={n.href} className={"sb-item" + (n.sub ? " sb-sub" : "") + (path === n.href ? " active" : "")}>
                <i className={"fa-solid " + n.icon}></i>{n.label}
              </Link>
            </div>
          ))}
        </div>
        <div className="sb-footer">
          <div className="sb-tools">
            <button className={"sb-tool" + (unread > 0 ? " has-alerts" : "")} onClick={openPanel} title="Notifications">
              <span className="sb-tool-ico"><i className="fa-solid fa-bell"></i></span>
              <span className="sb-tool-lbl">Alerts</span>
              <span className={"sb-bell-badge" + (unread > 0 ? " show" : "")}>{unread > 99 ? "99+" : unread}</span>
            </button>
            <button className="sb-tool" onClick={toggleTheme} title="Toggle Light/Dark">
              <span className="sb-tool-ico"><i className={"fa-solid " + (dark ? "fa-sun" : "fa-moon")}></i></span>
              <span className="sb-tool-lbl">{dark ? "Light" : "Dark"}</span>
            </button>
          </div>
          <div className="sb-vol-row">
            <i className="fa-solid fa-volume-low sb-vol-ico"></i>
            <input type="range" className="sb-vol-slider" min="0" max="5" step="0.1" value={vol} onChange={(e) => setVolume(parseFloat(e.target.value))} />
            <span className="sb-vol-val">{Math.round((vol / 5) * 100)}%</span>
          </div>
          <div className="sb-user">QubeX</div>
          <button className="sb-logout" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
            <i className="fa-solid fa-right-from-bracket" style={{ marginRight: 4 }}></i>Logout
          </button>
        </div>
      </aside>

      <div className={"sa-notif-panel" + (panel ? " open" : "")}>
        <div className="sa-notif-head"><h3><i className="fa-solid fa-bell" style={{ marginRight: 8 }}></i>Notifications</h3><button onClick={() => setPanel(false)}><i className="fa-solid fa-xmark"></i></button></div>
        <div className="sa-notif-list">
          {notifs.length === 0
            ? <div className="sa-notif-empty"><i className="fa-regular fa-bell-slash" style={{ fontSize: 32, display: "block", marginBottom: 10, opacity: 0.4 }}></i>No notifications yet.</div>
            : notifs.map((n, i) => (
              <div className="sa-notif-item" key={i}>
                <div className="sa-notif-title">{n.title}</div>
                {n.body && <div className="sa-notif-detail">{n.body}</div>}
                <div className="sa-notif-time">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}</div>
              </div>
            ))}
        </div>
      </div>

      <main className="sa-main">{children}</main>
    </div>
  );
}