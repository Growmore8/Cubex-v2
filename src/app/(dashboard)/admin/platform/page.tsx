"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import LWChart from "@/components/LWChart";
import PriceCell from "@/components/PriceCell";
import { playSound, soundForNotification, isMuted, setMuted } from "@/lib/sounds";
import PaymentsPanel from "@/components/PaymentsPanel";
import KycPanel from "@/components/KycPanel";
import instruments from "@/config/instruments";
import { contractFor } from "@/config/contracts";
import { DARK, LIGHT, BUY, SELL, GOLD } from "@/config/theme";

const TFS = ["1M", "5M", "15M", "30M", "1H", "4H", "1D"];
const TABS: [string, string][] = [["trade", "Trade"], ["history", "History"], ["summary", "Summary"], ["clients", "Clients"], ["audit", "Audit"], ["payments", "Payments"], ["kyc", "KYC"]];

function pnlOf(p: any, price: number, cs: number) {
  const sym = String(p.symbol || "");
  const dir = p.type === "BUY" ? 1 : -1;
  const diff = (price - p.openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  if (isFx) {
    const pip = /JPY$/i.test(sym) ? 0.01 : 0.0001;
    let pf = (diff / pip) * p.lots; // $1 per pip per 1.0 lot (USD quote)
    if (/^USD/i.test(sym)) pf = pf / (price || 1); // USD base -> convert to USD
    return pf;
  }
  return diff * p.lots * (cs || 100000);
}

export default function AdminDeskPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { const t = localStorage.getItem("cubex-theme"); if (t === "light" || t === "dark") setTheme(t); }, []);
  function toggleTheme() { setTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("cubex-theme", n); return n; }); }

  const [clients, setClients] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [tradeGroups, setTradeGroups] = useState<any[]>([]);
  const [nrecent, setNrecent] = useState<any[]>([]);
  const NOTI_TEMPLATES: any = { Maintenance: { title: "Scheduled Maintenance", body: "Our platform will undergo scheduled maintenance. Trading may be briefly unavailable. We apologize for any inconvenience." }, Promotion: { title: "Special Promotion", body: "A new promotion is now available. Contact your account manager to learn more." }, News: { title: "Market News", body: "Stay informed with the latest market updates and analysis." }, Notice: { title: "Important Notice", body: "Please review this important notice regarding your trading account." }, Custom: { title: "", body: "" } };
  
  const [symbols, setSymbols] = useState<any[]>([]);
  const [open, setOpen] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selSym, setSelSym] = useState("");
  const [tf, setTf] = useState("1M");
  const [selAcc, setSelAcc] = useState<any>(null);
  const [lot, setLot] = useState(0.01);
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
  const [tab, setTab] = useState("trade");
  const [tabState, setTabState] = useState<Record<string, boolean>>({ trade: true, history: true, summary: true, clients: true, audit: true, payments: true, kyc: true });
  const [menu, setMenu] = useState<{ x: number; y: number; acc: any } | null>(null);
  const [menuSub, setMenuSub] = useState("");
  const [act, setAct] = useState<any>(null);
  const [aform, setAform] = useState<any>({});
  const [topMenu, setTopMenu] = useState<string>("");
  const [modal, setModal] = useState<"" | "client" | "manager" | "group" | "notify">("");
  useEffect(() => { if (modal === "notify") fetch("/api/admin/notify").then((r) => r.json()).then((d) => { if (d.ok) setNrecent(d.recent || []); }).catch(() => {}); }, [modal]);
  const [form, setForm] = useState<any>({ type: "LIVE", leverage: 100, currency: "USD" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [toasts, setToasts] = useState<any[]>([]);
  const [confirmBox, setConfirmBox] = useState<{ msg: string; danger?: boolean; onYes: () => void } | null>(null);
  function askConfirm(msg: string, onYes: () => void, danger = true) { setConfirmBox({ msg, danger, onYes }); }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navW, setNavW] = useState(248);
  const [mwW, setMwW] = useState(278);
  const [tbH, setTbH] = useState(180);
  const [layout, setLayout] = useState(1);
  const [openCharts, setOpenCharts] = useState<string[]>([]);
  const [activeChart, setActiveChart] = useState(0);
  const [oneClick, setOneClick] = useState(true);
  const [panels, setPanels] = useState<{ nav: boolean; mw: boolean; toolbox: boolean }>({ nav: true, mw: true, toolbox: true });
  const [ticket, setTicket] = useState<string | null>(null);
  const [tform, setTform] = useState<any>({ vol: 0.01, sl: 0, tp: 0, type: "Market" });
  const [posMenu, setPosMenu] = useState<{ x: number; y: number; t: any } | null>(null);
  const [pos, setPos] = useState<any>(null);
  const [symOv, setSymOv] = useState<any>(null);
  const [mt, setMt] = useState<any>(null);
  const [hEdit, setHEdit] = useState<any>(null);
  const [pform, setPform] = useState<any>({});
  const [tradeSel, setTradeSel] = useState<Record<string, boolean>>({});
  const [histSel, setHistSel] = useState<Record<string, boolean>>({});
  const [inlineEdit, setInlineEdit] = useState<Record<string, any>>({});
  const [cliQ, setCliQ] = useState("");
  const [cliType, setCliType] = useState("ALL");
  const [cliStatus, setCliStatus] = useState("ALL");
  const [navTab, setNavTab] = useState<"live" | "demo">("live");
  const [navSearch, setNavSearch] = useState("");
  const [mwSearch, setMwSearch] = useState("");
  const [showOC, setShowOC] = useState(true); // chart buy/sell strip visibility
  const [soundMuted, setSoundMuted] = useState(false);
  useEffect(() => { setSoundMuted(isMuted()); }, []);
  const [role, setRole] = useState("");
  const roleRef = useRef("");
  const isManager = role === "MANAGER";
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const can = (k: string) => perms[k] !== false; // default allow until /me resolves
  const [fundPnlOnly, setFundPnlOnly] = useState(false);
  useEffect(() => { fetch("/api/admin/fund-settings").then((r) => r.json()).then((d) => { if (d.ok) setFundPnlOnly(!!d.pnlOnly); }).catch(() => {}); }, []);
  async function toggleFundPnlOnly() {
    setTopMenu("");
    const next = !fundPnlOnly;
    const r = await fetch("/api/admin/fund-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pnlOnly: next }) });
    const d = await r.json();
    if (d.ok) { setFundPnlOnly(d.pnlOnly); setOk("Withdraw/Transfer policy: " + (d.pnlOnly ? "PNL only" : "Full balance")); }
  }
  const [symPerm, setSymPerm] = useState<any>(null); // { symbols, disabled[], scope, q }
  async function openSymPerm() {
    setTopMenu("");
    try {
      const d = await fetch("/api/admin/symbol-perms").then((r) => r.json());
      if (d.ok) setSymPerm({ symbols: d.symbols, disabled: d.disabled || [], scope: d.scope, q: "" });
    } catch {}
  }
  async function toggleSymPerm(symbol: string, disabled: boolean) {
    const r = await fetch("/api/admin/symbol-perms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, disabled }) });
    const d = await r.json();
    if (d.ok) { setSymPerm((p: any) => ({ ...p, disabled: d.disabled })); loadAll(); }
  }
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  async function loadPending() { try { const d = await fetch("/api/desk/pending").then((r) => r.json()); if (d.ok) setPendingOrders(d.pending || []); } catch {} }
  useEffect(() => { loadPending(); const t = setInterval(loadPending, 6000); return () => clearInterval(t); }, []);
  async function cancelPending(id: string) { const r = await fetch("/api/desk/pending/" + id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadPending(); }
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [kycUploadFor, setKycUploadFor] = useState<any>(null);
  const [kycUploadType, setKycUploadType] = useState("PASSPORT");
  const [kycUploadFile, setKycUploadFile] = useState<File | null>(null);
  const [kycBackFile, setKycBackFile] = useState<File | null>(null);
  const [kycUpMsg, setKycUpMsg] = useState("");
  const [hfPreset, setHfPreset] = useState("ALL");
  const [hfFrom, setHfFrom] = useState("");
  const [hfTo, setHfTo] = useState("");
  const [hfType, setHfType] = useState("ALL");
  const prevRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, any>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});

  const selSymRef = useRef(selSym);
  useEffect(() => { selSymRef.current = selSym; }, [selSym]);

  const digitsMap: Record<string, number> = Object.fromEntries(symbols.map((s) => [s.symbol, s.digits]));
  function dg(sym: string) { return digitsMap[sym] ?? instruments[sym]?.digits ?? 2; }
  // Magnitude-aware: never lose precision on small-value symbols (e.g. ADAUSDT 0.18940)
  function pxFmt(sym: string, val: any) {
    if (val == null || val === "") return "-";
    const n = Number(val);
    if (!isFinite(n)) return "-";
    let d = dg(sym);
    const a = Math.abs(n);
    if (a > 0 && a < 1) d = Math.max(d, 5);
    else if (a < 10) d = Math.max(d, 4);
    else if (a < 100) d = Math.max(d, 3);
    return n.toFixed(d);
  }
  const catMap: Record<string, string> = Object.fromEntries(symbols.map((s) => [s.symbol, s.category || "forex"]));
  function csz(sym: string) { return contractFor(catMap[sym] || "forex", sym); }

  async function loadAll() {
    const isMgr = roleRef.current === "MANAGER";
    const [c, sy, o, h, a, mg, gr] = await Promise.all([
      fetch("/api/admin/clients").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/symbols").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/desk/trades").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/desk/history").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch(isMgr ? "/api/manager/audit" : "/api/admin/audit").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/admin/managers").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/admin/groups").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
    if (c.ok) setClients(c.clients);
    if (sy.ok) { const seen = new Set<string>(); const uniq = (sy.symbols || []).filter((s: any) => { if (seen.has(s.symbol)) return false; seen.add(s.symbol); return true; }); setSymbols(uniq); if (!selSymRef.current && uniq.length) setSelSym(uniq[0].symbol); }
    if (o.ok) setOpen(o.trades);
    if (h.ok) setHistory(h.history);
    if (a.ok) setAudit(a.logs);
    if (mg.ok) setManagers(mg.managers || []);
    if (gr.ok) setTradeGroups(gr.groups || []);
  }
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.ok && d.user) { roleRef.current = d.user.role; setRole(d.user.role); setPerms(d.perms || {}); }
    }).catch(() => {}).finally(() => loadAll());
  }, []);
  const notifSeen = useRef<Set<string>>(new Set());
  const notifPrimed = useRef(false);
  async function loadNotifs() {
    try {
      const d = await fetch("/api/notifications").then((r) => r.json());
      if (!d.ok) return;
      const items = d.items || [];
      if (notifPrimed.current) {
        for (const n of items) { const id = String(n.id); if (!notifSeen.current.has(id)) { playSound(soundForNotification(n)); pushNotifToast(n); } }
      }
      items.forEach((n: any) => notifSeen.current.add(String(n.id)));
      notifPrimed.current = true;
      setNotifs(items); setNotifUnread(d.unread || 0);
    } catch {}
  }
  useEffect(() => { loadNotifs(); const t = setInterval(loadNotifs, 20000); return () => clearInterval(t); }, []);
  async function openNotifs() { setNotifOpen((v) => !v); if (!notifOpen && notifUnread > 0) { try { await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {} setNotifUnread(0); } }
  function toast(msg: string, kind: string) { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500); }
  function pushNotifToast(n: any) {
    const st = soundForNotification(n);
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, notif: true, st, title: n.title, body: n.body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }
  useEffect(() => { if (ok) toast(ok, "ok"); }, [ok]);
  useEffect(() => { if (symbols.length && openCharts.length === 0) { const init = symbols.slice(0, 4).map((s) => s.symbol); setOpenCharts(init); setSelSym(init[0]); } }, [symbols]);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    // Batch high-frequency ticks: accumulate in refs, flush to state once per
    // animation frame so 57 symbols can't trigger hundreds of re-renders/sec.
    const pP: Record<string, number> = {};
    const pD: Record<string, number> = {};
    let raf = 0;
    const flush = () => {
      raf = 0;
      const px = pP; const dr = pD;
      if (Object.keys(px).length) { setPrices((pp) => ({ ...pp, ...px })); for (const k in px) delete px[k]; }
      if (Object.keys(dr).length) { setDirs((dd) => ({ ...dd, ...dr })); for (const k in dr) delete dr[k]; }
    };
    socket.on("tick", ({ symbol, price }: any) => {
      const prev = prevRef.current[symbol];
      if (prev != null && prev !== price) pD[symbol] = price > prev ? 1 : -1;
      prevRef.current[symbol] = price;
      pP[symbol] = price;
      if (!raf) raf = requestAnimationFrame(flush);
    });
    // Single timer clears the up/down flash for all symbols (cheap vs per-symbol timers)
    const clr = setInterval(() => setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; }), 650);
    socket.on("liquidation", () => loadAll());
    socket.on("refresh", () => loadAll());
    const t = setInterval(() => fetch("/api/desk/trades").then((r) => r.json()).then((d) => d.ok && setOpen(d.trades)).catch(() => {}), 7000);
    return () => { socket.disconnect(); clearInterval(t); clearInterval(clr); if (raf) cancelAnimationFrame(raf); };
  }, []);

  function dragX(e: any, which: "nav" | "mw") { e.preventDefault(); const sx = e.clientX; const sw = which === "nav" ? navW : mwW; const mv = (ev: any) => { const dx = ev.clientX - sx; if (which === "nav") setNavW(Math.max(120, Math.min(360, sw + dx))); else setMwW(Math.max(120, Math.min(380, sw - dx))); }; const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function dragY(e: any) { e.preventDefault(); const sy = e.clientY; const sh = tbH; const mv = (ev: any) => { const dy = sy - ev.clientY; setTbH(Math.max(110, Math.min(520, sh + dy))); }; const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }

  async function place(symbol: string, type: "BUY" | "SELL", opts?: any) {
    setErr(""); if (!selAcc) { setErr("Select an account in the navigator first"); return; }
    const body = { accountId: selAcc.id, symbol, type, lots: Number(opts && opts.lots != null ? opts.lots : lot), sl: Number(opts && opts.sl != null ? opts.sl : sl), tp: Number(opts && opts.tp != null ? opts.tp : tp) };
    const r = await fetch("/api/desk/manual-trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setTicket(null); loadAll();
  }
  async function placeTicket(btnSide: "BUY" | "SELL") {
    if (!ticket) return;
    if (tform.type === "Market") { place(ticket, btnSide, { lots: tform.vol, sl: tform.sl, tp: tform.tp }); return; }
    setErr("");
    if (!selAcc) { setErr("Select an account first"); return; }
    const trig = Number(tform.price); if (!trig) { setErr("Enter a trigger price"); return; }
    const side = tform.type.indexOf("Buy") === 0 ? "BUY" : "SELL";
    const kind = tform.type.indexOf("Stop") !== -1 ? "STOP" : "LIMIT";
    const r = await fetch("/api/desk/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: selAcc.id, symbol: ticket, side, kind, lots: tform.vol, price: trig, sl: tform.sl, tp: tform.tp }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setTicket(null); loadAll();
  }
  async function close(id: string) { const r = await fetch("/api/desk/trades/" + id + "/close", { method: "POST" }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Close failed"); return; } loadAll(); }
  async function delTrade(id: string) { const r = await fetch("/api/desk/trades/" + id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Delete failed"); return; } loadAll(); }
  async function delTradesBulk(ids: string[]) { for (const id of ids) { await fetch("/api/desk/trades/" + id, { method: "DELETE" }); } setTradeSel({}); loadAll(); }
  function delClient(acc: any) { setMenu(null); askConfirm(`Delete ${acc.login} - ${acc.name}? This cannot be undone.`, async () => { const r = await fetch("/api/admin/clients/" + acc.id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }); }

  function openAct(kind: string, acc: any, finType?: string, label?: string) { setMenu(null); setMenuSub(""); setErr(""); setAform({}); setAct({ kind, acc, finType, label }); }
  function actTitle() { if (!act) return ""; const m: any = { money: act.label, manualpnl: "Manual P/L", transfer: "Transfer Between Accounts", rename: "Client Details", accountid: "Change Account ID", password: "Change Password", assignmgr: "Assign Manager", assign: "Assign Manager & Group", settings: "Account Settings", subaccount: "Create Sub-Account", assigngroup: "Assign Group", leverage: "Change Leverage", mclevel: "Margin Call Level" }; return m[act.kind] || "Action"; }
  function actIcon() { if (!act) return "fa-circle"; const m: any = { money: "fa-dollar-sign", manualpnl: "fa-chart-line", transfer: "fa-right-left", rename: "fa-user-pen", accountid: "fa-id-card", password: "fa-key", assignmgr: "fa-user-tie", assign: "fa-user-tie", settings: "fa-sliders", subaccount: "fa-sitemap", assigngroup: "fa-layer-group", leverage: "fa-gauge-high", mclevel: "fa-triangle-exclamation" }; return m[act.kind] || "fa-circle"; }
  function actPrimary() {
    if (!act) return { label: "Confirm", color: BUY, fg: "#04140e" };
    const m: any = {
      money: { label: "Apply", color: "#2563eb", fg: "#fff" }, transfer: { label: "Confirm Transfer", color: "#2563eb", fg: "#fff" },
      rename: { label: "Save Changes", color: "#2563eb", fg: "#fff" }, accountid: { label: "Change", color: "#2563eb", fg: "#fff" },
      subaccount: { label: "Create", color: "#2563eb", fg: "#fff" }, mclevel: { label: "Save", color: SELL, fg: "#fff" },
    };
    return m[act.kind] || { label: "Confirm", color: BUY, fg: "#04140e" };
  }
  const acctBal = (c: any) => c ? (Number(c.deposit || 0) - Number(c.withdrawal || 0) + Number(c.credit || 0) + Number(c.bonus || 0) + Number(c.pnl || 0)) : 0;
  const af = (k: string, v: any) => setAform((o: any) => ({ ...o, [k]: v }));
  async function submitAct() {
    if (!act) return; setErr("");
    const id = act.acc.id; let url = ""; let body: any = {};
    if (act.kind === "money") {
      const amt = Number(aform.amount); if (!amt || amt <= 0) { setErr("Enter an amount"); return; }
      let ref = (aform.ref || "").trim();
      let desc = (aform.desc ?? act.label ?? act.finType) as string; if (ref) desc = desc + " (ref: " + ref + ")";
      let appliedAt: string | undefined;
      if (aform.dateMode === "manual") { if (!aform.appliedAt) { setErr("Pick a date & time"); return; } appliedAt = new Date(aform.appliedAt).toISOString(); }
      url = "/api/admin/clients/" + id + "/balance"; body = { type: act.finType, amount: amt, description: desc, appliedAt };
    }
    else if (act.kind === "manualpnl") { const amt = Number(aform.amount); if (!amt) { setErr("Enter an amount (use - for a loss)"); return; } url = "/api/admin/clients/" + id + "/manage"; body = { action: "manualPnl", amount: amt, description: aform.note || "Manual P/L" }; }
    else if (act.kind === "transfer") {
      const amt = Number(aform.amount); if (!amt || amt <= 0) { setErr("Enter an amount"); return; }
      const fromId = aform.fromId || act.acc.id;
      const toAcc = clients.find((c: any) => c.id === aform.toId);
      if (!toAcc) { setErr("Choose a destination account"); return; }
      if (toAcc.id === fromId) { setErr("Source and destination must differ"); return; }
      url = "/api/admin/clients/" + fromId + "/manage"; body = { action: "transfer", amount: amt, toLogin: toAcc.login, note: aform.note };
    }
    else if (act.kind === "rename") {
      // optional inline password change
      if (aform.password) { if (String(aform.password).length < 6) { setErr("Password must be at least 6 characters"); return; } const pr = await fetch("/api/admin/clients/" + id + "/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: aform.password }) }); const pd = await pr.json(); if (!pd.ok) { setErr(pd.error || "Password change failed"); return; } }
      url = "/api/admin/clients/" + id + "/manage"; body = { action: "rename", name: aform.name ?? act.acc.name, email: aform.email ?? act.acc.email, phone: aform.phone ?? act.acc.phone, country: aform.country ?? act.acc.country };
    }
    else if (act.kind === "accountid") { const login = String(aform.login ?? act.acc.login).trim(); if (!login) { setErr("Enter an account ID"); return; } url = "/api/admin/clients/" + id + "/manage"; body = { action: "accountId", login }; }
    else if (act.kind === "password") { const pw = aform.password || ""; if (pw.length < 6) { setErr("Min 6 characters"); return; } url = "/api/admin/clients/" + id + "/password"; body = { password: pw }; }
    else if (act.kind === "assignmgr") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assignManager", managerId: aform.managerId || null }; }
    else if (act.kind === "settings") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", leverage: Number(aform.leverage ?? act.acc.leverage), mcLevel: Number(aform.mcLevel ?? act.acc.mcLevel), doNotLiquidate: aform.doNotLiquidate ?? act.acc.doNotLiquidate, currency: aform.currency ?? act.acc.currency }; }
    else if (act.kind === "subaccount") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "subAccount", name: aform.name || "", type: aform.subType || "LIVE", leverage: Number(aform.subLev) || act.acc.leverage, currency: aform.subCcy || act.acc.currency, deposit: Number(aform.subDep) || 0 }; }
    else if (act.kind === "assigngroup") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assignGroup", groupId: aform.groupId || null }; }
    else if (act.kind === "assign") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assign", managerId: (aform.managerId ?? act.acc.managerId) || null, groupId: (aform.groupId ?? act.acc.groupId) || null }; }
    else if (act.kind === "leverage") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", leverage: Number(aform.leverage ?? act.acc.leverage) }; }
    else if (act.kind === "mclevel") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", mcLevel: Number(aform.mcLevel ?? act.acc.mcLevel), doNotLiquidate: aform.doNotLiquidate ?? act.acc.doNotLiquidate }; }
    else return;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setAct(null); loadAll();
  }
  async function doStatus(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", locked: !acc.locked }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDeactivate(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deactivated: !acc.deactivated }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDNL(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", doNotLiquidate: !acc.doNotLiquidate }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  function doClearPin(acc: any) { setMenu(null); askConfirm(`Reset (clear) the PIN for ${acc.login}? They can set a new one next login.`, async () => { const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearPin" }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else setOk("PIN reset"); }, false); }
  async function doPool(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pool", promote: !acc.isPool }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDeactivateManage(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deactivate", deactivated: !acc.deactivated }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function modifyTrade(id: string, fields: any) { const r = await fetch("/api/desk/trades/" + id + "/modify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Modify failed"); return; } setInlineEdit((e) => { const n = { ...e }; delete n[id]; return n; }); loadAll(); }
  async function uploadKyc() { setErr(""); setKycUpMsg(""); if (!kycUploadFor || !kycUploadFile) { setErr("Select the front side"); return; } if (!kycBackFile) { setErr("Select the back side — both front and back are required"); return; } const fd = new FormData(); fd.append("login", kycUploadFor.login); fd.append("docType", kycUploadType); fd.append("file", kycUploadFile); fd.append("back", kycBackFile); const r = await fetch("/api/admin/kyc/upload", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false })); if (!r.ok) { setErr(r.error || "Upload failed"); return; } setKycUpMsg("Uploaded successfully"); setKycUploadFile(null); setKycBackFile(null); setTimeout(() => { setKycUploadFor(null); setKycUpMsg(""); }, 1500); loadAll(); }

  function openPos(kind: string, t: any) { setPosMenu(null); setErr(""); setPform(kind === "modify" ? { sl: t.sl || 0, tp: t.tp || 0 } : { lots: Number((Number(t.lots) / 2).toFixed(2)) || 0.01 }); setPos({ kind, t }); }
  async function submitPos() {
    if (!pos) return; setErr("");
    const t = pos.t; let url = ""; let body: any = {};
    if (pos.kind === "modify") { url = "/api/desk/trades/" + t.id + "/modify"; body = { sl: Number(pform.sl) || 0, tp: Number(pform.tp) || 0 }; }
    else { const lots = Number(pform.lots); if (!lots || lots <= 0 || lots >= Number(t.lots)) { setErr("Enter lots between 0 and " + t.lots); return; } url = "/api/desk/trades/" + t.id + "/partial"; body = { lots, price: prices[t.symbol] ?? t.openPrice }; }
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setPos(null); loadAll();
  }
  function openModal(kind: any) { setTopMenu(""); setErr(""); setOk(""); setForm({ type: "LIVE", leverage: 100, currency: "USD" }); setModal(kind); }
  async function submit(url: string, body: any, label: string) { setErr(""); setOk(""); const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setOk(label + " created"); setModal(""); loadAll(); }
  const f = (k: string, v: any) => setForm((o: any) => ({ ...o, [k]: v }));
  async function saveGroup() {
    setErr(""); setOk("");
    if (!form.name) { setErr("Group name required"); return; }
    const body = { name: form.name, spread: Number(form.spread) || 0, managerId: form.managerId || null };
    const url = form.editId ? "/api/admin/groups/" + form.editId : "/api/admin/groups";
    const r = await fetch(url, { method: form.editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setOk(form.editId ? "Group updated" : "Group created");
    setForm({ type: "LIVE", leverage: 100, currency: "USD" }); // reset form, keep modal open to manage more
    loadAll();
  }
  function editGroup(g: any) { setForm((o: any) => ({ ...o, editId: g.id, name: g.name, spread: g.spread, managerId: g.managerId || "" })); }
  function delGroup(g: any) {
    askConfirm(`Delete group "${g.name}"? Clients in it will be ungrouped.`, async () => {
      const r = await fetch("/api/admin/groups/" + g.id, { method: "DELETE" }); const d = await r.json();
      if (!d.ok) setErr(d.error || "Failed"); else { setOk("Group deleted"); setForm((o: any) => (o.editId === g.id ? { type: "LIVE", leverage: 100, currency: "USD" } : o)); loadAll(); }
    });
  }
  function delHist(h: any) {
    askConfirm("Delete this history row? Balance will be reversed.", async () => {
      const r = await fetch("/api/desk/history/" + h.id, { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { setErr(r.error || "Delete failed"); return; }
      loadAll();
    });
  }
  function delHistBulk() {
    const ids = Object.keys(histSel).filter((k) => histSel[k]);
    if (!ids.length) return;
    askConfirm(`Delete ${ids.length} row(s)? Balances will be reversed.`, async () => {
      const r = await fetch("/api/desk/history/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { setErr(r.error || "Bulk delete failed"); return; }
      setHistSel({}); loadAll();
    });
  }
  function openHEdit(h: any) { setHEdit({ ...h, amt: Math.abs(Number(h.pnl) || 0) }); }
  async function submitHEdit() {
    if (!hEdit) return; setErr("");
    const isFin = String(hEdit.id).startsWith("F");
    const body: any = isFin
      ? { amount: Number(hEdit.amt), description: hEdit.desc }
      : { closePrice: Number(hEdit.closePrice), pnl: Number(hEdit.pnl), sl: Number(hEdit.sl), tp: Number(hEdit.tp) };
    const r = await fetch("/api/desk/history/" + hEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Save failed"); return; }
    setHEdit(null); loadAll();
  }
  async function openMT(acc: any) {
    setMenu(null);
    const sym = selSym || (symbols[0] && symbols[0].symbol) || "";
    const now = new Date(); const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setMt({ acc, symbol: sym, type: "BUY", lots: 0.01, sl: 0, tp: 0, openPrice: prices[sym] ?? 0, follow: true, date: tz });
  }
  async function placeMT() {
    if (!mt) return; setErr("");
    const kind = mt.kind || "MARKET"; // MARKET | LIMIT | STOP
    if (kind !== "MARKET") {
      // Pending order
      const trig = Number(mt.openPrice) || (prices[mt.symbol] ?? 0);
      if (!trig) { setErr("Enter a trigger price"); return; }
      const r = await fetch("/api/desk/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: mt.acc.id, symbol: mt.symbol, side: mt.type, kind, lots: Number(mt.lots), price: trig, sl: Number(mt.sl) || 0, tp: Number(mt.tp) || 0 }) });
      const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
      setMt(null); loadPending(); loadAll(); return;
    }
    const body = { accountId: mt.acc.id, symbol: mt.symbol, type: mt.type, lots: Number(mt.lots), sl: Number(mt.sl) || 0, tp: Number(mt.tp) || 0, openPrice: Number(mt.openPrice) || (prices[mt.symbol] ?? 0), openedAt: mt.date ? new Date(mt.date).toISOString() : undefined };
    const r = await fetch("/api/desk/manual-trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMt(null); loadAll();
  }
  async function openSymOv(acc: any) {
    setMenu(null);
    const r = await fetch("/api/admin/clients/" + acc.id + "/symbols").then((x) => x.json()).catch(() => ({ ok: false }));
    const disabled: Record<string, boolean> = {};
    if (r.ok && Array.isArray(r.disabled)) r.disabled.forEach((s: string) => (disabled[s] = true));
    setSymOv({ acc, disabled, q: "" });
  }

  function setActive(i: number) { setActiveChart(i); if (openCharts[i]) setSelSym(openCharts[i]); }
  function setTile(sym: string) { setOpenCharts((prev) => { if (prev.length === 0) return [sym]; const n = prev.slice(); n[activeChart] = sym; return n; }); setSelSym(sym); }
  function addChart(sym: string) { setOpenCharts((prev) => prev.indexOf(sym) !== -1 ? prev : prev.concat([sym])); }
  function removeChart(i: number) { setOpenCharts((prev) => prev.filter((_, j) => j !== i)); setActiveChart((a) => a >= i && a > 0 ? a - 1 : a); }
  function openTicket(sym: string) { setTicket(sym); setTform({ vol: lot, sl: 0, tp: 0, type: "Market", price: 0 }); }

  const accOpen = selAcc ? open.filter((o) => o.accountLogin === selAcc.login) : open;
  const accPending = selAcc ? pendingOrders.filter((o) => o.accountLogin === selAcc.login) : pendingOrders;
  const balOfFn = (a: any) => a ? Number(a.deposit) - Number(a.withdrawal) + Number(a.credit) + Number(a.bonus) + Number(a.pnl) : 0;
  const floating = accOpen.reduce((s, p) => s + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
  const balance = balOfFn(selAcc);
  const equity = balance + floating;
  const used = selAcc ? accOpen.reduce((m, p) => { const cs = csz(p.symbol); const pr = prices[p.symbol] ?? p.openPrice; let mg = (p.lots * cs * pr) / (selAcc.leverage || 100); if (/JPY$/i.test(p.symbol)) mg = mg / 100; return m + mg; }, 0) : 0;
  const free = equity - used;
  const level = used > 0 ? (equity / used) * 100 : 0;

  const liveAccs = clients.filter((c) => !String(c.login).toUpperCase().startsWith("DEMO"));
  const demoAccs = clients.filter((c) => String(c.login).toUpperCase().startsWith("DEMO"));
  const groups: Record<string, any[]> = {};
  const mwQ = mwSearch.trim().toLowerCase();
  symbols
    .filter((s) => !mwQ || (s.symbol + " " + (s.display || "")).toLowerCase().includes(mwQ))
    .forEach((s) => { const cat = s.category || "other"; (groups[cat] || (groups[cat] = [])).push(s); });
  // Market watch category order: Crypto, Forex, Indices, then the rest
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const orderedGroups = Object.entries(groups).sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a[0]); const ib = CAT_ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const px = (sym: string) => prices[sym]?.toFixed(dg(sym)) ?? "...";
  const dot = (c: string) => (<span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />);
  const inp = "mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]";
  const lab = "text-[10px] text-[var(--muted)]";
  const flab = "mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";
  const mi = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)] transition-colors";
  const subi = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)] transition-colors";
  const mIco = (icon: string, color?: string) => <i className={"fa-solid " + icon} style={{ width: 13, fontSize: 11, textAlign: "center", color: color || "var(--muted)" }} />;
  const tgl = (on: boolean) => "rounded border border-[var(--border)] px-2 py-1 " + (on ? "" : "opacity-50");
  function toggleCat(c: string) { setCollapsed((o) => ({ ...o, [c]: !o[c] })); }
  function togglePanel(k: "nav" | "mw" | "toolbox") { setPanels((p) => ({ ...p, [k]: !p[k] })); }
  const stTag = (txt: string, col: string) => (<span className="rounded px-1 text-[8px] font-semibold" style={{ background: col + "22", color: col }}>{txt}</span>);
  const sIco = (icon: string, col: string, title: string) => (<i className={"fa-solid " + icon} title={title} style={{ fontSize: 9.5, color: col }} />);
  const acctRow = (c: any) => (
    <button key={c.id} onClick={() => setSelAcc(c)} onContextMenu={(e) => { e.preventDefault(); setSelAcc(c); setMenu({ x: e.clientX, y: e.clientY, acc: c }); }}
      className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left" style={selAcc?.id === c.id ? { background: "var(--soft)", color: GOLD } : undefined}>
      {dot(c.deactivated ? "var(--muted)" : c.locked ? SELL : BUY)}<span className="flex-1 truncate">{c.login} - {c.name}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/* Active / Deactivated */}
        {c.deactivated ? sIco("fa-ban", "#8b97a8", "Deactivated") : sIco("fa-circle-check", BUY, "Active")}
        {/* Locked */}
        {c.locked ? sIco("fa-lock", SELL, "Locked") : null}
        {/* Do Not Liquidate */}
        {c.doNotLiquidate ? sIco("fa-hand", GOLD, "Do Not Liquidate (DNL)") : null}
        {/* KYC status */}
        {c.kycStatus === "APPROVED"
          ? sIco("fa-id-card", BUY, "KYC Verified")
          : c.kycStatus === "PENDING"
          ? sIco("fa-id-card", GOLD, "KYC Pending")
          : sIco("fa-id-card", "#6b7280", "KYC Not Verified")}
      </span>
    </button>
  );

  const shown: { sym: string; i: number }[] = layout === 1 ? (openCharts[activeChart] ? [{ sym: openCharts[activeChart], i: activeChart }] : []) : openCharts.slice(0, layout).map((sym, i) => ({ sym, i }));
  const ocStrip = (sym: string) => { const p = prices[sym]; const d = dg(sym); const bid = p != null ? (p * 0.9999).toFixed(d) : "..."; const ask = p != null ? (p * 1.0001).toFixed(d) : "...";
    if (!showOC) return (
      <button onClick={(e) => { e.stopPropagation(); setShowOC(true); }} className="absolute left-2 top-2 z-10 rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: "rgba(9,12,18,0.9)", border: "1px solid rgba(255,255,255,0.12)", color: "#9aa6bf" }} title="Show buy/sell">
        <i className="fa-solid fa-bolt" /> Trade
      </button>
    );
    return (
    <div className="absolute left-2 top-2 z-10 flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(9,12,18,0.90)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(6px)" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => place(sym, "SELL")} className="flex flex-col items-center rounded-lg px-4 py-1.5 font-bold transition-opacity hover:opacity-90 active:scale-95" style={{ background: "rgba(224,82,96,0.92)", color: "#fff", minWidth: 72, lineHeight: 1.2 }}>
        <span style={{ fontSize: 13, letterSpacing: "0.02em" }}>Sell</span>
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>{bid}</span>
      </button>
      <div className="flex flex-col items-center gap-0.5">
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Lots</div>
        <input type="number" step="0.01" min="0.01" value={lot} onChange={(e) => setLot(Number(e.target.value))} className="w-14 rounded border text-center font-mono" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", color: "#e2e8f0", padding: "3px 4px", fontSize: 12, outline: "none" }} />
      </div>
      <button onClick={() => place(sym, "BUY")} className="flex flex-col items-center rounded-lg px-4 py-1.5 font-bold transition-opacity hover:opacity-90 active:scale-95" style={{ background: "rgba(47,129,247,0.92)", color: "#fff", minWidth: 72, lineHeight: 1.2 }}>
        <span style={{ fontSize: 13, letterSpacing: "0.02em" }}>Buy</span>
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>{ask}</span>
      </button>
      <button onClick={(e) => { e.stopPropagation(); setShowOC(false); }} className="ml-1 self-start text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }} title="Hide buy/sell"><i className="fa-solid fa-eye-slash" /></button>
    </div>); };
  return (
    <div style={theme === "dark" ? DARK : LIGHT} className="relative flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="flex items-stretch border-b border-[var(--border)] bg-[var(--panel)] text-[11px]">
        <div className="flex items-center gap-2 border-r border-[var(--border)] px-3 py-1.5" style={{ width: panels.nav ? navW + 1 : undefined }}>
          <span className="inline-block h-4 w-4 rounded" style={{ background: "var(--accent)" }} /><b className="font-medium">Platform</b>
        </div>
        <div className="flex flex-1 items-center gap-0.5 px-2 py-1">
          {(() => {
            const tm = (name: string) => () => setTopMenu((m) => (m === name ? "" : name));
            const closeTm = () => setTopMenu("");
            const topBtn = (name: string, label: string, icon: string) => (
              <button onClick={tm(name)} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-[var(--soft)]" style={{ color: topMenu === name ? "var(--text)" : "var(--muted)", background: topMenu === name ? "var(--soft)" : "transparent" }}>
                <i className={"fa-solid " + icon} style={{ fontSize: 11 }} />{label}<i className="fa-solid fa-chevron-down" style={{ fontSize: 7, opacity: 0.5 }} />
              </button>
            );
            const dItem = (onClick: () => void, icon: string, label: string, color?: string, active?: boolean, key?: string) => (
              <button key={key || label} onClick={() => { onClick(); closeTm(); }} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)] transition-colors">
                <i className={"fa-solid " + icon} style={{ width: 14, fontSize: 11, textAlign: "center", color: color || "var(--muted)" }} />
                <span className="flex-1">{label}</span>
                {active !== undefined && <i className="fa-solid fa-check" style={{ fontSize: 9, color: active ? BUY : "transparent" }} />}
              </button>
            );
            const dDivider = <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />;
            const dHead = (t: string) => <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t}</div>;
            const panel = "absolute left-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border py-1";
            const panelStyle = { background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" } as any;
            return (<>
              {/* NEW MENU */}
              <div className="relative">
                {topBtn("new", "New", "fa-plus")}
                {topMenu === "new" && (<><div className="fixed inset-0 z-40" onClick={closeTm} />
                  <div className={panel} style={panelStyle}>
                    {dItem(() => openTicket(selSym), "fa-bolt", "New Order", "var(--accent)")}
                    {dDivider}
                    {dHead("Create")}
                    {can("createClients") && dItem(() => openModal("client"), "fa-user-plus", "New Client", BUY)}
                    {!isManager && can("manageManagers") && dItem(() => openModal("manager"), "fa-user-tie", "New Manager")}
                    {!isManager && dItem(() => openModal("group"), "fa-layer-group", "Groups")}
                    {dDivider}
                    {can("sendNotifications") && dItem(() => openModal("notify"), "fa-paper-plane", "Send Notification", GOLD)}
                  </div></>)}
              </div>

              {/* CHARTS MENU */}
              <div className="relative">
                {topBtn("charts", "Charts", "fa-chart-candlestick")}
                {topMenu === "charts" && (<><div className="fixed inset-0 z-40" onClick={closeTm} />
                  <div className={panel} style={panelStyle}>
                    {dHead("Layout")}
                    {dItem(() => setLayout(1), "fa-square", "Single Chart", undefined, layout === 1)}
                    {dItem(() => setLayout(2), "fa-table-columns", "Split (1 | 1)", undefined, layout === 2)}
                    {dItem(() => setLayout(4), "fa-table-cells-large", "Grid (4 Charts)", undefined, layout === 4)}
                    {dDivider}
                    {dHead("Timeframe")}
                    <div className="flex flex-wrap gap-1 px-3 py-1">
                      {TFS.map((t) => <button key={t} onClick={() => { setTf(t); closeTm(); }} className="rounded px-2 py-0.5 text-[10px]" style={tf === t ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{t}</button>)}
                    </div>
                  </div></>)}
              </div>

              {/* VIEW MENU — all panels in one place */}
              <div className="relative">
                {topBtn("view", "View", "fa-table-cells")}
                {topMenu === "view" && (<><div className="fixed inset-0 z-40" onClick={closeTm} />
                  <div className={panel} style={panelStyle}>
                    {dHead("Panels")}
                    {dItem(() => togglePanel("nav"), "fa-folder-tree", "Navigator", undefined, panels.nav)}
                    {dItem(() => togglePanel("mw"), "fa-list", "Market Watch", undefined, panels.mw)}
                    {dItem(() => togglePanel("toolbox"), "fa-toolbox", "Toolbox", undefined, panels.toolbox)}
                    {dDivider}
                    {dHead("Toolbox Tabs")}
                    {TABS.map(([k, lbl]) => dItem(() => setTabState((s) => ({ ...s, [k]: !s[k] })), "fa-table-list", lbl, undefined, tabState[k], "tab-" + k))}
                    {dDivider}
                    {dItem(openSymPerm, "fa-eye-slash", "Symbol Access…", "var(--accent)")}
                    {dItem(toggleFundPnlOnly, "fa-money-bill-transfer", "Withdraw/Transfer: PNL only", fundPnlOnly ? BUY : "var(--muted)", fundPnlOnly)}
                  </div></>)}
              </div>

              {/* REPORTS MENU */}
              <div className="relative">
                {topBtn("report", "Reports", "fa-file-lines")}
                {topMenu === "report" && (<><div className="fixed inset-0 z-40" onClick={closeTm} />
                  <div className={panel} style={panelStyle}>
                    {dHead("Account Reports")}
                    {dItem(() => { if (!selAcc) { setErr("Select an account first"); return; } window.open("/api/desk/reports?accountId=" + selAcc.id, "_blank"); }, "fa-file-pdf", "Export PDF Statement", "#ef4444")}
                  </div></>)}
              </div>
            </>);
          })()}

          <span className="flex-1" />
          <button onClick={() => { const m = !soundMuted; setMuted(m); setSoundMuted(m); if (!m) playSound("notice"); }} className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]" title={soundMuted ? "Unmute alerts" : "Mute alerts"}><i className={"fa-solid " + (soundMuted ? "fa-volume-xmark" : "fa-volume-high")} /></button>
          <button onClick={toggleTheme} className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]" title={theme === "dark" ? "Light mode" : "Dark mode"}><i className={"fa-solid " + (theme === "dark" ? "fa-sun" : "fa-moon")} /></button>
          <div className="relative">
            <button onClick={openNotifs} className="relative rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]" title="Notifications">
              <i className="fa-solid fa-bell" />
              {notifUnread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white" style={{ background: SELL }}>{notifUnread}</span>}
            </button>
            {notifOpen && (<><div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-auto rounded-lg border shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                <div className="sticky top-0 border-b px-3 py-2 text-[11px] font-semibold" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>Notifications</div>
                {notifs.length === 0 ? <div className="px-3 py-6 text-center text-[11px] text-[var(--muted)]"><i className="fa-solid fa-bell-slash mb-1 block text-lg opacity-40" />No notifications</div>
                  : notifs.map((n: any) => (
                    <div key={n.id} className="border-b px-3 py-2 last:border-0" style={{ borderColor: "var(--border)" }}>
                      <div className="text-[11px] font-medium">{n.title}</div>
                      {n.body && <div className="mt-0.5 text-[10px] text-[var(--muted)]">{n.body}</div>}
                      <div className="mt-0.5 text-[9px] text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
              </div></>)}
          </div>
          <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} className="rounded px-2 py-1 hover:bg-[var(--soft)]" style={{ color: SELL }} title="Logout"><i className="fa-solid fa-right-from-bracket" /></button>
        </div>
      </div>      {ok && <div className="px-3 py-1 text-[11px]" style={{ color: BUY }}>{ok}</div>}

      <div className="flex min-h-0 flex-1">
        {panels.nav && (<>
          <aside className="flex flex-col border-r border-[var(--border)] bg-[var(--panel)]" style={{ width: navW }}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">NAVIGATOR<button onClick={() => togglePanel("nav")} aria-label="hide">x</button></div>
            {/* Live / Demo tabs */}
            <div className="flex border-b border-[var(--border)] text-[10px]">
              <button onClick={() => setNavTab("live")} className="flex-1 py-1.5 font-semibold" style={navTab === "live" ? { color: BUY, borderBottom: `2px solid ${BUY}` } : { color: "var(--muted)" }}>LIVE ({liveAccs.length})</button>
              <button onClick={() => setNavTab("demo")} className="flex-1 py-1.5 font-semibold" style={navTab === "demo" ? { color: "var(--accent)", borderBottom: `2px solid var(--accent)` } : { color: "var(--muted)" }}>DEMO ({demoAccs.length})</button>
            </div>
            <div className="border-b border-[var(--border)] px-1.5 py-1">
              <input value={navSearch} onChange={(e) => setNavSearch(e.target.value)} placeholder="Search login / name\u2026" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] text-[var(--text)]" />
            </div>
            <div className="flex-1 overflow-auto p-1 text-[11px]">
              {(() => {
                const base = navTab === "live" ? liveAccs : demoAccs;
                const list = navSearch ? base.filter((c: any) => (c.login + " " + c.name + " " + (c.user?.email || c.email || "")).toLowerCase().includes(navSearch.toLowerCase())) : base;
                if (!list.length) return <div className="px-2 py-3 text-center text-[var(--muted)]">No {navTab} accounts.</div>;
                // 3-level hierarchy: manager > group > client.
                // - direct: no manager AND no group -> top-level "Accounts"
                // - admin-level groups (no manager) -> top-level group sections
                // - each manager -> its owned groups (nested) + its clients with no group
                const direct = list.filter((c: any) => !c.manager && !c.group);
                const grpOwner: Record<string, string | null> = {}; // groupId -> managerId|null
                tradeGroups.forEach((g: any) => { grpOwner[g.id] = g.managerId || null; });
                const grpRows: Record<string, any[]> = {};
                const mgrDirect: Record<string, any[]> = {}; // manager clients with no group
                list.forEach((c: any) => {
                  if (c.group) { (grpRows[c.group.id] || (grpRows[c.group.id] = [])).push(c); }
                  else if (c.manager) { (mgrDirect[c.manager.id] || (mgrDirect[c.manager.id] = [])).push(c); }
                });
                const grpName = (gid: string) => (tradeGroups.find((g: any) => g.id === gid)?.name) || (grpRows[gid]?.[0]?.group?.name) || "Group";
                const mgrName: Record<string, string> = {};
                list.forEach((c: any) => { if (c.manager) mgrName[c.manager.id] = c.manager.name; });
                managers.forEach((m: any) => { if (!mgrName[m.id]) mgrName[m.id] = m.name; });
                const groupIdsWithRows = Object.keys(grpRows);
                const adminGroups = groupIdsWithRows.filter((gid) => !grpOwner[gid]);
                const mgrGroups: Record<string, string[]> = {};
                groupIdsWithRows.forEach((gid) => { const mid = grpOwner[gid]; if (mid) (mgrGroups[mid] || (mgrGroups[mid] = [])).push(gid); });
                const managerIds = Array.from(new Set([...Object.keys(mgrDirect), ...Object.keys(mgrGroups)]));

                const header = (key: string, label: string, icon: string, color: string, count: number, pad = "") => (
                  <button onClick={() => toggleCat(key)} className={"flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-semibold " + pad} style={{ color }}>
                    <i className={"fa-solid " + (collapsed[key] ? "fa-chevron-right" : "fa-chevron-down")} style={{ fontSize: 8 }} />
                    <i className={"fa-solid " + icon} style={{ fontSize: 10 }} />
                    <span className="flex-1 truncate text-left">{label}</span>
                    <span className="rounded px-1.5" style={{ background: color + "22" }}>{count}</span>
                  </button>
                );
                const groupSection = (gid: string, nested = false) => (
                  <div key={"grp-" + gid} className={nested ? "" : "mt-0.5"}>
                    {header("grp-" + gid, grpName(gid), "fa-folder", "var(--accent)", grpRows[gid].length)}
                    {!collapsed["grp-" + gid] && <div className="flex flex-col gap-0.5 pl-2">{grpRows[gid].map(acctRow)}</div>}
                  </div>
                );
                return (
                  <div className="flex flex-col gap-0.5">
                    {direct.length > 0 && (<>
                      <div className="px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{navTab === "live" ? "Live" : "Demo"} Accounts</div>
                      {direct.map(acctRow)}
                    </>)}
                    {adminGroups.map((gid) => groupSection(gid))}
                    {managerIds.map((mid) => {
                      const groups = mgrGroups[mid] || [];
                      const loose = mgrDirect[mid] || [];
                      const count = groups.reduce((n, gid) => n + grpRows[gid].length, 0) + loose.length;
                      return (
                        <div key={"mgr-" + mid} className="mt-0.5">
                          {header("mgr-" + mid, mgrName[mid] || "Manager", "fa-user-tie", GOLD, count)}
                          {!collapsed["mgr-" + mid] && (
                            <div className="flex flex-col gap-0.5 pl-2">
                              {groups.map((gid) => groupSection(gid, true))}
                              {loose.map(acctRow)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </aside>
          <div onMouseDown={(e) => dragX(e, "nav")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]" />
        </>)}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[11px]">
            <div className="flex flex-1 items-center gap-1 overflow-auto">
              {openCharts.map((s, i) => (
                <span key={s + "-" + i} onClick={() => setActive(i)} className="flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5" style={i === activeChart ? { borderColor: "var(--accent)", color: "var(--text)" } : { borderColor: "var(--border)", color: "var(--muted)" }}>
                  {s} <span style={{ color: i === activeChart ? "var(--text)" : "var(--accent)" }}>{px(s)}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeChart(i); }} className="text-[var(--muted)]">{"\u00D7"}</button>
                </span>
              ))}
              <button onClick={() => { const a = symbols.find((s) => openCharts.indexOf(s.symbol) === -1); if (a) addChart(a.symbol); }} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">+</button>
            </div>
            <span className="mx-1 h-3 w-px bg-[var(--border)]" />
            {TFS.map((t) => (<button key={t} onClick={() => setTf(t)} className="rounded px-2 py-0.5" style={tf === t ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{t}</button>))}
          </div>
          <div className="grid min-h-0 flex-1 gap-px bg-[var(--border)]" style={{ gridTemplateColumns: layout === 1 ? "1fr" : "1fr 1fr", gridTemplateRows: layout === 4 ? "1fr 1fr" : "1fr" }}>
            {shown.length === 0 ? <div className="flex items-center justify-center text-[var(--muted)]">No chart open.</div> : shown.map(({ sym, i }) => (
              <div key={sym + i} className="relative min-h-0 bg-[var(--bg)]" onClick={() => setActive(i)}>
                
                {ocStrip(sym)}
                <LWChart symbol={sym} tf={tf} theme={theme} digits={dg(sym)} positions={[
                  ...open.filter((o) => o.symbol === sym && (!selAcc || o.accountLogin === selAcc.login)).map((o) => ({ id: o.id, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                  ...pendingOrders.filter((o) => o.symbol === sym && (!selAcc || o.accountLogin === selAcc.login)).map((o) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                ]} onClose={(id) => { if (id.startsWith("pnd-")) cancelPending(id.slice(4)); else close(id); }} />
              </div>
            ))}
          </div>
        </div>

        {panels.mw && (<>
          <div onMouseDown={(e) => dragX(e, "mw")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]" />
          <aside className="flex flex-col border-l border-[var(--border)] bg-[var(--panel)]" style={{ width: mwW }}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">MARKET WATCH<button onClick={() => togglePanel("mw")} aria-label="hide">x</button></div>
            <div className="border-b border-[var(--border)] px-1.5 py-1">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]" />
                <input value={mwSearch} onChange={(e) => setMwSearch(e.target.value)} placeholder="Search symbol…" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-1 pl-6 pr-6 text-[10px] text-[var(--text)]" />
                {mwSearch && <button onClick={() => setMwSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]" aria-label="clear">{"×"}</button>}
              </div>
            </div>
            <div className="flex-1 overflow-auto px-1 pb-2 text-[10px]">
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_72px_72px] bg-[var(--panel)] px-2 py-1 text-[10px] text-[var(--muted)]"><span>Symbol</span><span className="text-right pr-1">Bid</span><span className="text-right pr-1">Ask</span></div>
              {orderedGroups.map(([cat, list]) => (
                <div key={cat}>
                  <div onClick={() => toggleCat(cat)} className="mt-1 cursor-pointer rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)]">{collapsed[cat] ? "\u25B8" : "\u25BE"} {cat.toUpperCase()}</div>
                  {!collapsed[cat] && list.map((s) => { const p = prices[s.symbol]; const d = dg(s.symbol); const bid = p != null ? (p * 0.9999).toFixed(d) : "..."; const ask = p != null ? (p * 1.0001).toFixed(d) : "..."; const dir = dirs[s.symbol] || 0;
                    return (
                    <div key={s.symbol} onDoubleClick={() => setTile(s.symbol)} className={"grid grid-cols-[1fr_72px_72px] items-stretch py-1 hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")} style={{ borderRadius: 3, minHeight: 22 }}>
                      <button onClick={() => setTile(s.symbol)} className="truncate pl-2 text-left">{s.symbol}</button>
                      <PriceCell value={bid} dir={dir} />
                      <PriceCell value={ask} dir={dir} />
                    </div>); })}
                </div>
              ))}
              {orderedGroups.length === 0 && <div className="px-2 py-3 text-center text-[var(--muted)]">No symbols match &ldquo;{mwSearch}&rdquo;.</div>}
            </div>
          </aside>
        </>)}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[10px]" style={{ color: GOLD }}>
        <span>Balance: <span className="text-[var(--text)]">{selAcc ? fmt(balance) : "--"}</span></span>
        <span>Flt P/L: <span style={{ color: floating >= 0 ? BUY : SELL }}>{selAcc ? fmt(floating) : "--"}</span></span>
        <span>Equity: <span className="text-[var(--text)]">{selAcc ? fmt(equity) : "--"}</span></span>
        <span>Free: <span className="text-[var(--text)]">{selAcc ? fmt(free) : "--"}</span></span>
        <span>Level: <span className="text-[var(--text)]">{selAcc && level ? level.toFixed(1) + "%" : "--"}</span></span>
        <span>{selAcc ? selAcc.login + " - " + selAcc.name : "No account selected"}</span>
      </div>
      {err && !act && !modal && !ticket && <div className="px-3 py-1 text-[11px]" style={{ color: SELL }}>{err}</div>}

      {panels.toolbox && (<>
        <div onMouseDown={dragY} className="h-1 cursor-row-resize bg-[var(--border)] hover:bg-[var(--accent)]" />
        <div className="flex shrink-0 flex-col" style={{ height: tbH }}>
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-2">
            <div className="flex flex-1 gap-1 overflow-auto">
              {TABS.filter(([k]) => tabState[k] && (k !== "audit" || can("viewAudit"))).map(([k, lbl]) => (
                <span key={k} className="flex items-center">
                  <button onClick={() => setTab(k)} className="px-3 py-1.5 text-xs" style={tab === k ? { color: "var(--accent)" } : { color: "var(--muted)" }}>{lbl}{k === "trade" ? " (" + accOpen.length + (accPending.length ? " + " + accPending.length + "p" : "") + ")" : ""}</button>
                  <button onClick={() => setTabState((s) => ({ ...s, [k]: false }))} className="text-[var(--muted)]">{"\u00D7"}</button>
                </span>
              ))}
            </div>
            <button onClick={() => togglePanel("toolbox")} className="px-2 text-[var(--muted)]">x</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "trade" && (() => {
              const tAllOn = accOpen.length > 0 && accOpen.every((p) => tradeSel[p.id]);
              const tToggleAll = () => { if (tAllOn) setTradeSel({}); else { const n: Record<string, boolean> = {}; accOpen.forEach((p) => (n[p.id] = true)); setTradeSel(n); } };
              const tSelIds = accOpen.filter((p) => tradeSel[p.id]).map((p) => p.id);
              const odt = (p: any) => { const v = p.openTime || p.openedAt || p.createdAt || p.time; return v ? new Date(v).toLocaleString() : "-"; };
              const oid = (p: any) => p.ticket ?? p.orderId ?? p.order ?? p.id;
              const thc = "px-2 py-1 text-left font-normal text-[var(--muted)]";
              return (
                <table className="w-full text-[10px]">
                  <thead><tr className="border-b border-[var(--border)]">
                    <th className={thc}><input type="checkbox" checked={tAllOn} onChange={tToggleAll} /></th>
                    <th className={thc}>Date Time</th><th className={thc}>Order ID</th><th className={thc}>Symbol</th><th className={thc}>Type</th>
                    <th className={thc + " text-right"}>Lots</th><th className={thc + " text-right"}>Open Price</th><th className={thc + " text-right"}>S/L</th><th className={thc + " text-right"}>T/P</th>
                    <th className={thc + " text-right"}>Current</th><th className={thc + " text-right"}>PnL</th><th className={thc + " text-right"}>Action</th>
                  </tr></thead>
                  <tbody>
                    {tSelIds.length > 0 && (<tr><td colSpan={12} className="px-2 py-1 space-x-1">
                      <button onClick={() => askConfirm("Close " + tSelIds.length + " trade(s)?", () => { tSelIds.forEach((id) => close(id)); setTradeSel({}); })} className="rounded px-2 py-0.5 text-[9px] font-medium" style={{ background: SELL, color: "#fff" }}>Close Selected ({tSelIds.length})</button>
                      {can("deleteTrades") && <button onClick={() => askConfirm("Delete " + tSelIds.length + " open trade(s)? This removes them entirely (no P/L realized).", () => delTradesBulk(tSelIds))} className="rounded px-2 py-0.5 text-[9px] font-medium" style={{ background: "var(--soft)", color: SELL, border: "1px solid rgba(224,82,96,0.4)" }}>Delete Selected ({tSelIds.length})</button>}
                    </td></tr>)}
                    {accOpen.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={12}>No open trades.</td></tr> : accOpen.map((p) => {
                      const cur = prices[p.symbol] ?? p.openPrice;
                      const pl = pnlOf(p, cur, csz(p.symbol));
                      const ie = inlineEdit[p.id] || {};
                      const isEditing = !!inlineEdit[p.id];
                      const ei = (f: string, def: any) => ie[f] !== undefined ? ie[f] : def;
                      const setIe = (f: string, v: any) => setInlineEdit((e) => ({ ...e, [p.id]: { ...(e[p.id] || {}), [f]: v } }));
                      const tInp = "rounded border bg-[var(--soft)] border-[var(--border)] text-[var(--text)] text-right px-1 py-0.5 text-[9px] w-16 outline-none";
                      return (
                        <tr key={p.id} className={"border-b border-[var(--border)] " + (isEditing ? "bg-[var(--soft)]" : "hover:bg-[var(--soft)]")}>
                          <td className="px-2 py-1"><input type="checkbox" checked={!!tradeSel[p.id]} onChange={() => setTradeSel((s) => ({ ...s, [p.id]: !s[p.id] }))} /></td>
                          <td className="px-2 py-1 text-[var(--muted)]">
                            {isEditing ? <input type="datetime-local" className="rounded border bg-[var(--soft)] border-[var(--border)] text-[var(--text)] px-1 py-0.5 text-[9px] w-32" value={ei("openedAt", new Date(p.openedAt || p.createdAt).toISOString().slice(0,16))} onChange={(e) => setIe("openedAt", e.target.value)} /> : odt(p)}
                          </td>
                          <td className="px-2 py-1">{oid(p)}</td>
                          <td className="px-2 py-1">{p.symbol}</td>
                          <td className="px-2 py-1">
                            {isEditing ? <select className="rounded border bg-[var(--soft)] border-[var(--border)] text-[var(--text)] text-[9px] px-1 py-0.5" value={ei("type", p.type)} onChange={(e) => setIe("type", e.target.value)}><option>BUY</option><option>SELL</option></select>
                              : <span style={{ color: p.type === "BUY" ? BUY : SELL }}>{p.type}</span>}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {isEditing ? <input type="number" step="0.01" min="0.01" className={tInp} value={ei("lots", p.lots)} onChange={(e) => setIe("lots", e.target.value)} /> : p.lots}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {isEditing ? <input type="number" step="0.00001" className={tInp} value={ei("openPrice", pxFmt(p.symbol, p.openPrice))} onChange={(e) => setIe("openPrice", e.target.value)} /> : pxFmt(p.symbol, p.openPrice)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input type="number" step="0.00001" className={tInp} placeholder="0" value={ei("sl", p.sl ? Number(p.sl).toFixed(dg(p.symbol)) : "")} onChange={(e) => { setIe("sl", e.target.value); }} />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input type="number" step="0.00001" className={tInp} placeholder="0" value={ei("tp", p.tp ? Number(p.tp).toFixed(dg(p.symbol)) : "")} onChange={(e) => { setIe("tp", e.target.value); }} />
                          </td>
                          <td className="px-2 py-1 text-right">{pxFmt(p.symbol, cur)}</td>
                          <td className="px-2 py-1 text-right" style={{ color: pl >= 0 ? BUY : SELL }}>{pl.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {isEditing ? (<>
                              <button onClick={() => modifyTrade(p.id, { sl: ie.sl !== undefined ? Number(ie.sl) : Number(p.sl) || 0, tp: ie.tp !== undefined ? Number(ie.tp) : Number(p.tp) || 0, ...(ie.lots ? { lots: ie.lots } : {}), ...(ie.openPrice ? { openPrice: ie.openPrice } : {}), ...(ie.type ? { type: ie.type } : {}), ...(ie.openedAt ? { openedAt: ie.openedAt } : {}) })} className="mr-1 rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: BUY, color: "#fff" }}>Save</button>
                              <button onClick={() => setInlineEdit((e) => { const n = { ...e }; delete n[p.id]; return n; })} className="mr-1 rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: "var(--muted)" }}>✕</button>
                            </>) : (
                              <button onClick={() => setInlineEdit((e) => ({ ...e, [p.id]: { sl: p.sl ? Number(p.sl) : "", tp: p.tp ? Number(p.tp) : "" } }))} className="mr-1 rounded px-1.5 py-0.5 text-[9px]" title="Edit trade" style={{ background: "var(--soft)", color: "var(--accent)" }}>
                                <i className="fa-solid fa-pen" style={{ fontSize: 8 }} />
                              </button>
                            )}
                            <button onClick={() => askConfirm("Close " + p.symbol + " " + p.type + " " + p.lots + "L at market?", () => close(p.id), false)} className="mr-1 rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(224,82,96,0.15)", color: SELL, border: "1px solid rgba(224,82,96,0.3)" }}>
                              Close ×
                            </button>
                            {can("deleteTrades") && <button onClick={() => askConfirm("Delete this open trade entirely? No P/L is realized.", () => delTrade(p.id))} title="Delete trade" className="rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: SELL }}><i className="fa-solid fa-trash" style={{ fontSize: 8 }} /></button>}
                          </td>
                        </tr>);
                    })}
                    {accPending.length > 0 && (
                      <tr><td colSpan={12} className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                        <i className="fa-solid fa-hourglass-half mr-1" />Pending Orders ({accPending.length})
                      </td></tr>
                    )}
                    {accPending.map((o) => (
                      <tr key={"pnd-" + o.id} className="border-b border-[var(--border)]" style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
                        <td className="px-2 py-1"><i className="fa-solid fa-clock text-[9px]" style={{ color: "var(--accent)" }} /></td>
                        <td className="px-2 py-1 text-[var(--muted)]">{new Date(o.createdAt).toLocaleString()}</td>
                        <td className="px-2 py-1">—</td>
                        <td className="px-2 py-1">{o.symbol}</td>
                        <td className="px-2 py-1" style={{ color: o.side === "BUY" ? BUY : SELL }}>{o.side} {o.kind}</td>
                        <td className="px-2 py-1 text-right">{o.lots}</td>
                        <td className="px-2 py-1 text-right" title="Trigger price">{pxFmt(o.symbol, o.price)} <span className="text-[8px] text-[var(--muted)]">trig</span></td>
                        <td className="px-2 py-1 text-right">{o.sl ? pxFmt(o.symbol, o.sl) : "-"}</td>
                        <td className="px-2 py-1 text-right">{o.tp ? pxFmt(o.symbol, o.tp) : "-"}</td>
                        <td className="px-2 py-1 text-right">{pxFmt(o.symbol, prices[o.symbol] ?? o.price)}</td>
                        <td className="px-2 py-1 text-right text-[var(--muted)]">pending</td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          <button onClick={() => cancelPending(o.id)} className="rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(224,82,96,0.15)", color: SELL, border: "1px solid rgba(224,82,96,0.3)" }}>Cancel ×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            {tab === "history" && (() => {
              const thc = "px-2 py-1 text-left font-normal text-[var(--muted)]";
              const presets: [string, string][] = [["ALL", "All Time"], ["TODAY", "Today"], ["WEEK", "This Week"], ["MONTH", "This Month"]];
              const hdt = (h: any) => h.closeTime || h.closedAt || h.closeDate || h.createdAt || h.date || h.time;
              const inRange = (h: any) => {
                const d = hdt(h); if (!d) return hfPreset === "ALL" && !hfFrom && !hfTo;
                const dt = new Date(d); const now = new Date();
                if (hfPreset === "TODAY") { return dt.toDateString() === now.toDateString(); }
                if (hfPreset === "WEEK") { const wk = new Date(now); wk.setDate(now.getDate() - 7); return dt >= wk; }
                if (hfPreset === "MONTH") { const mo = new Date(now); mo.setMonth(now.getMonth() - 1); return dt >= mo; }
                if (hfFrom && dt < new Date(hfFrom)) return false;
                if (hfTo && dt > new Date(hfTo + "T23:59:59")) return false;
                return true;
              };
              const hType = (h: any) => String(h.side || h.type || "").toUpperCase();
              const rows = history.filter((h) => (hfType === "ALL" || hType(h) === hfType)).filter(inRange);
              const hAllOn = rows.length > 0 && rows.every((h) => histSel[h.id]);
              const hToggleAll = () => { if (hAllOn) setHistSel({}); else { const n: Record<string, boolean> = {}; rows.forEach((h) => (n[h.id] = true)); setHistSel(n); } };
              return (
                <div className="flex h-full flex-col text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
                    {presets.map(([k, lbl]) => <button key={k} onClick={() => { setHfPreset(k); setHfFrom(""); setHfTo(""); }} className="rounded px-2 py-0.5" style={hfPreset === k ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{lbl}</button>)}
                    <span className="ml-1 text-[var(--muted)]">From</span><input type="date" value={hfFrom} onChange={(e) => { setHfFrom(e.target.value); setHfPreset("ALL"); }} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]" />
                    <span className="text-[var(--muted)]">To</span><input type="date" value={hfTo} onChange={(e) => { setHfTo(e.target.value); setHfPreset("ALL"); }} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]" />
                    <span className="text-[var(--muted)]">Type</span><select value={hfType} onChange={(e) => setHfType(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select>{Object.keys(histSel).filter((k) => histSel[k]).length > 0 && <button onClick={delHistBulk} className="ml-auto rounded px-2 py-0.5" style={{ background: SELL, color: "#1a0606" }}>Delete Selected ({Object.keys(histSel).filter((k) => histSel[k]).length})</button>}
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-[var(--border)]">
                        <th className={thc}><input type="checkbox" checked={hAllOn} onChange={hToggleAll} /></th>
                        <th className={thc}>Date/Time</th><th className={thc}>Order/Ref</th><th className={thc}>Type</th><th className={thc}>Symbol</th><th className={thc}>Desc</th>
                        <th className={thc + " text-right"}>Open Px</th><th className={thc + " text-right"}>Close Px</th><th className={thc + " text-right"}>S/L</th><th className={thc + " text-right"}>T/P</th>
                        <th className={thc}>Close Time</th><th className={thc + " text-right"}>P&amp;L</th><th className={thc + " text-right"}>Edit</th>
                      </tr></thead>
                      <tbody>
                        {rows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={13}>No history.</td></tr> : rows.map((h) => (
                          <tr key={h.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                            <td className="px-2 py-1"><input type="checkbox" checked={!!histSel[h.id]} onChange={() => setHistSel((s) => ({ ...s, [h.id]: !s[h.id] }))} /></td>
                            <td className="px-2 py-1 text-[var(--muted)]">{(h.openTime || h.createdAt) ? new Date(h.openTime || h.createdAt).toLocaleString() : "-"}</td>
                            <td className="px-2 py-1">{h.ticket ?? h.orderId ?? h.id}</td>
                            <td className="px-2 py-1" style={{ color: hType(h) === "BUY" ? BUY : SELL }}>{h.side || h.type || "-"}</td>
                            <td className="px-2 py-1">{h.symbol}</td>
                            <td className="px-2 py-1 text-[var(--muted)]">{h.description || h.desc || h.closeReason || "-"}</td>
                            <td className="px-2 py-1 text-right">{h.openPrice != null && Number(h.openPrice) !== 0 ? pxFmt(h.symbol, h.openPrice) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.closePrice != null && Number(h.closePrice) !== 0 ? pxFmt(h.symbol, h.closePrice) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.sl ? Number(h.sl).toFixed(dg(h.symbol)) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.tp ? Number(h.tp).toFixed(dg(h.symbol)) : "-"}</td>
                            <td className="px-2 py-1 text-[var(--muted)]">{hdt(h) ? new Date(hdt(h)).toLocaleString() : "-"}</td>
                            <td className="px-2 py-1 text-right" style={{ color: (h.pnl ?? 0) >= 0 ? BUY : SELL }}>{h.pnl != null ? Number(h.pnl).toFixed(2) : "-"}</td>
                            <td className="px-2 py-1 text-right"><button onClick={() => openHEdit(h)} className="mr-1 text-[var(--accent)]">Edit</button><button onClick={() => delHist(h)} style={{ color: SELL }}>Del</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {tab === "summary" && (
              <div className="flex flex-wrap gap-2 p-3 text-[11px]">
                {([["TOTAL DEPOSITS", fmt(Number(selAcc?.deposit || 0)), BUY], ["TOTAL WITHDRAWALS", "-" + fmt(Number(selAcc?.withdrawal || 0)), SELL], ["NET DEPOSITS", fmt(Number(selAcc?.deposit || 0) - Number(selAcc?.withdrawal || 0)), "var(--text)"], ["CREDIT/BONUS", fmt(Number(selAcc?.credit || 0) + Number(selAcc?.bonus || 0)), BUY], ["CLOSED TRADE P/L", fmt(Number(selAcc?.pnl || 0)), Number(selAcc?.pnl || 0) >= 0 ? BUY : SELL], ["CURRENT BALANCE", fmt(balance), "var(--text)"], ["MC LEVEL", Number(selAcc?.mcLevel || 0) > 0 ? selAcc?.mcLevel + "%" : "Off", GOLD], ["NET BALANCE", fmt(equity), "var(--accent)"]] as [string, string, string][]).map(([k, v, c]) => (
                  <div key={k as string} className="min-w-[120px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--soft)] px-3 py-2"><div className="text-[10px] text-[var(--muted)]">{k}</div><div className="mt-1 text-base font-semibold" style={{ color: c }}>{v}</div></div>
                ))}
              </div>
            )}
            {tab === "clients" && (() => {
              const balOf = (c: any) => Number(c.deposit) - Number(c.withdrawal) + Number(c.credit) + Number(c.bonus) + Number(c.pnl);
              const cliRows = clients.filter((c: any) => {
                if (cliType !== "ALL" && c.type !== cliType) return false;
                if (cliStatus === "ACTIVE" && (c.locked || c.deactivated)) return false;
                if (cliStatus === "LOCKED" && !c.locked) return false;
                if (cliStatus === "INACTIVE" && !c.deactivated) return false;
                if (cliQ) { const q = cliQ.toLowerCase(); if (!((c.login || "").toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q) || ((c.user?.email || c.email || "").toLowerCase().includes(q)))) return false; }
                return true;
              });
              const thc = "px-2 py-1 text-left font-normal text-[var(--muted)] whitespace-nowrap";
              return (
                <div className="flex h-full flex-col text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
                    <input value={cliQ} onChange={(e) => setCliQ(e.target.value)} placeholder="Search login / name / email" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text)] min-w-[160px]" />
                    <select value={cliType} onChange={(e) => setCliType(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All Types</option><option value="LIVE">Live</option><option value="DEMO">Demo</option></select>
                    <select value={cliStatus} onChange={(e) => setCliStatus(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="LOCKED">Locked</option><option value="INACTIVE">Inactive</option></select>
                    <span className="text-[var(--muted)]">{cliRows.length} clients</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-[var(--border)] sticky top-0 bg-[var(--panel)] z-10">
                        <th className={thc}>Login</th><th className={thc}>Name</th><th className={thc}>Email</th>
                        <th className={thc}>Phone</th><th className={thc}>Country</th><th className={thc}>Manager</th>
                        <th className={thc}>Type</th><th className={thc}>Balance</th><th className={thc}>Online</th>
                        <th className={thc}>Last IP</th><th className={thc}>Status</th><th className={thc + " text-right"}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {cliRows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={12}>No clients.</td></tr> : cliRows.map((c: any) => {
                          const email = c.user?.email || c.email || "-";
                          const lastIp = c.user?.lastLoginIp || "-";
                          const bal = balOf(c);
                          const statusLabel = c.deactivated ? "Inactive" : c.locked ? "Locked" : "Active";
                          const statusCol = c.deactivated ? GOLD : c.locked ? SELL : BUY;
                          return (
                            <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]" onContextMenu={(e) => { e.preventDefault(); setSelAcc(c); setMenu({ x: e.clientX, y: e.clientY, acc: c }); }}>
                              <td className="px-2 py-1 font-medium" style={{ color: GOLD }}>
                                <button onClick={() => setSelAcc(c)} title="Select account">{c.login}</button>
                                {c.isPool && <span className="ml-1 text-[9px] rounded px-0.5" style={{ background: GOLD + "22", color: GOLD }}>POOL</span>}
                              </td>
                              <td className="px-2 py-1">{c.name}</td>
                              <td className="px-2 py-1 text-[var(--muted)]">{email}</td>
                              <td className="px-2 py-1 text-[var(--muted)]">{c.phone || "-"}</td>
                              <td className="px-2 py-1 text-[var(--muted)]">{c.country || "-"}</td>
                              <td className="px-2 py-1 text-[var(--muted)]">{c.manager?.name || "-"}</td>
                              <td className="px-2 py-1">{c.type}</td>
                              <td className="px-2 py-1 text-right" style={{ color: bal >= 0 ? BUY : SELL }}>{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1 text-center"><span className={"inline-block h-1.5 w-1.5 rounded-full " + (c.isOnline ? "bg-green-400" : "bg-gray-600")} /></td>
                              <td className="px-2 py-1 text-[var(--muted)]">{lastIp}</td>
                              <td className="px-2 py-1" style={{ color: statusCol }}>{statusLabel}</td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                <button title="Edit" onClick={() => openAct("rename", c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "var(--accent)" }}><i className="fa-solid fa-pen-to-square" /></button>
                                <button title={c.locked ? "Unlock" : "Lock"} onClick={() => doStatus(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: c.locked ? BUY : SELL }}><i className={"fa-solid " + (c.locked ? "fa-lock-open" : "fa-lock")} /></button>
                                <button title={c.deactivated ? "Activate" : "Deactivate"} onClick={() => doDeactivateManage(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: GOLD }}><i className={"fa-solid " + (c.deactivated ? "fa-circle-check" : "fa-ban")} /></button>
                                <button title={c.isPool ? "Demote from Pool" : "Promote to Pool"} onClick={() => doPool(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "#a78bfa" }}><i className={"fa-solid " + (c.isPool ? "fa-circle-minus" : "fa-circle-plus")} /></button>
                                <button title="Change ID" onClick={() => openAct("accountid", c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "var(--muted)" }}><i className="fa-solid fa-id-card" /></button>
                                <button title="Upload KYC" onClick={() => { setKycUploadFor(c); setKycUploadType("PASSPORT"); setKycUploadFile(null); setKycUpMsg(""); }} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "#38bdf8" }}><i className="fa-solid fa-id-card-clip" /></button>
                                {can("deleteClients") && <button title="Delete" onClick={() => delClient(c)} className="rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {tab === "audit" && <div className="px-2 py-2 text-[10px] text-[var(--muted)]">{audit.length ? audit.slice(0, 60).map((l) => <div key={l.id} className="border-b border-[var(--border)] py-1">{l.performedBy} - {l.action} <span className="text-[var(--text)]">{l.detail}</span></div>) : "No activity."}</div>}
            {tab === "payments" && <PaymentsPanel />}
            {tab === "kyc" && <KycPanel />}
          </div>
        </div>
      </>)}

      {menu && (<>
        <div className="fixed inset-0 z-40" onClick={() => { setMenu(null); setMenuSub(""); }} />
        <div className="fixed z-50 w-60 overflow-visible rounded-lg border py-1 text-[11px]" style={{ left: menu.x, top: menu.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
          <div className="mx-1 mb-1 flex items-center gap-2 rounded-md px-2 py-2" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--accent)", color: "#fff" }}>{(menu.acc.name || "?").charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold" style={{ color: GOLD }}>{menu.acc.login}</div>
              <div className="truncate text-[9px] text-[var(--muted)]">{menu.acc.name}</div>
            </div>
          </div>
          {(can("processDeposits") || can("processWithdrawals") || can("creditBonus") || can("editFinancial") || can("transferFunds")) && <button onClick={() => setMenuSub(menuSub === "money" ? "" : "money")} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)]">{mIco("fa-coins", GOLD)}<span className="flex-1">Money</span><i className={"fa-solid text-[8px] text-[var(--muted)] " + (menuSub === "money" ? "fa-chevron-down" : "fa-chevron-right")} /></button>}
          {menuSub === "money" && (<div className="absolute left-full top-0 z-50 w-52 overflow-hidden rounded-lg border py-1" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
            {can("processDeposits") && <button onClick={() => openAct("money", menu.acc, "DEPOSIT", "Deposit")} className={subi} style={{ color: BUY }}>{mIco("fa-arrow-down-to-bracket", BUY)}Deposit</button>}
            {can("processWithdrawals") && <button onClick={() => openAct("money", menu.acc, "WITHDRAWAL", "Withdrawal")} className={subi} style={{ color: GOLD }}>{mIco("fa-arrow-up-from-bracket", GOLD)}Withdrawal</button>}
            {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "CREDIT_IN", "Credit In")} className={subi} style={{ color: BUY }}>{mIco("fa-plus", BUY)}Credit In</button>}
            {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "CREDIT_OUT", "Credit Out")} className={subi} style={{ color: GOLD }}>{mIco("fa-minus", GOLD)}Credit Out</button>}
            {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "BONUS", "Bonus")} className={subi} style={{ color: BUY }}>{mIco("fa-gift", BUY)}Bonus</button>}
            {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "INSURANCE", "Insurance")} className={subi}>{mIco("fa-shield-halved")}Insurance</button>}
            {can("editFinancial") && <button onClick={() => openAct("manualpnl", menu.acc)} className={subi}>{mIco("fa-chart-line")}Manual P/L</button>}
            {can("transferFunds") && <button onClick={() => openAct("transfer", menu.acc)} className={subi}>{mIco("fa-right-left")}Transfer Between Accounts</button>}
          </div>)}
          {can("manualTrade") && <button onClick={() => openMT(menu.acc)} className={mi}>{mIco("fa-bolt", "var(--accent)")}Manual Trade</button>}
          <button onClick={() => openAct("subaccount", menu.acc)} className={mi}>{mIco("fa-sitemap")}Create Sub-Account</button>
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => setMenuSub(menuSub === "edit" ? "" : "edit")} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)]">{mIco("fa-pen-to-square")}<span className="flex-1">Edit Client</span><i className={"fa-solid text-[8px] text-[var(--muted)] " + (menuSub === "edit" ? "fa-chevron-down" : "fa-chevron-right")} /></button>
          {menuSub === "edit" && (<div className="absolute left-full top-0 z-50 w-52 overflow-hidden rounded-lg border py-1" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
            <button onClick={() => openAct("rename", menu.acc)} className={subi}>{mIco("fa-user-pen")}Edit Details</button>
            <button onClick={() => openAct("accountid", menu.acc)} className={subi}>{mIco("fa-id-card")}Change Account ID</button>
            <button onClick={() => openAct("password", menu.acc)} className={subi}>{mIco("fa-key")}Change Password</button>
            <button onClick={() => openAct("assign", menu.acc)} className={subi}>{mIco("fa-user-tie")}Assign Manager &amp; Group</button>
            <button onClick={() => doClearPin(menu.acc)} className={subi}>{mIco("fa-unlock-keyhole")}Reset PIN</button>
          </div>)}
          {menu.acc.kycStatus ? (
            <button onClick={() => { setTab("kyc"); setTabState((s) => ({ ...s, kyc: true })); setMenu(null); }} className={mi}>
              {mIco("fa-id-card-clip", menu.acc.kycStatus === "APPROVED" ? BUY : menu.acc.kycStatus === "PENDING" ? GOLD : SELL)}
              View KYC
              <span className="ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold" style={{ background: (menu.acc.kycStatus === "APPROVED" ? BUY : menu.acc.kycStatus === "PENDING" ? GOLD : SELL) + "22", color: menu.acc.kycStatus === "APPROVED" ? BUY : menu.acc.kycStatus === "PENDING" ? GOLD : SELL }}>
                {menu.acc.kycStatus === "APPROVED" ? "✓ Verified" : menu.acc.kycStatus === "PENDING" ? "Pending" : "Rejected"}
              </span>
            </button>
          ) : (
            <button onClick={() => { setKycUploadFor(menu.acc); setKycUploadType("PASSPORT"); setKycUploadFile(null); setKycUpMsg(""); setMenu(null); }} className={mi}>{mIco("fa-cloud-arrow-up", "#38bdf8")}Upload KYC</button>
          )}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => setMenuSub(menuSub === "settings" ? "" : "settings")} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)]">{mIco("fa-gear")}<span className="flex-1">Settings</span><i className={"fa-solid text-[8px] text-[var(--muted)] " + (menuSub === "settings" ? "fa-chevron-down" : "fa-chevron-right")} /></button>
          {menuSub === "settings" && (<div className="absolute left-full top-0 z-50 w-52 overflow-hidden rounded-lg border py-1" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
            <button onClick={() => openAct("leverage", menu.acc)} className={subi}>{mIco("fa-gauge-high")}Change Leverage</button>
            <button onClick={() => openAct("mclevel", menu.acc)} className={subi}>{mIco("fa-triangle-exclamation")}Set Margin Call Level</button>
            <button onClick={() => openSymOv(menu.acc)} className={subi}>{mIco("fa-ban")}Disable Symbols</button>
            <button onClick={() => doPool(menu.acc)} className={subi}>{mIco(menu.acc.isPool ? "fa-circle-minus" : "fa-circle-plus", "#a78bfa")}{menu.acc.isPool ? "Demote from Pool" : "Promote to Pool"}</button>
          </div>)}
          <button onClick={() => setMenuSub(menuSub === "status" ? "" : "status")} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)]">{mIco("fa-toggle-on")}<span className="flex-1">Status</span><i className={"fa-solid text-[8px] text-[var(--muted)] " + (menuSub === "status" ? "fa-chevron-down" : "fa-chevron-right")} /></button>
          {menuSub === "status" && (<div className="absolute left-full top-0 z-50 w-52 overflow-hidden rounded-lg border py-1" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
            <button onClick={() => doStatus(menu.acc)} className={subi}>{mIco(menu.acc.locked ? "fa-lock-open" : "fa-lock", menu.acc.locked ? BUY : SELL)}{menu.acc.locked ? "Unlock Client" : "Lock Client"}</button>
            <button onClick={() => doDeactivate(menu.acc)} className={subi}>{mIco(menu.acc.deactivated ? "fa-circle-check" : "fa-ban", GOLD)}{menu.acc.deactivated ? "Activate Client" : "Deactivate Client"}</button>
            <button onClick={() => doDNL(menu.acc)} className={subi}>{mIco("fa-hand", menu.acc.doNotLiquidate ? GOLD : undefined)}{menu.acc.doNotLiquidate ? "Disable DNL" : "Enable DNL"}</button>
          </div>)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {can("deleteClients") && <button onClick={() => delClient(menu.acc)} className={mi} style={{ color: SELL }}>{mIco("fa-trash", SELL)}Delete Client</button>}
        </div>
      </>)}

      {ticket && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setTicket(null)}>
          <div className="w-[300px] rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">Order - {ticket}</div>
            <div className={lab}>Type</div>
            <select className={inp} value={tform.type} onChange={(e) => setTform({ ...tform, type: e.target.value })}><option>Market</option><option>Buy Limit</option><option>Sell Limit</option><option>Buy Stop</option><option>Sell Stop</option></select>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div><div className={lab}>Volume</div><input type="number" step="0.01" className={inp} value={tform.vol} onChange={(e) => setTform({ ...tform, vol: Number(e.target.value) })} /></div>
              <div><div className={lab}>S/L</div><input type="number" className={inp} value={tform.sl} onChange={(e) => setTform({ ...tform, sl: Number(e.target.value) })} /></div>
              <div><div className={lab}>T/P</div><input type="number" className={inp} value={tform.tp} onChange={(e) => setTform({ ...tform, tp: Number(e.target.value) })} /></div>
            </div>
            {tform.type !== "Market" && (<div className="mt-2"><div className={lab}>Trigger price</div><input type="number" className={inp} value={tform.price} onChange={(e) => setTform({ ...tform, price: Number(e.target.value) })} /></div>)}
            <div className="mt-2 text-center text-[10px] text-[var(--muted)]">{prices[ticket] != null ? prices[ticket].toFixed(dg(ticket)) : "..."}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => placeTicket("SELL")} className="flex-1 rounded py-2 text-xs" style={{ background: "rgba(224,82,96,0.16)", color: SELL, border: "0.5px solid rgba(224,82,96,0.4)" }}>Sell {prices[ticket] != null ? (prices[ticket] * 0.9999).toFixed(dg(ticket)) : ""}</button>
              <button onClick={() => placeTicket("BUY")} className="flex-1 rounded py-2 text-xs" style={{ background: "rgba(47,129,247,0.18)", color: "#6ab0ff", border: "0.5px solid rgba(47,129,247,0.4)" }}>Buy {prices[ticket] != null ? (prices[ticket] * 1.0001).toFixed(dg(ticket)) : ""}</button>
            </div>
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <button onClick={() => setTicket(null)} className="mt-2 w-full rounded border border-[var(--border)] py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}

      {posMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setPosMenu(null)} />
        <div className="fixed z-50 w-44 overflow-hidden rounded-md border text-[11px]" style={{ left: posMenu.x, top: posMenu.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="border-b px-3 py-1.5 text-[10px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>{posMenu.t.symbol} {posMenu.t.type} {posMenu.t.lots}</div>
          <button onClick={() => openPos("modify", posMenu.t)} className={mi}>Modify S/L - T/P</button>
          <button onClick={() => openPos("partial", posMenu.t)} className={mi}>Partial Close</button>
          <button onClick={() => { const id = posMenu.t.id; setPosMenu(null); close(id); }} className={mi} style={{ color: SELL }}>Close</button>
        </div>
      </>)}
      {pos && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setPos(null)}>
          <div className="w-[300px] rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">{pos.kind === "modify" ? "Modify S/L - T/P" : "Partial Close"}</div>
            <div className="mb-2 text-[10px] text-[var(--muted)]">{pos.t.symbol} {pos.t.type} {pos.t.lots} @ {pos.t.openPrice}</div>
            {pos.kind === "modify" ? (<>
              <div className={lab}>Stop Loss</div><input type="number" className={inp} value={pform.sl} onChange={(e) => setPform({ ...pform, sl: e.target.value })} autoFocus />
              <div className={lab + " mt-2"}>Take Profit</div><input type="number" className={inp} value={pform.tp} onChange={(e) => setPform({ ...pform, tp: e.target.value })} />
            </>) : (<>
              <div className={lab}>Lots to close (max {pos.t.lots})</div><input type="number" step="0.01" className={inp} value={pform.lots} onChange={(e) => setPform({ ...pform, lots: e.target.value })} autoFocus />
              <div className="mt-1 text-[10px] text-[var(--muted)]">At price {prices[pos.t.symbol] != null ? prices[pos.t.symbol].toFixed(dg(pos.t.symbol)) : pos.t.openPrice}</div>
            </>)}
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <button onClick={submitPos} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Confirm</button>
            <button onClick={() => setPos(null)} className="mt-2 w-full rounded border border-[var(--border)] py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {act && (() => {
        const pr = actPrimary();
        const linked = clients.filter((c: any) => act.acc.user?.email && c.user?.email === act.acc.user?.email);
        const LEVS = [50, 100, 200, 300, 500, 1000];
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setAct(null)}>
          <div className="w-[470px] max-w-[95vw] max-h-[90vh] overflow-auto rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent2)" }}><i className={"fa-solid " + actIcon()} /></span>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{actTitle()}</div><div className="truncate text-[11px] text-[var(--muted)]">{act.acc.login} - {act.acc.name}</div></div>
              <button onClick={() => setAct(null)} className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="space-y-3 px-4 py-3 text-xs">
            {act.kind === "money" && (<>
              <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: "var(--border)" }}>
                {[["rt", "fa-bolt", "Real-Time (Instant)"], ["manual", "fa-calendar-days", "Manual Date & Time"]].map(([v, ic, l]) => (
                  <button key={v} onClick={() => af("dateMode", v)} className="flex-1 rounded-md py-1.5 text-[11px] font-medium" style={(aform.dateMode || "rt") === v ? { background: "#2563eb", color: "#fff" } : { color: "var(--muted)" }}><i className={"fa-solid " + ic + " mr-1"} />{l}</button>
                ))}
              </div>
              {aform.dateMode === "manual" && (<div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Custom Date & Time</div><input type="datetime-local" className={inp} value={aform.appliedAt || ""} onChange={(e) => af("appliedAt", e.target.value)} /></div>
                <div><div className={flab}>Reference / Note</div><input className={inp} value={aform.ref || ""} onChange={(e) => af("ref", e.target.value)} placeholder="Custom reference" /></div>
              </div>)}
              <div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Amount</div><input type="number" step="0.01" className={inp} value={aform.amount || ""} onChange={(e) => af("amount", e.target.value)} placeholder="0.00" autoFocus /></div>
                <div><div className={flab}>Description</div><input className={inp} value={aform.desc ?? (act.label || "")} onChange={(e) => af("desc", e.target.value)} /></div>
              </div>
            </>)}
            {act.kind === "manualpnl" && (<>
              <div><div className={flab}>Amount (use - for a loss)</div><input type="number" className={inp} value={aform.amount || ""} onChange={(e) => af("amount", e.target.value)} autoFocus /></div>
              <div><div className={flab}>Note</div><input className={inp} value={aform.note || ""} onChange={(e) => af("note", e.target.value)} /></div>
            </>)}
            {act.kind === "transfer" && (<>
              <div><div className={flab}>From Account</div><select className={inp} value={aform.fromId || act.acc.id} onChange={(e) => af("fromId", e.target.value)}>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.login} — {c.name} (${acctBal(c).toFixed(2)})</option>)}</select></div>
              <div><div className={flab}>To Account</div><select className={inp} value={aform.toId || ""} onChange={(e) => af("toId", e.target.value)}><option value="">- select -</option>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.login} — {c.name} (${acctBal(c).toFixed(2)})</option>)}</select></div>
              <div><div className={flab}>Amount (USD)</div><input type="number" step="0.01" className={inp} value={aform.amount || ""} onChange={(e) => af("amount", e.target.value)} placeholder="0.00" /></div>
              <div><div className={flab}>Note (optional)</div><input className={inp} value={aform.note || ""} onChange={(e) => af("note", e.target.value)} placeholder="e.g. balance adjustment" /></div>
              <div className="rounded-lg p-2 text-[10px] leading-snug" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--muted)" }}><i className="fa-solid fa-circle-info mr-1" />Transfer logs to financial history (one row each side) and the audit log. Closed balance only — floating P/L stays at risk on the source.</div>
            </>)}
            {act.kind === "rename" && (<>
              <div className="text-[10px] text-[var(--muted)]">Selected: {act.acc.login} · {linked.length} linked account{linked.length === 1 ? "" : "s"}</div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Full Name</div><input className={inp} value={aform.name ?? act.acc.name} onChange={(e) => af("name", e.target.value)} /></div>
                <div><div className={flab}>Email</div><input className={inp} value={aform.email ?? (act.acc.email || act.acc.user?.email || "")} onChange={(e) => af("email", e.target.value)} /></div>
                <div><div className={flab}>Phone</div><input className={inp} value={aform.phone ?? (act.acc.phone || "")} onChange={(e) => af("phone", e.target.value)} /></div>
                <div><div className={flab}>Country</div><input className={inp} value={aform.country ?? (act.acc.country || "")} onChange={(e) => af("country", e.target.value)} /></div>
                <div><div className={flab}>New Password (blank = keep)</div><input type="password" className={inp} value={aform.password || ""} onChange={(e) => af("password", e.target.value)} placeholder="Enter new password" /></div>
                <div><div className={flab}>Account Type</div><input className={inp} value={act.acc.type} disabled /></div>
                <div><div className={flab}>Leverage</div><input className={inp} value={"1:" + act.acc.leverage} disabled /></div>
                <div><div className={flab}>Manager / Group</div><input className={inp} value={(act.acc.manager?.name || "Unassigned") + (act.acc.group?.name ? " / " + act.acc.group.name : "")} disabled /></div>
              </div>
              {linked.length > 0 && (<div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-[var(--muted)]"><span><i className="fa-solid fa-link mr-1" />LINKED ACCOUNTS ({linked.length})</span><span>TOTAL: ${linked.reduce((s: number, c: any) => s + acctBal(c), 0).toFixed(2)}</span></div>
                {linked.map((c: any) => (<div key={c.id} className="flex items-center justify-between border-t px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", background: c.id === act.acc.id ? "var(--soft)" : undefined }}><span style={{ color: "var(--accent2)" }}>#{c.login} <span className="rounded px-1 text-[8px]" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}>{c.type}</span>{c.id === act.acc.id ? " · current" : ""}</span><span className="font-medium">${acctBal(c).toFixed(2)}</span></div>))}
              </div>)}
              <div className="grid grid-cols-3 gap-2 rounded-lg border p-2 text-[10px]" style={{ borderColor: "var(--border)" }}>
                <div><div className="text-[var(--muted)]">Deposit</div><div className="font-semibold" style={{ color: BUY }}>+{Number(act.acc.deposit || 0).toFixed(2)}</div></div>
                <div><div className="text-[var(--muted)]">Withdrawal</div><div className="font-semibold" style={{ color: SELL }}>-{Number(act.acc.withdrawal || 0).toFixed(2)}</div></div>
                <div><div className="text-[var(--muted)]">Closed P/L</div><div className="font-semibold">{Number(act.acc.pnl || 0).toFixed(2)}</div></div>
                <div><div className="text-[var(--muted)]">Credit</div><div className="font-semibold">{Number(act.acc.credit || 0).toFixed(2)}</div></div>
                <div><div className="text-[var(--muted)]">Balance</div><div className="font-semibold">{acctBal(act.acc).toFixed(2)}</div></div>
                <div><div className="text-[var(--muted)]">MC Level</div><div className="font-semibold">{Number(act.acc.mcLevel || 0).toFixed(2)}%</div></div>
              </div>
            </>)}
            {act.kind === "accountid" && (<>
              <div className="text-[11px] text-[var(--muted)]">Current ID: <span className="font-semibold text-[var(--text)]">{act.acc.login}</span> — {act.acc.name}</div>
              <div><div className={flab}>Enter new Account ID</div><input className={inp} value={aform.login ?? act.acc.login} onChange={(e) => af("login", e.target.value)} autoFocus /></div>
            </>)}
            {act.kind === "password" && (<div><div className={flab}>New Password (min 6)</div><input type="password" className={inp} value={aform.password || ""} onChange={(e) => af("password", e.target.value)} autoFocus /></div>)}
            {act.kind === "assignmgr" && (<div><div className={flab}>Manager</div><select className={inp} value={aform.managerId ?? (act.acc.managerId || "")} onChange={(e) => af("managerId", e.target.value)}><option value="">- none -</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>)}
            {act.kind === "subaccount" && (<>
              <div className="text-[11px] text-[var(--muted)]">Under client: <span className="font-semibold text-[var(--text)]">{act.acc.name}</span></div>
              <div><div className={flab}>Sub-account name (optional)</div><input className={inp} value={aform.name || ""} onChange={(e) => af("name", e.target.value)} placeholder={act.acc.name + " sub"} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Account Type</div><select className={inp} value={aform.subType || "LIVE"} onChange={(e) => af("subType", e.target.value)}><option value="LIVE">Live</option><option value="DEMO">Demo</option></select></div>
                <div><div className={flab}>Leverage</div><select className={inp} value={aform.subLev || act.acc.leverage} onChange={(e) => af("subLev", e.target.value)}>{LEVS.map((l) => <option key={l} value={l}>1:{l}</option>)}</select></div>
                <div><div className={flab}>Currency</div><select className={inp} value={aform.subCcy || act.acc.currency} onChange={(e) => af("subCcy", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
                <div><div className={flab}>Initial Deposit (USD)</div><input type="number" className={inp} value={aform.subDep || ""} onChange={(e) => af("subDep", e.target.value)} placeholder="0.00 (0 for Live)" /></div>
              </div>
            </>)}
            {act.kind === "assigngroup" && (<div><div className={flab}>Group</div><select className={inp} value={aform.groupId ?? (act.acc.groupId || "")} onChange={(e) => af("groupId", e.target.value)}><option value="">- none -</option>{tradeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>)}
            {act.kind === "assign" && (() => {
              const selMgr = (aform.managerId ?? (act.acc.managerId || "")) as string;
              const selGrp = (aform.groupId ?? (act.acc.groupId || "")) as string;
              const avail = tradeGroups.filter((g) => (g.managerId || "") === selMgr);
              return (<>
                <div><div className={flab}>Manager</div><select className={inp} value={selMgr} onChange={(e) => setAform((o: any) => ({ ...o, managerId: e.target.value, groupId: "" }))}><option value="">Admin (no manager)</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
                <div><div className={flab}>Group {selMgr ? "(under this manager)" : "(admin-level)"}</div><select className={inp} value={selGrp} onChange={(e) => af("groupId", e.target.value)}><option value="">- no group -</option>{avail.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                <div className="text-[10px] leading-tight text-[var(--muted)]">{selMgr ? "Client sits under this manager" : "Client sits directly under admin"}{selGrp ? "" : ", with no group"}. Only groups owned by the chosen manager are listed.{avail.length === 0 && selMgr ? " This manager has no groups yet — create one from the Groups menu." : ""}</div>
              </>);
            })()}
            {act.kind === "leverage" && (<div><div className={flab}>Leverage</div><select className={inp} value={aform.leverage ?? act.acc.leverage} onChange={(e) => af("leverage", e.target.value)}>{(LEVS.includes(Number(act.acc.leverage)) ? LEVS : [Number(act.acc.leverage), ...LEVS]).map((l) => <option key={l} value={l}>1:{l}</option>)}</select></div>)}
            {act.kind === "mclevel" && (<>
              <div><div className={flab}>MC Level % (0 = OFF)</div><input type="number" className={inp} value={aform.mcLevel ?? act.acc.mcLevel} onChange={(e) => af("mcLevel", e.target.value)} autoFocus /></div>
              <label className="flex items-center gap-2 text-[11px]"><span className="text-[var(--muted)]">Do Not Liquidate:</span><input type="checkbox" checked={!!(aform.doNotLiquidate ?? act.acc.doNotLiquidate)} onChange={(e) => af("doNotLiquidate", e.target.checked)} /> Enable (account will NOT be liquidated)</label>
            </>)}
            {act.kind === "settings" && (<>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Leverage</div><input type="number" className={inp} value={aform.leverage ?? act.acc.leverage} onChange={(e) => af("leverage", e.target.value)} /></div>
                <div><div className={flab}>MC Level %</div><input type="number" className={inp} value={aform.mcLevel ?? act.acc.mcLevel} onChange={(e) => af("mcLevel", e.target.value)} /></div>
              </div>
              <div><div className={flab}>Currency</div><select className={inp} value={aform.currency ?? act.acc.currency} onChange={(e) => af("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={!!(aform.doNotLiquidate ?? act.acc.doNotLiquidate)} onChange={(e) => af("doNotLiquidate", e.target.checked)} /> Do not liquidate (disable stop-out)</label>
            </>)}
            {err && <div className="text-[11px]" style={{ color: SELL }}>{err}</div>}
            </div>
            <div className="flex gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setAct(null)} className="flex-1 rounded-lg border py-2 text-xs font-medium" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button onClick={submitAct} className="flex-1 rounded-lg py-2 text-xs font-semibold" style={{ background: pr.color, color: pr.fg }}>{pr.label}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setModal("")}>
          <div className="w-[330px] rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">{modal === "client" && "New Client"}{modal === "manager" && "New Manager"}{modal === "group" && "Manage Groups"}{modal === "notify" && "Send Notification"}</div>
            {modal === "client" && (<>
              <div className="flex gap-1">
                <button onClick={() => f("type", "LIVE")} className="flex-1 rounded py-1.5 text-xs" style={form.type === "LIVE" ? { background: BUY, color: "#04140e" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Live</button>
                <button onClick={() => f("type", "DEMO")} className="flex-1 rounded py-1.5 text-xs" style={form.type === "DEMO" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Demo</button>
              </div>
              <div className={lab + " mt-2"}>Name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              <div className={lab + " mt-2"}>Email</div><input className={inp} value={form.email || ""} onChange={(e) => f("email", e.target.value)} />
              <div className={lab + " mt-2"}>Password</div><input className={inp} value={form.password || ""} onChange={(e) => f("password", e.target.value)} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><div className={lab}>Leverage</div><input type="number" className={inp} value={form.leverage} onChange={(e) => f("leverage", Number(e.target.value))} /></div>
                <div><div className={lab}>Currency</div><select className={inp} value={form.currency} onChange={(e) => f("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
              </div>
              <div className={lab + " mt-2"}>Manager (optional)</div>
              <select className={inp} value={form.managerId || ""} onChange={(e) => f("managerId", e.target.value || null)}><option value="">- none -</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <div className={lab + " mt-2"}>Phone</div><input className={inp} value={form.phone || ""} onChange={(e) => f("phone", e.target.value)} />
              <div className={lab + " mt-2"}>Country</div><input className={inp} value={form.country || ""} onChange={(e) => f("country", e.target.value)} />
              <label className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}><input type="checkbox" checked={!!form.isPool} onChange={(e) => f("isPool", e.target.checked)} /> Pool account</label>
              <button onClick={() => submit("/api/admin/clients", { name: form.name, email: form.email, password: form.password, type: form.type, leverage: Number(form.leverage) || 100, currency: form.currency, managerId: form.managerId || null, phone: form.phone, country: form.country, isPool: !!form.isPool }, "Client")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Create {form.type} Client</button>
            </>)}
            {modal === "manager" && (<>
              <div className={lab + " mt-1"}>Name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              <div className={lab + " mt-2"}>Email</div><input className={inp} value={form.email || ""} onChange={(e) => f("email", e.target.value)} />
              <div className={lab + " mt-2"}>Password</div><input className={inp} value={form.password || ""} onChange={(e) => f("password", e.target.value)} />
              <button onClick={() => submit("/api/admin/managers", { name: form.name, email: form.email, password: form.password }, "Manager")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Create Manager</button>
            </>)}
            {modal === "group" && (<>
              {tradeGroups.length > 0 && (<div className="mb-2 max-h-40 overflow-auto rounded border border-[var(--border)]">
                {tradeGroups.map((g: any) => { const mgr = managers.find((m) => m.id === g.managerId); return (
                  <div key={g.id} className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1 text-[11px] last:border-0" style={form.editId === g.id ? { background: "var(--soft)" } : undefined}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{g.name}</div>
                      <div className="truncate text-[9px] text-[var(--muted)]">spread {Number(g.spread) || 0} · {mgr ? mgr.name : "Admin-level"}</div>
                    </div>
                    <button title="Edit" onClick={() => editGroup(g)} className="rounded px-1.5 py-0.5" style={{ color: "var(--accent)" }}><i className="fa-solid fa-pen" /></button>
                    <button title="Delete" onClick={() => delGroup(g)} className="rounded px-1.5 py-0.5" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>
                  </div>); })}
              </div>)}
              <div className={lab + " mt-1"}>{form.editId ? "Edit group name" : "New group name"}</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              <div className={lab + " mt-2"}>Spread (points)</div><input type="number" className={inp} value={form.spread || ""} onChange={(e) => f("spread", Number(e.target.value))} />
              <div className={lab + " mt-2"}>Manager (owns this group)</div>
              <select className={inp} value={form.managerId || ""} onChange={(e) => f("managerId", e.target.value || null)}><option value="">Admin-level (no manager)</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <div className="mt-3 flex gap-2">
                <button onClick={saveGroup} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>{form.editId ? "Save Changes" : "Create Group"}</button>
                {form.editId && <button onClick={() => setForm({ type: "LIVE", leverage: 100, currency: "USD" })} className="rounded border border-[var(--border)] px-3 py-2 text-xs">New</button>}
              </div>
            </>)}
            {modal === "notify" && (<>
              <div className={lab + " mt-1"}>Template</div>
              <div className="flex flex-wrap gap-1">{Object.keys(NOTI_TEMPLATES).map((k) => (<button key={k} onClick={() => { const t = NOTI_TEMPLATES[k]; setForm((pp: any) => ({ ...pp, title: t.title, body: t.body, template: k })); }} className="rounded border px-2 py-1 text-[10px]" style={{ borderColor: "var(--border)", color: form.template === k ? "var(--text)" : "var(--muted)", background: form.template === k ? "var(--soft)" : "transparent" }}>{k}</button>))}</div>
              <div className={lab + " mt-2"}>Target</div>
              <select className={inp} value={form.ntarget || "all_clients"} onChange={(e) => f("ntarget", e.target.value)}><option value="all_clients">All clients</option><option value="managers">All managers</option><option value="client">Specific client</option></select>
              {form.ntarget === "client" && (<><div className={lab + " mt-2"}>Client</div><select className={inp} value={form.naccountId || ""} onChange={(e) => f("naccountId", e.target.value)}><option value="">- select -</option>{clients.map((cl: any) => <option key={cl.id} value={cl.id}>{cl.login} - {cl.name}</option>)}</select></>)}
              <div className={lab + " mt-2"}>Title</div><input className={inp} value={form.title || ""} onChange={(e) => f("title", e.target.value)} />
              <div className={lab + " mt-2"}>Message</div><textarea className={inp} rows={3} value={form.body || ""} onChange={(e) => f("body", e.target.value)} />
              <div className={lab + " mt-2"}>Image URL (optional)</div><input className={inp} value={form.image || ""} onChange={(e) => f("image", e.target.value)} placeholder="https://..." />
              <button onClick={() => submit("/api/admin/notify", { title: form.title, body: form.body, image: form.image, target: form.ntarget || "all_clients", accountId: form.naccountId }, "Notification")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Send notification</button>
              {nrecent.length > 0 && (<div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}><div className="text-[10px] text-[var(--muted)]">Recently sent</div>{nrecent.map((n: any, i: number) => (<div key={i} className="mt-1 text-[10px]"><span className="text-[var(--text)]">{n.title}</span> <span className="text-[var(--muted)]"> · {new Date(n.createdAt).toLocaleString()}</span></div>))}</div>)}
            </>)}
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <button onClick={() => setModal("")} className="mt-2 w-full rounded border border-[var(--border)] py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {symOv && (() => {
        const setDis = async (syms: string[], dis: boolean) => {
          setSymOv((o: any) => { const d = { ...o.disabled }; syms.forEach((s) => (d[s] = dis)); return { ...o, disabled: d }; });
          await Promise.all(syms.map((s) => fetch("/api/admin/clients/" + symOv.acc.id + "/symbols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: s, disabled: dis }) })));
        };
        const q = (symOv.q || "").toLowerCase();
        const grouped: Record<string, any[]> = {};
        symbols.filter((s) => !q || (s.symbol + " " + (s.display || "")).toLowerCase().includes(q)).forEach((s) => { const c = s.category || "other"; (grouped[c] || (grouped[c] = [])).push(s); });
        const cats = Object.entries(grouped).sort((a, b) => (CAT_ORDER.indexOf(a[0]) === -1 ? 99 : CAT_ORDER.indexOf(a[0])) - (CAT_ORDER.indexOf(b[0]) === -1 ? 99 : CAT_ORDER.indexOf(b[0])));
        const catName = (c: string) => c === "metals" ? "PREC. METALS" : c.toUpperCase();
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setSymOv(null)}>
          <div className="flex max-h-[88vh] w-[580px] max-w-[95vw] flex-col rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", color: "#e05260" }}><i className="fa-solid fa-ban" /></span>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">Disable Symbols For Client</div><div className="truncate text-[11px] text-[var(--muted)]">{symOv.acc.name} • ID: {symOv.acc.login}</div></div>
              <button onClick={() => setSymOv(null)} className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
              <input value={symOv.q || ""} onChange={(e) => setSymOv((o: any) => ({ ...o, q: e.target.value }))} placeholder="Search symbols…" className={inp + " mt-0"} />
              <div className="mt-1 text-[10px] text-[var(--muted)]">Turning a symbol <span style={{ color: "#e05260" }}>off</span> here hides it from <b>this client only</b>. Other clients are unaffected.</div>
            </div>
            <div className="flex-1 overflow-auto px-4 py-2">
              {cats.map(([cat, list]) => {
                const enabledCount = list.filter((s) => !symOv.disabled[s.symbol]).length;
                const allOn = enabledCount === list.length;
                return (<div key={cat} className="mb-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-[var(--muted)]">{catName(cat)}</span>
                    <span className="rounded px-1.5 text-[9px]" style={{ background: "var(--soft)", color: "var(--muted)" }}>{enabledCount}/{list.length}</span>
                    <button onClick={() => setDis(list.map((s) => s.symbol), allOn)} className="ml-auto rounded px-2 py-0.5 text-[10px]" style={{ background: "color-mix(in srgb, var(--red) 14%, transparent)", color: "#e05260" }}>{allOn ? "Disable All" : "Enable All"}</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {list.map((s) => { const on = !symOv.disabled[s.symbol]; return (
                      <button key={s.symbol} onClick={() => setDis([s.symbol], on)} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: on ? "var(--border)" : "color-mix(in srgb, var(--red) 40%, var(--border))", background: "var(--bg)", opacity: on ? 1 : 0.7 }}>
                        <span className="truncate">{s.display || s.symbol}</span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: on ? "#16c784" : "#e05260" }} />
                      </button>); })}
                  </div>
                </div>);
              })}
              {cats.length === 0 && <div className="py-6 text-center text-[var(--muted)]">No symbols match.</div>}
            </div>
            <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setSymOv(null)} className="w-full rounded-lg py-2 text-xs font-semibold" style={{ background: "#2563eb", color: "#fff" }}>Done</button>
            </div>
          </div>
        </div>
        );
      })()}
      {mt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setMt(null)}>
          <div className="w-[420px] rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">Manual Trade - <span style={{ color: "var(--accent)" }}>{mt.acc.login} - {mt.acc.name}</span></div>
            <div className={lab}>Symbol</div>
            <select className={inp} value={mt.symbol} onChange={(e) => setMt({ ...mt, symbol: e.target.value, openPrice: mt.follow ? (prices[e.target.value] ?? 0) : mt.openPrice })}>{symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</select>
            <div className="mt-2"><div className={lab}>Order Kind</div>
              <select className={inp} value={mt.kind || "MARKET"} onChange={(e) => setMt({ ...mt, kind: e.target.value, follow: e.target.value === "MARKET" })}>
                <option value="MARKET">Market (open now)</option>
                <option value="LIMIT">Limit (Buy below / Sell above market)</option>
                <option value="STOP">Stop (Buy above / Sell below market)</option>
              </select>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(!mt.kind || mt.kind === "MARKET") && <div><div className={lab}>Date & Time</div><input type="datetime-local" className={inp} value={mt.date} onChange={(e) => setMt({ ...mt, date: e.target.value })} /></div>}
              <div><div className={lab}>Type</div><select className={inp} value={mt.type} onChange={(e) => setMt({ ...mt, type: e.target.value })}><option>BUY</option><option>SELL</option></select></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><div className={lab}>Lot Size</div><input type="number" step="0.01" className={inp} value={mt.lots} onChange={(e) => setMt({ ...mt, lots: e.target.value })} /></div>
              <div><div className="flex items-center justify-between"><span className={lab}>{mt.kind && mt.kind !== "MARKET" ? "Trigger Price" : "Open Price"}</span>{mt.follow ? <span className="text-[9px]" style={{ color: GOLD }}>● Following live</span> : <button onClick={() => setMt({ ...mt, follow: true, openPrice: prices[mt.symbol] ?? mt.openPrice })} className="text-[9px] underline" style={{ color: "var(--accent)" }}>Follow live</button>}</div><input type="number" className={inp} value={mt.follow ? (prices[mt.symbol] != null ? prices[mt.symbol].toFixed(dg(mt.symbol)) : mt.openPrice) : mt.openPrice} onChange={(e) => setMt({ ...mt, openPrice: e.target.value, follow: false })} /></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><div className={lab}>Stop Loss (0=OFF)</div><input type="number" className={inp} value={mt.sl} onChange={(e) => setMt({ ...mt, sl: e.target.value })} /></div>
              <div><div className={lab}>Take Profit (0=OFF)</div><input type="number" className={inp} value={mt.tp} onChange={(e) => setMt({ ...mt, tp: e.target.value })} /></div>
            </div>
            <div className="mt-2 rounded bg-[var(--soft)] px-2 py-1.5 text-[10px] text-[var(--muted)]">Live: {prices[mt.symbol] != null ? prices[mt.symbol].toFixed(dg(mt.symbol)) : "..."} | PnL Preview: <span style={{ color: BUY }}>0.00</span></div>
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMt(null)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button>
              <button onClick={placeMT} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>{mt.kind && mt.kind !== "MARKET" ? "Place Pending Order" : "Place Trade"}</button>
            </div>
          </div>
        </div>
      )}
      {hEdit && (() => { const isFin = String(hEdit.id).startsWith("F"); return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setHEdit(null)}>
          <div className="w-[360px] rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">Edit {isFin ? "Transaction" : "Trade"} {hEdit.ticket}</div>
            {isFin ? (<>
              <div className={lab}>Amount</div><input type="number" className={inp} value={hEdit.amt} onChange={(e) => setHEdit({ ...hEdit, amt: e.target.value })} />
              <div className={lab}>Description</div><input className={inp} value={hEdit.desc || ""} onChange={(e) => setHEdit({ ...hEdit, desc: e.target.value })} />
            </>) : (<>
              <div className={lab}>Close Price</div><input type="number" className={inp} value={hEdit.closePrice} onChange={(e) => setHEdit({ ...hEdit, closePrice: e.target.value })} />
              <div className={lab}>P&amp;L</div><input type="number" className={inp} value={hEdit.pnl} onChange={(e) => setHEdit({ ...hEdit, pnl: e.target.value })} />
              <div className="grid grid-cols-2 gap-2"><div><div className={lab}>S/L</div><input type="number" className={inp} value={hEdit.sl} onChange={(e) => setHEdit({ ...hEdit, sl: e.target.value })} /></div><div><div className={lab}>T/P</div><input type="number" className={inp} value={hEdit.tp} onChange={(e) => setHEdit({ ...hEdit, tp: e.target.value })} /></div></div>
            </>)}
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <div className="mt-3 flex gap-2"><button onClick={() => setHEdit(null)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button><button onClick={submitHEdit} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Save</button></div>
          </div>
        </div>
      ); })()}
      {confirmBox && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setConfirmBox(null)}>
          <div className="w-[340px] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold" style={{ color: confirmBox.danger ? SELL : "var(--text)" }}>
              <i className={"fa-solid " + (confirmBox.danger ? "fa-triangle-exclamation" : "fa-circle-question")} /> Please confirm
            </div>
            <div className="mb-4 text-[12px] text-[var(--muted)]">{confirmBox.msg}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmBox(null)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">Cancel</button>
              <button onClick={() => { const fn = confirmBox.onYes; setConfirmBox(null); fn(); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: confirmBox.danger ? SELL : "var(--accent)" }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((t) => t.notif ? (
            <div key={t.id} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", minWidth: 230, maxWidth: 300, borderLeft: `3px solid ${t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : t.st === "login" ? "#a78bfa" : BUY}` }}>
              <i className={"fa-solid mt-0.5 " + (t.st === "trade" ? "fa-chart-line" : t.st === "funds" ? "fa-money-bill" : t.st === "login" ? "fa-right-to-bracket" : "fa-bell")} style={{ color: t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : t.st === "login" ? "#a78bfa" : BUY, fontSize: 12 }} />
              <div className="min-w-0"><div className="font-semibold">{t.title}</div>{t.body && <div className="mt-0.5 text-[10px] text-[var(--muted)]">{t.body}</div>}</div>
            </div>
          ) : (
            <div key={t.id} className="rounded-md border px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--panel)", borderColor: t.kind === "err" ? SELL : BUY, color: "var(--text)", minWidth: 180 }}><span style={{ color: t.kind === "err" ? SELL : BUY }}>{t.kind === "err" ? "Error" : "Success"}</span> {t.msg}</div>
          ))}
        </div>
      )}

      {/* Symbol Access Modal */}
      {symPerm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setSymPerm(null)}>
          <div className="flex max-h-[82vh] w-[420px] flex-col rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Symbol Access</div>
            <div className="mb-2 text-[10px]" style={{ color: "var(--muted)" }}>
              {symPerm.scope === "manager"
                ? "Switching a symbol OFF hides it only for YOUR assigned clients."
                : "Switching a symbol OFF hides it across the ENTIRE tenant (all clients, managers, desk). Other tenants are unaffected."}
            </div>
            <input value={symPerm.q || ""} onChange={(e) => setSymPerm((p: any) => ({ ...p, q: e.target.value }))} placeholder="Search symbol" className="mb-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]" />
            <div className="flex-1 overflow-auto">
              {symPerm.symbols.filter((s: any) => s.symbol.toLowerCase().includes((symPerm.q || "").toLowerCase())).map((s: any) => {
                const off = symPerm.disabled.includes(s.symbol);
                return (
                  <div key={s.symbol} className="flex items-center justify-between border-b border-[var(--border)] py-1.5 text-[11px]">
                    <div><span className="font-medium">{s.symbol}</span> <span style={{ color: "var(--muted)" }}>{s.display}</span></div>
                    <button onClick={() => toggleSymPerm(s.symbol, !off)} className="rounded px-2 py-0.5 text-[10px] font-semibold" style={off ? { background: "rgba(224,82,96,0.16)", color: SELL } : { background: "rgba(38,166,154,0.16)", color: BUY }}>
                      {off ? "OFF" : "ON"}
                    </button>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setSymPerm(null)} className="mt-3 w-full rounded border border-[var(--border)] py-1.5 text-xs">Done</button>
          </div>
        </div>
      )}

      {/* KYC Upload Modal */}
      {kycUploadFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setKycUploadFor(null)}>
          <div className="w-[360px] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold">Upload KYC Document</div>
            <div className="mb-3 text-[10px]" style={{ color: "var(--muted)" }}>{kycUploadFor.login} — {kycUploadFor.name}</div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px]" style={{ color: "var(--muted)" }}>Document Type</div>
                <select className="w-full rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} value={kycUploadType} onChange={(e) => setKycUploadType(e.target.value)}>
                  <option value="PASSPORT">Passport</option>
                  <option value="ID">National ID</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                  <option value="UTILITY_BILL">Utility Bill</option>
                  <option value="BANK_STATEMENT">Bank Statement</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <div className="mb-1 text-[10px]" style={{ color: "var(--muted)" }}>Front side <span style={{ color: SELL }}>*</span></div>
                <input type="file" accept="image/*,.pdf" onChange={(e) => setKycUploadFile(e.target.files?.[0] || null)} className="w-full text-[10px]" style={{ color: "var(--text)" }} />
              </div>
              <div>
                <div className="mb-1 text-[10px]" style={{ color: "var(--muted)" }}>Back side <span style={{ color: SELL }}>*</span></div>
                <input type="file" accept="image/*,.pdf" onChange={(e) => setKycBackFile(e.target.files?.[0] || null)} className="w-full text-[10px]" style={{ color: "var(--text)" }} />
              </div>
              <div className="text-[9px]" style={{ color: "var(--muted)" }}>Both sides required — documents without a back side cannot be verified.</div>
            </div>
            {err && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{err}</div>}
            {kycUpMsg && <div className="mt-2 text-[10px]" style={{ color: BUY }}>{kycUpMsg}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setKycUploadFor(null)} className="flex-1 rounded border py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button onClick={uploadKyc} className="flex-1 rounded py-2 text-[11px] font-semibold" style={{ background: BUY, color: "#04140e" }}>Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}