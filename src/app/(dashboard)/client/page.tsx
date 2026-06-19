"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import KLineProChart from "@/components/KLineProChart";
import { playSound, soundForNotification } from "@/lib/sounds";
import PriceCell from "@/components/PriceCell";
import toast from "react-hot-toast";
import WalletPanel from "@/components/WalletPanel";
import ClientSplash from "@/components/ClientSplash";
import { titleCaseName, gnum, gmoney } from "@/lib/format";
import { iconForNotification } from "@/lib/notif";
import instruments from "@/config/instruments";
import { contractFor } from "@/config/contracts";
import ClientMobile from "@/components/ClientMobile";

const DARK: any = { "--bg": "#131722", "--panel": "#1e222d", "--border": "#363a45", "--text": "#d1d4dc", "--muted": "#848e9c", "--soft": "#2a2e39" };
const LIGHT: any = { "--bg": "#f1f5f9", "--panel": "#ffffff", "--border": "#e2e8f0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f7" };
const BUY = "#26a69a", SELL = "#ef5350", GOLD = "#0078d7";
const LOTS = [0.01, 0.05, 0.1, 0.5, 1];
const TFS = ["1M", "5M", "15M", "30M", "1H", "4H", "1D"];
const INDS: [string, string][] = [["RSI", "RSI@tv-basicstudies"], ["MACD", "MACD@tv-basicstudies"], ["Stoch", "Stochastic@tv-basicstudies"], ["BBands", "BB@tv-basicstudies"], ["MA", "MASimple@tv-basicstudies"], ["ROC", "ROC@tv-basicstudies"]];

const DIGITS: Record<string, number> = {};
function dg(sym: string, f = 2) { return DIGITS[sym] ?? instruments[sym]?.digits ?? f; }
function pnlOf(p: any, price: number, cs: number) {
  const sym = String(p.symbol || "");
  const dir = p.type === "BUY" ? 1 : -1;
  const diff = (price - p.openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  // Standard contract-size model (forex = 100,000 units per 1.0 lot).
  let pf = diff * p.lots * (cs || 100000);
  if (isFx && /^USD/i.test(sym)) pf = pf / (price || 1); // USD as base -> convert to USD
  return pf;
}

export default function ClientTerminal() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { const t = localStorage.getItem("cubex-theme"); if (t === "light" || t === "dark") setTheme(t); }, []);
  function toggleTheme() { setTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("cubex-theme", n); return n; }); }

  const [account, setAccount] = useState<any>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: "", logoUrl: null });
  // Branded loading splash: fast brand fetch for the logo/slogan, hidden once the
  // first account/prices load completes.
  const [splashBrand, setSplashBrand] = useState<any>(null);
  const [dataReady, setDataReady] = useState(false); // first account/prices loaded
  const [minElapsed, setMinElapsed] = useState(false); // 3s branding minimum
  const [splashGone, setSplashGone] = useState(false);
  const booted = dataReady && minElapsed; // start fade only when both are true
  const [kycVerified, setKycVerified] = useState(true); // assume ok until /account resolves
  const [accts, setAccts] = useState<any[]>([]);
  const [xferModal, setXferModal] = useState(false);
  const [xfer, setXfer] = useState<any>({});
  const [xferErr, setXferErr] = useState("");
  const [accId, setAccId] = useState("");
  const accIdRef = useRef("");
  const [positions, setPositions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [financials, setFinancials] = useState<any[]>([]);
  const [symbols, setSymbols] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const notifSeen = useRef<Set<string>>(new Set());
  const notifPrimed = useRef(false);
  const [cToasts, setCToasts] = useState<any[]>([]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmt, setTopUpAmt] = useState("10000");
  function pushToast(n: any) {
    const st = soundForNotification(n);
    const id = Date.now() + Math.random();
    setCToasts([{ id, st, title: n.title, body: n.body }]); // single toast — new replaces old
    setTimeout(() => setCToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }
  const [selSym, setSelSym] = useState("");
  const [tf, setTf] = useState("1M");
  const [orderType, setOrderType] = useState<"MARKET" | "PENDING">("MARKET");
  const [entryTab, setEntryTab] = useState<"trade" | "pending">("trade");
  const [ordIdx, setOrdIdx] = useState(0); // selected order kind (app-style grid)
  const [walletModal, setWalletModal] = useState<null | "deposit" | "withdraw" | "kyc">(null);
  const [chartInd, setChartInd] = useState({ sma: false, ema: false, bb: false, rsi: false, macd: false, psar: false, cdl: false, stoch: false, atr: false, adx: false, sig: false, ribbon: false });
  const [chartCfg, setChartCfg] = useState<any>({ ma: 20, rsi: 14, bb: 20, macdF: 12, macdS: 26, macdSig: 9 });
  const [cfgOpen, setCfgOpen] = useState(false);
  const [pnlOnly, setPnlOnly] = useState(false);
  const [mwSearch, setMwSearch] = useState("");
  const [chartTool, setChartTool] = useState<"none" | "hline" | "trend" | "erase">("none");
  const [chartClearKey, setChartClearKey] = useState(0);
  const [stmtRep, setStmtRep] = useState(false);
  const [repPreset, setRepPreset] = useState("all");
  const [repFrom, setRepFrom] = useState("");
  const [repTo, setRepTo] = useState("");
  const [repSending, setRepSending] = useState(false);
  const [repMsg, setRepMsg] = useState("");
  const [vol, setVol] = useState(0.01);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [trail, setTrail] = useState("");
  const [rightTab, setRightTab] = useState("TRADE");
  const [ctx, setCtx] = useState<{ x: number; y: number; sym: string } | null>(null);
  const [botTab, setBotTab] = useState<"positions" | "pending" | "history" | "summary" | "requests">("positions");
  const [myReqs, setMyReqs] = useState<any[]>([]);
  const [myReqsLoaded, setMyReqsLoaded] = useState(false);
  const loadMyReqs = () => Promise.all([
    fetch("/api/client/payments").then((r) => r.json()).catch(() => ({ ok: false })),
    fetch("/api/client/account-requests").then((r) => r.json()).catch(() => ({ ok: false })),
  ]).then(([p, a]) => {
    const pay = (p.ok ? p.requests : []) || [];
    const acc = ((a.ok ? a.requests : []) || []).map((r: any) => ({ ...r, kind: "ACCOUNT" }));
    setMyReqs([...acc, ...pay].sort((x: any, y: any) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()));
    setMyReqsLoaded(true);
  });
  useEffect(() => { if (botTab === "requests" && !myReqsLoaded) loadMyReqs(); }, [botTab, myReqsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tpSlEdit, setTpSlEdit] = useState<{ id: string; field: "tp" | "sl"; val: string } | null>(null);
  const [err, setErr] = useState("");
  const [pinLock, setPinLock] = useState(false);
  const [pinHasPin, setPinHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinModal, setPinModal] = useState(false);
  const [pinForm, setPinForm] = useState<any>({});
  const [pinErr, setPinErr] = useState("");
  const [notis, setNotis] = useState<any[]>([]);
  const [pendingPrice, setPendingPrice] = useState("");
  const [pending, setPending] = useState<any[]>([]);
  const [notiOpen, setNotiOpen] = useState(false);
  const [acctMenu, setAcctMenu] = useState(false);
  const [acctSwitchOpen, setAcctSwitchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mwW, setMwW] = useState(220);
  const [rtW, setRtW] = useState(262);
  const [tbH, setTbH] = useState(200);
  const [dragging, setDragging] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [indicators, setIndicators] = useState<string[]>([]);
  function toggleInd(id: string) { setIndicators((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]); }
  const [histRange, setHistRange] = useState<"all" | "today" | "week" | "month">("all");
  // Per-table column sort (1st click asc, 2nd desc, 3rd clears).
  const [sortBy, setSortBy] = useState<Record<string, { k: string; d: 1 | -1 }>>({});
  const toggleSort = (tbl: string, k: string) => setSortBy((s) => { const cur = s[tbl]; if (!cur || cur.k !== k) return { ...s, [tbl]: { k, d: 1 } }; if (cur.d === 1) return { ...s, [tbl]: { k, d: -1 } }; const n = { ...s }; delete n[tbl]; return n; });
  const sortRows = (tbl: string, rows: any[], acc: Record<string, (r: any) => any>) => { const cfg = sortBy[tbl]; if (!cfg || !acc[cfg.k]) return rows; const get = acc[cfg.k]; return [...rows].sort((a, b) => { const va = get(a), vb = get(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; if (typeof va === "number" && typeof vb === "number") return (va - vb) * cfg.d; return String(va).localeCompare(String(vb), undefined, { numeric: true }) * cfg.d; }); };
  const Sth = ({ tbl, k, label, align, cls }: { tbl: string; k: string; label: any; align?: "right"; cls?: string }) => { const cfg = sortBy[tbl]; const active = !!cfg && cfg.k === k; return (<th className={(cls || "px-2 py-1 font-normal") + (align === "right" ? " text-right" : " text-left") + " cursor-pointer select-none"} onClick={() => toggleSort(tbl, k)}><span className={"inline-flex items-center gap-1 " + (align === "right" ? "flex-row-reverse" : "")}>{label}<i className={"fa-solid text-[8px] " + (active ? (cfg!.d === 1 ? "fa-arrow-up-long" : "fa-arrow-down-long") : "fa-sort")} style={{ opacity: active ? 1 : 0.3 }} /></span></th>); };
  useEffect(() => { if (rightTab === "NEWS" && news.length === 0) { fetch("/api/client/news?category=forex").then((r) => r.json()).then((dd) => { if (dd.ok) setNews(dd.items || []); }).catch(() => {}); } }, [rightTab]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/client/avatar").then((r) => r.json()).then((d) => { if (d.ok) setAvatarUrl(d.avatarUrl || ""); }).catch(() => {}); }, []);
  async function uploadAvatar(e: any) { const file = e.target.files && e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append("file", file); const r = await fetch("/api/client/avatar", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false })); if (r.ok && r.avatarUrl) setAvatarUrl(r.avatarUrl); else setErr(r.error || "Avatar upload failed"); }
  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("cubex-favs") || "[]")); } catch (e) {} }, []);
  function toggleFav(sym: string) { setFavs((f) => { const n = f.includes(sym) ? f.filter((x) => x !== sym) : [...f, sym]; localStorage.setItem("cubex-favs", JSON.stringify(n)); return n; }); }
  const [isMobile, setIsMobile] = useState(false);
  const [acctReqModal, setAcctReqModal] = useState(false); // mobile: centered "request sent" confirmation
  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);

  const selSymRef = useRef(selSym);
  useEffect(() => { selSymRef.current = selSym; }, [selSym]);
  // Remember last symbol / timeframe / indicators across refreshes.
  useEffect(() => {
    try { const sv = JSON.parse(localStorage.getItem("cubex-client-setup") || "null"); if (sv) { if (sv.selSym) setSelSym(sv.selSym); if (sv.tf) setTf(sv.tf); if (sv.chartInd) setChartInd(sv.chartInd); if (sv.chartCfg) setChartCfg((c: any) => ({ ...c, ...sv.chartCfg })); } } catch {}
  }, []);
  useEffect(() => { if (!selSym) return; try { localStorage.setItem("cubex-client-setup", JSON.stringify({ selSym, tf, chartInd, chartCfg })); } catch {} }, [selSym, tf, chartInd, chartCfg]);
  const prevRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, any>>({});

  async function load() {
    const id = accIdRef.current;
    const d = await fetch("/api/client/account" + (id ? "?accountId=" + id : "")).then((r) => r.json());
    if (!d.ok) {
      if (d.code === "DEACTIVATED") { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); window.location.href = "/login?reason=deactivated"; return; }
      setErr(d.error || "Failed"); return;
    }
    setAccount(d.account); setKycVerified(!!d.kycVerified); setPositions(d.positions); setHistory(d.history); setFinancials(d.financials || []); setSymbols(d.symbols); setPnlOnly(!!d.pnlOnly); if (d.brand) setBrand(d.brand);
    (d.symbols || []).forEach((s: any) => { DIGITS[s.symbol] = s.digits; });
    if (!selSymRef.current && d.symbols.length) setSelSym((d.symbols.find((s: any) => s.symbol === "BTCUSD") || d.symbols[0]).symbol);
    fetch("/api/client/accounts").then((r) => r.json()).then((ad) => { if (ad.ok) { setAccts(ad.accounts || []); if (!accIdRef.current && ad.accounts && ad.accounts.length) { accIdRef.current = ad.accounts[0].id; setAccId(ad.accounts[0].id); } } }).catch((e) => console.warn("[client] accounts fetch failed", e));
    loadNotifs();
    fetch("/api/client/pending?accountId=" + (accIdRef.current || "")).then((r) => r.json()).then((pd) => { if (pd.ok) setPending(pd.pending || []); }).catch(() => {});
    setDataReady(true); // first data is in (splash also waits for the 3s minimum)
  }
  // Lightweight notifications-only refresh (used when a notification ping arrives, so
  // the bell updates live without reloading the whole account).
  function loadNotifs() {
    fetch("/api/client/notifications").then((r) => r.json()).then((nd) => { if (!nd.ok) return; const items = nd.items || []; if (notifPrimed.current) { for (const n of items) { const id = String(n.id); if (!notifSeen.current.has(id)) { playSound(soundForNotification(n)); pushToast(n); } } } items.forEach((n: any) => notifSeen.current.add(String(n.id))); notifPrimed.current = true; setNotis(items); }).catch(() => {});
  }
  async function markAllNotifsRead() {
    await fetch("/api/client/notifications", { method: "POST" }).catch(() => {});
    loadNotifs();
  }
  useEffect(() => { load(); }, []);
  // Fast brand fetch so the splash shows the logo/slogan immediately.
  useEffect(() => { fetch("/api/public/brand").then((r) => r.json()).then((b) => { if (b.ok) setSplashBrand(b); }).catch(() => {}); }, []);
  // Keep the splash up for at least 3s (branding), regardless of how fast data loads.
  useEffect(() => { const t = setTimeout(() => setMinElapsed(true), 3000); return () => clearTimeout(t); }, []);
  // Once booted (data ready AND 3s elapsed), fade the splash out then unmount it.
  useEffect(() => { if (!booted) return; const t = setTimeout(() => setSplashGone(true), 480); return () => clearTimeout(t); }, [booted]);
  useEffect(() => { fetch("/api/client/pin").then((r) => r.json()).then((d) => { if (d.ok && d.hasPin) { setPinHasPin(true); if (sessionStorage.getItem("cubex-pin-ok") !== "1") setPinLock(true); } }).catch(() => {}); }, []);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {};
    const pD: Record<string, number> = {};
    // Coalesce all incoming ticks and apply them on a fixed ~12fps cadence. Without
    // this the entire (monolithic) desk re-rendered on every animation frame, which
    // caused the slow/glitchy feel. The chart and the Buy/Sell buttons both read this
    // same `prices` state, so they now update in lockstep at the same speed.
    const flush = () => {
      const pxKeys = Object.keys(pP), drKeys = Object.keys(pD);
      if (!pxKeys.length && !drKeys.length) return;
      const px = { ...pP }, dr = { ...pD };           // snapshot then clear the buffers
      for (const k in pP) delete pP[k];
      for (const k in pD) delete pD[k];
      // Low-priority: lets urgent updates (a nav tap) interrupt the price re-render,
      // so switching tabs feels instant instead of waiting on the price churn.
      startTransition(() => {
        if (pxKeys.length) setPrices((pp) => ({ ...pp, ...px }));
        if (drKeys.length) setDirs((dd) => ({ ...dd, ...dr }));
      });
    };
    socket.on("tick", ({ symbol, price }: any) => {
      const prev = prevRef.current[symbol];
      if (prev != null && prev !== price) pD[symbol] = price > prev ? 1 : -1;
      prevRef.current[symbol] = price;
      pP[symbol] = price;
    });
    // Initial price snapshot on connect — seeds prices for frozen/closed markets so
    // open positions show their last P&L immediately.
    socket.on("prices", (snap: Record<string, number>) => {
      if (snap && typeof snap === "object") {
        for (const k in snap) prevRef.current[k] = snap[k];
        startTransition(() => setPrices((pp) => ({ ...snap, ...pp })));
      }
    });
    const flushIv = setInterval(flush, 200);
    const clr = setInterval(() => setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; }), 650);
    socket.on("refresh", (p: any) => { if (p && p.kind === "notification") loadNotifs(); else load(); });
    return () => { socket.disconnect(); clearInterval(clr); clearInterval(flushIv); };
  }, []);

  async function place(type: "BUY" | "SELL") {
    setErr("");
    if (account?.locked) { setErr("Your account is read-only (locked). Trading is disabled."); return; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return; }
    if (orderType === "PENDING") {
      const trig = Number(pendingPrice); if (!trig) { setErr("Enter a trigger price"); return; }
      const mkt = prices[selSym] ?? trig;
      const kind = type === "BUY" ? (trig < mkt ? "LIMIT" : "STOP") : (trig > mkt ? "LIMIT" : "STOP");
      const rp = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side: type, lots: Number(vol), price: trig, kind, sl: Number(sl) || 0, tp: Number(tp) || 0, accountId: accIdRef.current }) });
      const dp = await rp.json(); if (!dp.ok) { setErr(dp.error || "Failed"); return; }
      pushToast({ title: `Pending ${type} ${selSym} placed`, type: "TRADE" }); setPendingPrice(""); load(); return;
    }
    const r = await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selSym, side: type, lots: Number(vol), sl: Number(sl) || 0, tp: Number(tp) || 0, accountId: accIdRef.current }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Order failed"); return; }
    pushToast({ title: `${type} ${selSym} ${vol}L opened`, type: "TRADE" }); load();
  }
  async function quickTrade(sym: string, side: "BUY" | "SELL", lots?: number) {
    setSelSym(sym); setErr("");
    if (account?.locked) { setErr("Account is read-only."); return false; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return false; }
    const r = await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, side, lots: Number(lots ?? vol), sl: 0, tp: 0, accountId: accIdRef.current }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Order failed"); return false; }
    pushToast({ title: `${side} ${sym} ${Number(lots ?? vol)}L opened`, type: "TRADE" }); load(); return true;
  }
  // Mobile/explicit pending order: kind = LIMIT | STOP
  async function placePending(sym: string, side: "BUY" | "SELL", kind: "LIMIT" | "STOP", trigger: number, lots: number, slv = 0, tpv = 0) {
    setErr("");
    if (account?.locked) { setErr("Account is read-only."); return false; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return false; }
    if (!trigger || trigger <= 0) { setErr("Enter a trigger price"); return false; }
    const r = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, side, kind, lots: Number(lots), price: trigger, sl: slv, tp: tpv, accountId: accIdRef.current }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Pending failed"); return false; }
    pushToast({ title: `Pending ${side} ${sym} placed`, type: "TRADE" }); load(); return true;
  }
  async function cancelPending(id: string) { await fetch("/api/client/pending/" + id, { method: "DELETE" }); pushToast({ title: "Pending order cancelled", type: "TRADE" }); load(); }
  function urlB64ToUint8Array(base64String: string) { const padding = "=".repeat((4 - (base64String.length % 4)) % 4); const b = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(b); const arr = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i); return arr; }
  async function enablePush() {
    const fail = (m: string) => { setErr(m); pushToast({ title: m, type: "NOTICE" }); };
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { fail("Push isn't supported on this device/browser"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { fail(perm === "denied" ? "Notifications are blocked — enable them in your browser/app settings" : "Notification permission not granted"); return; }
      const keyRes = await fetch("/api/client/push").then((r) => r.json());
      if (!keyRes.publicKey) { fail("Push isn't configured on the server (VAPID key missing)"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(keyRes.publicKey) });
      const j: any = sub.toJSON();
      const r = await fetch("/api/client/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { fail(r.error || "Couldn't save the subscription"); return; }
      pushToast({ title: "Push alerts enabled", type: "NOTICE" });
    } catch (e: any) { fail(e?.name === "NotAllowedError" ? "Notifications are blocked" : "Failed to enable alerts"); }
  }
  async function disablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      let endpoint = "";
      if (reg) { const sub = await reg.pushManager.getSubscription(); if (sub) { endpoint = sub.endpoint; await sub.unsubscribe(); } }
      await fetch("/api/client/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
      pushToast({ title: "Push alerts disabled", type: "NOTICE" });
    } catch (e) { setErr("Failed to disable alerts"); }
  }
  async function addPasskey() {
    try {
      const mod: any = await import("@simplewebauthn/browser");
      const optRes = await fetch("/api/client/webauthn/register/options").then((r) => r.json());
      if (!optRes.ok) { setErr(optRes.error || "Failed"); return; }
      const attResp = await mod.startRegistration(optRes.options);
      const vr = await fetch("/api/client/webauthn/register/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attResp) }).then((r) => r.json());
      if (!vr.ok) { setErr(vr.error || "Verification failed"); return; }
      pushToast({ title: "Passkey / Face ID added", type: "NOTICE" });
    } catch (e: any) { setErr((e && e.message) || "Passkey failed"); }
  }
  async function unlockPasskey() {
    setPinErr("");
    try {
      const mod: any = await import("@simplewebauthn/browser");
      const optRes = await fetch("/api/client/webauthn/auth/options").then((r) => r.json());
      if (!optRes.ok) { setPinErr(optRes.error || "No passkey"); return; }
      const asResp = await mod.startAuthentication(optRes.options);
      const vr = await fetch("/api/client/webauthn/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(asResp) }).then((r) => r.json());
      if (!vr.ok) { setPinErr(vr.error || "Failed"); return; }
      sessionStorage.setItem("cubex-pin-ok", "1"); setPinLock(false);
    } catch (e: any) { setPinErr((e && e.message) || "Passkey unlock failed"); }
  }
  async function unlock() {
    setPinErr("");
    const r = await fetch("/api/client/pin/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinInput }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setPinErr(r.error || "Incorrect PIN"); return; }
    sessionStorage.setItem("cubex-pin-ok", "1"); setPinLock(false); setPinInput("");
  }
  async function savePin() {
    setPinErr("");
    const pin = String(pinForm.pin || "");
    if (!/^\d{4,6}$/.test(pin)) { setPinErr("PIN must be 4–6 digits"); return; }
    const r = await fetch("/api/client/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, current: pinForm.current }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setPinErr(r.error || "Failed"); return; }
    setPinHasPin(true); setPinModal(false); setPinForm({}); sessionStorage.setItem("cubex-pin-ok", "1");
  }
  async function saveTpSl() {
    if (!tpSlEdit) return;
    const val = parseFloat(tpSlEdit.val);
    const body: any = { [tpSlEdit.field]: isNaN(val) ? 0 : val };
    const r = await fetch("/api/client/orders/" + tpSlEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setTpSlEdit(null);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }
  async function close(id: string) {
    if (account?.locked) { setErr("Your account is read-only. Closing is disabled."); return; }
    const r = await fetch("/api/client/orders/" + id + "/close", { method: "POST" });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Close failed"); return; }
    pushToast({ title: "Trade closed" + (d.pnl != null ? ` · P/L $${gnum(d.pnl, 2)}` : ""), type: "TRADE" }); load();
  }
  function switchAcc(id: string) { accIdRef.current = id; setAccId(id); load(); }
  async function doTransfer() {
    setXferErr("");
    const fromId = xfer.fromId || accId;
    const r = await fetch("/api/client/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromId, toId: xfer.toId, amount: Number(xfer.amount) }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setXferErr(r.error || "Transfer failed"); return; }
    pushToast({ title: "Transfer completed", type: "FUNDS" }); setXferModal(false); setXfer({});
    fetch("/api/client/accounts").then((x) => x.json()).then((ad) => { if (ad.ok) setAccts(ad.accounts || []); }).catch(() => {});
    load();
  }
  async function openAccount(type: "DEMO" | "LIVE") {
    setErr("");
    if (account?.locked) { toast.error("Your account is read-only. Cannot create new accounts."); return { ok: false }; }
    const tid = toast.loading(`Opening ${type === "LIVE" ? "live" : "demo"} account…`);
    const r = await fetch("/api/client/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { toast.error(r.error || "Failed to open account", { id: tid }); setErr(r.error || "Failed"); return r; }
    if (r.pending) { toast.dismiss(tid); if (isMobile) setAcctReqModal(true); else toast.success("Request sent — your additional live account needs admin approval. You'll be notified once it's reviewed.", { duration: 6000 }); return r; }
    toast.success(`${type === "LIVE" ? "Live" : "Demo"} account ${r.account?.login || ""} created`, { id: tid });
    if (r.account) { accIdRef.current = r.account.id; setAccId(r.account.id); }
    load();
    return r;
  }
  function topUp() { setTopUpOpen(true); }
  async function doTopUp(amt: number) {
    setTopUpOpen(false);
    if (!amt || amt <= 0) return;
    const r = await fetch("/api/client/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: accIdRef.current, amount: amt }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Top-up failed"); return; }
    pushToast({ title: `Demo balance topped up $${amt.toLocaleString()}`, type: "FUNDS" }); load();
  }

  function dragX(e: any, which: "mw" | "rt") { e.preventDefault(); setDragging(true); const sx = e.clientX; const sw = which === "mw" ? mwW : rtW; const mv = (ev: any) => { const dx = ev.clientX - sx; if (which === "mw") setMwW(Math.max(150, Math.min(380, sw + dx))); else setRtW(Math.max(200, Math.min(380, sw - dx))); }; const up = () => { setDragging(false); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function dragY(e: any) { e.preventDefault(); setDragging(true); const sy = e.clientY; const sh = tbH; const mv = (ev: any) => { const dy = sy - ev.clientY; setTbH(Math.max(120, Math.min(520, sh + dy))); }; const up = () => { setDragging(false); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function toggleCat(c: string) { setCollapsed((o) => ({ ...o, [c]: !o[c] })); }

  const unread = notis.filter((n: any) => !n.read).length;
  const curAcct = accts.find((a) => a.id === accId);
  const readOnly = !!account?.locked;
  // Live accounts require KYC; demo accounts never do. Drives the banner + trade gate.
  const needKyc = account?.type === "LIVE" && !kycVerified;
  // App-style order-kind grid for the desktop ticket
  const ORDER_KINDS_DESK: [string, "BUY" | "SELL", string][] = [["MARKET", "BUY", "Market Buy"], ["MARKET", "SELL", "Market Sell"], ["LIMIT", "BUY", "Buy Limit"], ["LIMIT", "SELL", "Sell Limit"], ["STOP", "BUY", "Buy Stop"], ["STOP", "SELL", "Sell Stop"]];
  const [ordKind, ordSide, ordLabel] = ORDER_KINDS_DESK[ordIdx] || ORDER_KINDS_DESK[0];
  const ordPending = ordKind !== "MARKET";
  async function submitTicket() {
    if (ordKind === "MARKET") { setOrderType("MARKET"); await place(ordSide); }
    else await placePending(selSym, ordSide, ordKind as "LIMIT" | "STOP", Number(pendingPrice), Number(vol), Number(sl) || 0, Number(tp) || 0);
  }
  const catMap: Record<string, string> = Object.fromEntries(symbols.map((s) => [s.symbol, s.category || "forex"]));
  function csz(sym: string) { return contractFor(catMap[sym] || "forex", sym); }
  const floating = positions.reduce((s, p) => s + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
  const balance = account ? account.deposit - account.withdrawal + account.credit + account.bonus + account.pnl : 0;
  const equity = balance + floating;
  const used = account ? (() => {
    // hedged (net) margin: net BUY−SELL lots per symbol, charge margin on |net| only
    const net: Record<string, number> = {};
    for (const p of positions) net[p.symbol] = (net[p.symbol] || 0) + (p.type === "BUY" ? 1 : -1) * Number(p.lots);
    let m = 0;
    for (const s in net) { const nl = Math.abs(net[s]); if (nl < 1e-9) continue; const pr = prices[s] ?? (positions.find((p) => p.symbol === s)?.openPrice ?? 0); let mg = (nl * csz(s) * pr) / account.leverage; if (/JPY$/i.test(s)) mg = mg / 100; m += mg; }
    return m;
  })() : 0;
  const free = equity - used;
  const level = used > 0 ? (equity / used) * 100 : 0;
  const price = prices[selSym];
  const d = dg(selSym);
  const bid = price ?? 0, ask = price != null ? price + Math.pow(10, -d) * 2 : 0;
  const margin = price != null ? ((vol * csz(selSym) * price) / (account?.leverage || 100)) / (/JPY$/i.test(selSym) ? 100 : 1) : 0;
  const fmt = (v: number) => gmoney(v);
  const groups: Record<string, any[]> = {};
  const mwq = mwSearch.trim().toLowerCase();
  symbols.filter((s) => !mwq || (s.symbol + " " + (s.display || "")).toLowerCase().includes(mwq)).forEach((s) => { const c = s.category || "other"; (groups[c] || (groups[c] = [])).push(s); });
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const orderedGroups = Object.entries(groups).sort((a, b) => { const ia = CAT_ORDER.indexOf(a[0]); const ib = CAT_ORDER.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
  const histShown = history.filter((h: any) => { if (histRange === "all") return true; const t = new Date(h.closedAt).getTime(); const now = Date.now(); const day = 86400000; if (histRange === "today") return t >= now - day; if (histRange === "week") return t >= now - 7 * day; return t >= now - 30 * day; });
  const tab = (active: boolean) => "px-3 py-1.5 text-[11px] " + (active ? "" : "text-[var(--muted)]");

  // Branded loading splash overlay (shown over both mobile + desktop until ready).
  const splashEl = !splashGone ? <ClientSplash brand={splashBrand || brand} theme={theme} hiding={booted} /> : null;

  if (isMobile) return <>{splashEl}<ClientMobile t={{ theme, brand, account, accts, accId, pnlOnly, readOnly, needKyc, openKyc: () => setWalletModal("kyc"), positions, pending, history, financials, notis, symbols, prices, dirs, selSym, vol, orderType, pendingPrice, sl, tp, err, balance, equity, floating, free, used, level, price, bid, ask, d, tf, TFS, setSelSym, setVol, setSl, setTp, setOrderType, setPendingPrice, setTf, place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr, toggleTheme, enablePush, disablePush, addPasskey, openPin: () => { setPinErr(""); setPinForm({}); setPinModal(true); }, favs, toggleFav, avatarUrl, uploadAvatar, fmt, csz, pnlOf, dg, markAllNotifsRead, chartInd, setChartInd, chartCfg, setChartCfg, acctReqModal, setAcctReqModal, logout: async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }, pin: { pinLock, pinInput, setPinInput, pinErr, unlock, unlockPasskey, pinModal, setPinModal, pinHasPin, setPinHasPin, pinForm, setPinForm, savePin, disablePin: async () => { if (!confirm("Disable PIN? You will no longer need a PIN to open the app.")) return; const r = await fetch("/api/client/pin", { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false })); if (r.ok) { setPinHasPin(false); sessionStorage.removeItem("cubex-pin-ok"); } } }, cToasts, pushToast, dismissToasts: () => setCToasts([]) }} /></>;
  return (
    <div style={{ ...(theme === "dark" ? DARK : LIGHT), fontFamily: "Tahoma, 'Segoe UI', sans-serif" }} className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {splashEl}
      {needKyc && (
        <div className="flex items-center gap-3 px-3 py-2 text-[12px] font-medium" style={{ background: "linear-gradient(90deg, rgba(240,180,41,0.22), rgba(240,180,41,0.08))", borderBottom: "1px solid rgba(240,180,41,0.4)", color: "#f0b829" }}>
          <i className="fa-solid fa-triangle-exclamation" />
          <span className="flex-1">Verify your identity to unlock trading on your live account. Demo accounts are unaffected.</span>
          <button onClick={() => setWalletModal("kyc")} className="rounded px-3 py-1 text-[11px] font-semibold text-white" style={{ background: "#f0b829" }}>Upload KYC</button>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm">
        <div className="flex items-center gap-2"><input type="file" accept="image/*" style={{ display: "none" }} ref={avatarInputRef} onChange={uploadAvatar} /><button onClick={() => avatarInputRef.current && avatarInputRef.current.click()} title="Change photo" className="h-6 w-6 overflow-hidden rounded-full border border-[var(--border)]">{avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-full w-full object-contain" /> : <span className="inline-block h-full w-full bg-[#3b82f6]" />}</button><b className="font-medium">{brand.name || " "}</b><span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>Client Terminal</span></div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {curAcct && <span className="mr-1 rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--soft)", color: curAcct.type === "DEMO" ? GOLD : BUY }}>{curAcct.login} · {curAcct.type}</span>}
          {/* Account switcher — icon dropdown */}
          <div className="relative">
            <button onClick={() => setAcctSwitchOpen((o) => !o)} title="Switch account" className="flex items-center gap-1 rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-arrow-right-arrow-left" /><i className="fa-solid fa-chevron-down text-[8px] opacity-60" /></button>
            {acctSwitchOpen && (<><div className="fixed inset-0 z-[80]" onClick={() => setAcctSwitchOpen(false)} />
              <div className="ui-pop absolute right-0 z-[90] mt-1 w-56 overflow-hidden rounded-xl border py-1" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
                <div className="px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">Switch Account</div>
                {accts.map((a) => (
                  <button key={a.id} onClick={() => { switchAcc(a.id); setAcctSwitchOpen(false); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--soft)]" style={a.id === accId ? { background: "var(--soft)" } : undefined}>
                    <span><span className="font-medium">{a.login}</span> <span style={{ color: a.type === "DEMO" ? GOLD : BUY }}>{a.type}</span></span>
                    {a.id === accId && <i className="fa-solid fa-check text-[10px]" style={{ color: BUY }} />}
                  </button>
                ))}
              </div></>)}
          </div>
          {/* Consolidated account/funds/security menu */}
          <div className="relative">
            <button onClick={() => setAcctMenu((o) => !o)} className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--soft)]"><i className="fa-solid fa-bars-staggered" /> Menu <i className="fa-solid fa-chevron-down text-[8px] opacity-60" /></button>
            {acctMenu && (() => {
              const close = () => setAcctMenu(false);
              const mItem = (onClick: () => void, icon: string, label: string, color?: string, disabled?: boolean) => (
                <button disabled={disabled} onClick={() => { if (disabled) return; onClick(); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--soft)] disabled:opacity-40 disabled:cursor-not-allowed">
                  <i className={"fa-solid " + icon} style={{ width: 14, textAlign: "center", color: color || "var(--muted)" }} />{label}
                </button>
              );
              const head = (t: string) => <div className="px-3 pt-2 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t}</div>;
              const div = <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />;
              return (<><div className="fixed inset-0 z-[80]" onClick={close} />
                <div className="ui-pop absolute right-0 z-[90] mt-1 w-56 overflow-hidden rounded-xl border py-1 text-[11px]" style={{ background: "var(--panel)", borderColor: "var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
                  {head("Funds")}
                  {curAcct?.type === "LIVE" ? (<>
                    {mItem(() => { close(); setWalletModal("deposit"); }, "fa-circle-dollar-to-slot", "Deposit", BUY)}
                    {mItem(() => { close(); setWalletModal("withdraw"); }, "fa-hand-holding-dollar", "Withdraw", GOLD)}
                    {accts.length >= 2 && mItem(() => { setXferErr(""); setXfer({ fromId: accId }); setXferModal(true); }, "fa-money-bill-transfer", "Transfer", undefined, readOnly)}
                  </>) : (
                    mItem(topUp, "fa-coins", "Top up Demo", GOLD, readOnly)
                  )}
                  {div}
                  {head("Accounts")}
                  {!accts.some((a: any) => a.type === "DEMO") && mItem(() => openAccount("DEMO"), "fa-vial", "Open Demo Account", undefined, readOnly)}
                  {mItem(async () => { const r = await openAccount("LIVE"); if (r?.pending) { setMyReqsLoaded(false); setBotTab("requests"); } }, "fa-bolt", "Open Live Account", BUY, readOnly)}
                  {curAcct?.type === "LIVE" && mItem(() => { close(); setWalletModal("kyc"); }, "fa-id-card", "KYC Verification")}
                  {div}
                  {head("Reports")}
                  {mItem(() => { close(); setRepPreset("all"); setRepFrom(""); setRepTo(""); setRepMsg(""); setStmtRep(true); }, "fa-file-invoice", "Statement / Report", BUY)}
                  {div}
                  {head("Security")}
                  {mItem(() => { setPinErr(""); setPinForm({}); setPinModal(true); }, "fa-shield-halved", pinHasPin ? "Change PIN" : "Set PIN")}
                  {pinHasPin && mItem(async () => { if (!confirm("Disable PIN? You will no longer need a PIN to open the app.")) return; const r = await fetch("/api/client/pin", { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false })); if (r.ok) { setPinHasPin(false); sessionStorage.removeItem("cubex-pin-ok"); } }, "fa-shield-slash", "Disable PIN", SELL)}
                  {mItem(addPasskey, "fa-fingerprint", "Biometrics / Face ID")}
                  {mItem(enablePush, "fa-bell-concierge", "Push Notifications")}
                </div></>);
            })()}
          </div>
          <button onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"} className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]"><i className={"fa-solid " + (theme === "dark" ? "fa-sun" : "fa-moon")} /></button>
          <div className="relative">
            <button onClick={() => { const w = !notiOpen; setNotiOpen(w); if (w && unread > 0) { fetch("/api/client/notifications", { method: "POST" }).then(() => setNotis((ns) => ns.map((n) => ({ ...n, read: true })))); } }} title="Notifications" className="relative rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-bell" />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-bold" style={{ background: SELL, color: "#fff" }}>{unread}</span>}</button>
            {notiOpen && (<><div className="fixed inset-0 z-[80]" onClick={() => setNotiOpen(false)} /><div className="ui-pop absolute right-0 z-[90] mt-1 max-h-80 w-72 overflow-hidden rounded-xl border text-left text-[11px]" style={{ background: "var(--panel)", borderColor: "var(--border)" }}><div className="sticky top-0 flex items-center justify-between border-b px-3 py-2" style={{ background: "var(--panel)", borderColor: "var(--border)" }}><span className="font-semibold">Notifications</span>{notis.length > 0 && <button onClick={() => { markAllNotifsRead(); }} className="text-[10px]" style={{ color: GOLD }}>Mark all read</button>}</div><div className="overflow-auto" style={{ maxHeight: "calc(20rem - 36px)" }}>{notis.length === 0 ? <div className="px-2 py-3 text-center text-[var(--muted)]">No notifications</div> : notis.map((n, i) => { const ic = iconForNotification(n); return (<div key={i} className="flex items-start gap-2 border-b px-2 py-2 last:border-0" style={{ borderColor: "var(--border)", background: !n.read ? "color-mix(in srgb, var(--soft) 60%, transparent)" : undefined }}><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: ic.color + "22", color: ic.color }}><i className={"fa-solid " + ic.icon + " text-[10px]"} /></span><div className="min-w-0 flex-1"><div className="font-medium text-[var(--text)]">{n.title}</div>{n.body && <div className="mt-0.5 whitespace-pre-line text-[var(--muted)]">{n.body}</div>}{n.image && <img src={n.image} alt="" className="mt-1 max-h-28 w-full rounded object-cover" />}<div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</div></div></div>); })}</div></div></>)}
          </div>
          <button onClick={async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} title="Logout" className="rounded px-2 py-1 hover:bg-[var(--soft)]" style={{ color: SELL }}><i className="fa-solid fa-right-from-bracket" /></button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(224,82,96,0.16)", color: SELL, borderBottom: "1px solid rgba(224,82,96,0.35)" }}>
          <i className="fa-solid fa-lock" /> READ ONLY ACCESS — You can view everything, but all actions are disabled.
        </div>
      )}

      {/* Live account is locked to Profile + KYC until the client's KYC is approved.
          Demo accounts are unaffected (switch below to practise). */}
      {needKyc && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-auto p-4" style={{ background: "var(--bg)" }}>
          <div className="ui-pop w-full max-w-md rounded-2xl border p-6 text-center" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="mx-auto mb-2 h-10 object-contain" />}
            <div className="text-lg font-bold">{brand.name}</div>
            <div className="mx-auto my-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(240,180,41,0.15)", color: GOLD }}>
              <i className="fa-solid fa-id-card text-2xl" />
            </div>
            <div className="text-base font-semibold">Verify your identity</div>
            <p className="mx-auto mt-1 max-w-xs text-[12px] text-[var(--muted)]">Complete KYC to unlock live trading on <b>{curAcct?.login}</b>. Until it&apos;s approved, only your profile is available.</p>
            <div className="mt-4 rounded-lg border px-3 py-2 text-left text-[12px]" style={{ borderColor: "var(--border)" }}>
              <div className="flex justify-between py-0.5"><span className="text-[var(--muted)]">Name</span><span className="uppercase">{titleCaseName(account?.ownerName || account?.name)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-[var(--muted)]">Email</span><span className="truncate pl-2">{account?.email}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-[var(--muted)]">Live account</span><span>{curAcct?.login}</span></div>
            </div>
            <button onClick={() => setWalletModal("kyc")} className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: GOLD, color: "#1a1300" }}>
              <i className="fa-solid fa-upload mr-2" />Upload KYC documents
            </button>
            {accts.some((a: any) => a.type === "DEMO") && (
              <button onClick={() => { const dm = accts.find((a: any) => a.type === "DEMO"); if (dm) switchAcc(dm.id); }} className="mt-2 w-full rounded-lg border py-2.5 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                <i className="fa-solid fa-vial mr-2" style={{ color: GOLD }} />Practise on your Demo account
              </button>
            )}
            <button onClick={async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} className="mt-2 w-full rounded-lg py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--soft)]">Log out</button>
          </div>
        </div>
      )}

      {topUpOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="ui-pop w-[320px] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold">Top up Demo Account</div>
            <div className="mb-1.5 grid grid-cols-3 gap-2">
              {[1000, 5000, 10000].map((amt) => (
                <button key={amt} type="button" onClick={() => setTopUpAmt(String(amt))}
                  className="rounded-lg border py-2 text-xs font-semibold transition-colors"
                  style={Number(topUpAmt) === amt
                    ? { borderColor: GOLD, background: "rgba(240,180,41,0.12)", color: GOLD }
                    : { borderColor: "var(--border)", color: "var(--text)" }}>
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="mb-1 text-[10px] text-[var(--muted)]">Amount (USD)</div>
            <input type="number" value={topUpAmt} onChange={(e) => setTopUpAmt(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTopUpOpen(false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">Cancel</button>
              <button onClick={() => doTopUp(Number(topUpAmt))} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: GOLD, color: "#1a1300" }}>Top up</button>
            </div>
          </div>
        </div>
      )}

      {cToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[120] flex flex-col gap-2" onClick={() => setCToasts([])}>
          {cToasts.map((t) => (
            <div key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[11px] shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", minWidth: 230, maxWidth: 300, borderLeft: `3px solid ${t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : t.st === "login" ? "#a78bfa" : BUY}` }}>
              <i className={"fa-solid mt-0.5 " + (t.st === "trade" ? "fa-chart-line" : t.st === "funds" ? "fa-money-bill" : "fa-bell")} style={{ color: t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : BUY, fontSize: 12 }} />
              <div className="min-w-0"><div className="font-semibold">{t.title}</div>{t.body && <div className="mt-0.5 text-[10px] text-[var(--muted)]">{t.body}</div>}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {ctx && (<>
            <div className="fixed inset-0 z-[80]" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
            <div className="ui-pop fixed z-[90] min-w-[150px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] py-1 text-[12px] shadow-lg" style={{ left: ctx.x, top: ctx.y }}>
              <div className="px-3 py-1 text-[10px] text-[var(--muted)]">{ctx.sym}</div>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setSelSym(ctx.sym); setCtx(null); }}>New Order</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setSelSym(ctx.sym); setCtx(null); }}>Open Chart</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(ctx.sym); setCtx(null); }}>Copy Symbol</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { toggleFav(ctx.sym); setCtx(null); }}>{favs.includes(ctx.sym) ? "Remove favourite" : "Add favourite"}</button>
            </div>
          </>)}
          <aside className="flex flex-col border-r border-[var(--border)] bg-[var(--panel)]" style={{ width: mwW }}>
          <div className="border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">MARKET WATCH</div>
          <div className="border-b border-[var(--border)] px-1.5 py-1">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]" />
              <input value={mwSearch} onChange={(e) => setMwSearch(e.target.value)} name="mw-search" autoComplete="off" placeholder="Search symbol…" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-1 pl-6 pr-6 text-[10px] text-[var(--text)]" />
              {mwSearch && <button onClick={() => setMwSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]">{"×"}</button>}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-1 pb-2 text-[10px]"><div className="sticky top-0 z-10 grid grid-cols-[1fr_64px_64px] bg-[var(--panel)] px-2 py-1 text-[10px] font-bold text-[var(--text)]"><span>Symbol</span><span className="text-right pr-2">Bid</span><span className="text-right pr-2">Ask</span></div>
            {favs.length > 0 && (
              <div>
                <div className="mt-1 rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold" style={{ color: GOLD }}>{"\u2605"} FAVOURITES</div>
                {symbols.filter((s) => favs.includes(s.symbol)).map((s) => { const p = prices[s.symbol]; const dd = dg(s.symbol); const b = p != null ? p * 0.9999 : null; const a = p != null ? p * 1.0001 : null; const dir = dirs[s.symbol] || 0; return (
                  <div key={"fav-" + s.symbol} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }} className={"grid grid-cols-[1fr_64px_64px] items-center px-2 py-1 transition-colors hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}>
                    <button onClick={() => setSelSym(s.symbol)} className="truncate text-left">{s.symbol}</button>
                    <PriceCell value={b != null ? gnum(b, dd) : "..."} dir={dir} />
                    <PriceCell value={a != null ? gnum(a, dd) : "..."} dir={dir} />
                  </div>); })}
              </div>
            )}
            {orderedGroups.map(([c, list]) => (
              <div key={c}>
                <div onClick={() => toggleCat(c)} className="mt-1 cursor-pointer rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)]">{collapsed[c] ? "\u25B8" : "\u25BE"} {c.toUpperCase()}</div>
                {!collapsed[c] && list.map((s) => { const p = prices[s.symbol]; const dd = dg(s.symbol); const b = p != null ? p * 0.9999 : null; const a = p != null ? p * 1.0001 : null; const dir = dirs[s.symbol] || 0; const fc = dir > 0 ? BUY : dir < 0 ? SELL : "var(--text)"; const bg = dir > 0 ? "rgba(22,199,132,0.32)" : dir < 0 ? "rgba(224,82,96,0.32)" : "transparent"; return (
                  <div key={s.symbol} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }} className={"grid grid-cols-[1fr_64px_64px] items-center px-2 py-1 transition-colors hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}>
                    <button onClick={() => setSelSym(s.symbol)} className="truncate text-left">{s.symbol}</button>
                    <PriceCell value={b != null ? gnum(b, dd) : "..."} dir={dir} />
                    <PriceCell value={a != null ? gnum(a, dd) : "..."} dir={dir} /><span style={{ display: "none" }}>
                      
                      
                    </span>
                  </div>); })}
              </div>
            ))}
          </div>
        </aside>
        <div onMouseDown={(e) => dragX(e, "mw")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg)]">{(() => { const pos = [
            ...positions.filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
            ...pending.filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
          ]; return <KLineProChart symbol={selSym} tf={tf} theme={theme} digits={d} symbols={symbols} positions={pos} onSymbolChange={(sm) => setSelSym(sm)} />; })()}</div>
        </div>
        <div onMouseDown={(e) => dragX(e, "rt")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

        <aside className="flex flex-col border-l border-[var(--border)] bg-[var(--panel)]" style={{ width: rtW }}>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent)" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide" style={{ color: "var(--text)" }}><i className="fa-solid fa-bolt text-[10px]" style={{ color: "#2f81f7" }} />NEW ORDER</div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--soft)", color: "#2f81f7" }}>{selSym}</span>
              {price != null && <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{gnum(price, d)}</span>}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
          {rightTab === "NEWS" ? (
            <div className="p-2 text-[11px]">
              {news.length === 0 ? <div className="p-4 text-center text-[var(--muted)]">Loading news...</div> : news.map((n: any) => (
                <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block border-b border-[var(--border)] px-1 py-2 hover:bg-[var(--soft)]">
                  <div className="font-medium text-[var(--text)]">{n.headline}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">{n.source} - {new Date(n.datetime * 1000).toLocaleString()}</div>
                </a>
              ))}
            </div>
          ) : rightTab !== "TRADE" ? (
            <div className="p-6 text-center text-[11px] text-[var(--muted)]">{rightTab} panel - coming soon</div>
          ) : (
            <div className="p-2">
              {/* Trade / Pending tab toggle */}
              <div className="mb-2 flex gap-1 rounded-lg border border-[var(--border)] p-1">
                {([["trade", "Trade"], ["pending", "Pending"]] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => { setEntryTab(k); setOrderType(k === "trade" ? "MARKET" : "PENDING"); if (k === "pending" && !pendingPrice && price != null) setPendingPrice(price.toFixed(d)); }} className="flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors" style={entryTab === k ? { background: "#2f81f7", color: "#fff" } : { color: "var(--muted)" }}>{lbl}</button>
                ))}
              </div>

              {/* Pending trigger price */}
              {entryTab === "pending" && (<div className="mb-2">
                <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">Trigger Price</div>
                <input type="number" value={pendingPrice} onChange={(e) => setPendingPrice(e.target.value)} placeholder={price ? price.toFixed(d) : "price"} className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[13px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[#2f81f7]" />
              </div>)}

              {/* Volume */}
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">Volume (lots)</div>
              <div className="mb-1 flex items-center gap-1.5">
                <button onClick={() => setVol((v) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--soft)]">−</button>
                <input type="number" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} className="h-8 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-center text-[13px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[#2f81f7]" />
                <button onClick={() => setVol((v) => +(v + 0.01).toFixed(2))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--soft)]">+</button>
              </div>
              <div className="mb-2 flex gap-1">{LOTS.map((l) => <button key={l} onClick={() => setVol(l)} className="flex-1 rounded-md py-1 text-[9px] font-medium transition-colors" style={vol === l ? { background: "#2f81f7", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{l}</button>)}</div>

              {/* SL / TP */}
              <div className="mb-2 grid grid-cols-2 gap-2">
                <div><div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">Stop Loss</div><input value={sl} onChange={(e) => setSl(e.target.value)} placeholder="—" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px] tabular-nums text-[var(--text)] outline-none focus:border-[#2f81f7]" /></div>
                <div><div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">Take Profit</div><input value={tp} onChange={(e) => setTp(e.target.value)} placeholder="—" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px] tabular-nums text-[var(--text)] outline-none focus:border-[#2f81f7]" /></div>
              </div>

              {/* Margin */}
              <div className="mb-2 flex items-center justify-between rounded-lg bg-[var(--soft)] px-3 py-1.5 text-[10px] text-[var(--muted)]">Required Margin<span className="font-semibold tabular-nums text-[var(--text)]">{margin ? "$" + fmt(margin) : "$0.00"}</span></div>

              {/* Action buttons */}
              {entryTab === "trade" ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => place("SELL")} disabled={!account || account?.locked} className="flex flex-col items-center gap-0.5 rounded-xl py-2.5 font-semibold text-white shadow-md transition-transform active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg, #ff6b78, #e0394a 70%, #b9293a)" }}>
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-down text-[9px]" />Sell</span><span className="text-[15px] tabular-nums">{bid != null ? gnum(bid, d) : "…"}</span>
                  </button>
                  <button onClick={() => place("BUY")} disabled={!account || account?.locked} className="flex flex-col items-center gap-0.5 rounded-xl py-2.5 font-semibold text-white shadow-md transition-transform active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg, #5aa0ff, #2f81f7 70%, #1e63cc)" }}>
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-up text-[9px]" />Buy</span><span className="text-[15px] tabular-nums">{ask != null ? gnum(ask, d) : "…"}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {([["BUY", "LIMIT", "Buy Limit"], ["SELL", "LIMIT", "Sell Limit"], ["BUY", "STOP", "Buy Stop"], ["SELL", "STOP", "Sell Stop"]] as const).map(([side, kind, lbl]) => {
                    const buy = side === "BUY";
                    return (<button key={lbl} onClick={() => placePending(selSym, side, kind, Number(pendingPrice), vol, Number(sl) || 0, Number(tp) || 0)} disabled={!account || account?.locked} className="rounded-xl py-2 text-[11px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-50" style={{ background: buy ? "rgba(47,129,247,0.15)" : "rgba(224,82,96,0.13)", color: buy ? "#6ab0ff" : SELL, border: "1px solid " + (buy ? "rgba(47,129,247,0.45)" : "rgba(224,82,96,0.45)") }}>{lbl}</button>);
                  })}
                </div>
              )}
              {!account && <div className="mt-2 text-center text-[10px]" style={{ color: SELL }}>No account selected</div>}
              {err && <div className="mt-2 text-center text-[10px]" style={{ color: SELL }}>{err}</div>}
            </div>
          )}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[11px] font-bold" style={{ color: "#facc15" }}>
        <span>Balance: <span className="text-[var(--text)]">{account ? fmt(balance) : "--"}</span></span>
        <span>Flt P/L: <span style={{ color: floating >= 0 ? BUY : SELL }}>{account ? fmt(floating) : "--"}</span></span>
        <span>Equity: <span className="text-[var(--text)]">{account ? fmt(equity) : "--"}</span></span>
        <span>Used Margin: <span className="text-[var(--text)]">{account ? fmt(used) : "--"}</span></span>
        <span>Free Margin: <span className="text-[var(--text)]">{account ? fmt(free) : "--"}</span></span>
        <span>Margin Level: <span className="text-[var(--text)]">{account && level ? level.toFixed(1) + "%" : "--"}</span></span>
      </div>

      <div onMouseDown={dragY} className="h-1 cursor-row-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

      <div className="flex shrink-0 flex-col bg-[var(--panel)]" style={{ height: tbH }}>
        <div className="flex gap-1 border-b border-[var(--border)] px-2">
          <button onClick={() => setBotTab("positions")} className={tab(botTab === "positions")} style={botTab === "positions" ? { color: BUY } : undefined}>Positions {positions.length}{pending.length ? <span className="ml-1 rounded-full px-1.5 text-[9px]" style={{ background: "rgba(90,169,255,0.2)", color: "#5aa9ff" }}>{pending.length} pending</span> : ""}</button>
          <button onClick={() => setBotTab("history")} className={tab(botTab === "history")} style={botTab === "history" ? { color: BUY } : undefined}>History</button>
          <button onClick={() => setBotTab("summary")} className={tab(botTab === "summary")} style={botTab === "summary" ? { color: BUY } : undefined}>Summary</button>
          <button onClick={() => setBotTab("requests")} className={tab(botTab === "requests")} style={botTab === "requests" ? { color: BUY } : undefined}>My Requests</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3">
          {botTab === "positions" && positions.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)]">
              <span>Total Trades: <span className="text-[var(--text)]">{positions.length}</span></span>
              <span>Total Lots: <span className="text-[var(--text)]">{positions.reduce((a: number, p: any) => a + Number(p.lots), 0).toFixed(2)}</span></span>
              <span>Total P/L: <span style={{ color: floating >= 0 ? BUY : SELL }}>{fmt(floating)}</span></span>
            </div>
          )}
          {botTab === "positions" && (
            <table className="w-full text-[10px]">
              <thead><tr className="text-left text-[var(--muted)]"><Sth tbl="pos" k="name" label="Name" /><Sth tbl="pos" k="date" label="Date" /><Sth tbl="pos" k="qty" label="Qty" align="right" /><Sth tbl="pos" k="open" label="Open" align="right" /><Sth tbl="pos" k="current" label="Current" align="right" /><Sth tbl="pos" k="tp" label="TP" align="right" /><Sth tbl="pos" k="sl" label="SL" align="right" /><th className="px-2 py-1 font-normal text-right">Swap</th><Sth tbl="pos" k="pnl" label="Gross P/L" align="right" /><Sth tbl="pos" k="pnl" label="Net P/L" align="right" /><th className="px-2 py-1 font-normal text-right"></th></tr></thead>
              <tbody>
                {positions.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={11}>No open positions.</td></tr> : sortRows("pos", positions, { name: (p) => p.symbol, date: (p) => new Date(p.openedAt).getTime(), qty: (p) => Number(p.lots), open: (p) => Number(p.openPrice), current: (p) => Number(prices[p.symbol] ?? p.openPrice), tp: (p) => Number(p.tp) || null, sl: (p) => Number(p.sl) || null, pnl: (p) => pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)) }).map((p) => { const cur = prices[p.symbol] ?? p.openPrice; const pl = pnlOf(p, cur, csz(p.symbol)); const cdir = dirs[p.symbol] || 0; return (
                  <tr key={p.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1">{p.symbol} <span style={{ color: p.type === "BUY" ? BUY : SELL }}>{p.type === "BUY" ? "Buy" : "Sell"}</span></td>
                    <td className="px-2 py-1 text-[var(--muted)]">{new Date(p.openedAt).toLocaleDateString()}</td>
                    <td className="px-2 py-1 text-right">{p.lots}</td><td className="px-2 py-1 text-right">{gnum(p.openPrice, dg(p.symbol))}</td>
                    <td className="px-2 py-1 text-right tabular-nums" style={{ color: cdir > 0 ? "#16c784" : cdir < 0 ? "#e05260" : "var(--text)", transition: "color 0.3s ease" }}>{gnum(cur, dg(p.symbol))}</td>
                    <td className="px-2 py-1 text-right" onClick={() => { if (!tpSlEdit) setTpSlEdit({ id: p.id, field: "tp", val: p.tp ? String(p.tp) : "" }); }} title="Click to edit TP" style={{ cursor: "pointer" }}>
                      {tpSlEdit !== null && tpSlEdit.id === p.id && tpSlEdit.field === "tp" ? (
                        <input type="text" inputMode="decimal" autoFocus value={tpSlEdit.val} onChange={(e) => setTpSlEdit({ id: p.id, field: "tp", val: e.target.value })} onBlur={saveTpSl} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTpSlEdit(null); }} className="w-20 rounded border px-1 py-0.5 text-right text-[10px]" style={{ background: "var(--soft)", borderColor: "#10b981", color: "#10b981" }} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span style={{ color: p.tp ? "#10b981" : "var(--muted)" }}>{p.tp ? gnum(p.tp, dg(p.symbol)) : <span className="text-[9px]">+ TP</span>}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right" onClick={() => { if (!tpSlEdit) setTpSlEdit({ id: p.id, field: "sl", val: p.sl ? String(p.sl) : "" }); }} title="Click to edit SL" style={{ cursor: "pointer" }}>
                      {tpSlEdit !== null && tpSlEdit.id === p.id && tpSlEdit.field === "sl" ? (
                        <input type="text" inputMode="decimal" autoFocus value={tpSlEdit.val} onChange={(e) => setTpSlEdit({ id: p.id, field: "sl", val: e.target.value })} onBlur={saveTpSl} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTpSlEdit(null); }} className="w-20 rounded border px-1 py-0.5 text-right text-[10px]" style={{ background: "var(--soft)", borderColor: "#f43f5e", color: "#f43f5e" }} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span style={{ color: p.sl ? "#f43f5e" : "var(--muted)" }}>{p.sl ? gnum(p.sl, dg(p.symbol)) : <span className="text-[9px]">+ SL</span>}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">0.00</td>
                    <td className="px-2 py-1 text-right" style={{ color: pl >= 0 ? BUY : SELL }}>{(pl >= 0 ? "+$" : "-$") + fmt(Math.abs(pl))}</td>
                    <td className="px-2 py-1 text-right" style={{ color: pl >= 0 ? BUY : SELL }}>{(pl >= 0 ? "+$" : "-$") + fmt(Math.abs(pl))}</td>
                    <td className="px-2 py-1 text-right"><button style={{ color: SELL }} onClick={() => close(p.id)}>X</button></td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "positions" && pending.length > 0 && (
            <table className="w-full text-[10px]">
              <thead>
                <tr><th colSpan={9} className="border-t-2 px-2 pb-1 pt-2 text-left text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#5aa9ff", borderColor: "rgba(90,169,255,0.35)" }}><i className="fa-regular fa-clock mr-1" />Pending Orders ({pending.length}) — waiting to trigger</th></tr>
                <tr className="text-left text-[var(--muted)]"><th className="px-2 py-1 font-normal">Order</th><th className="px-2 py-1 font-normal">Type</th><th className="px-2 py-1 font-normal text-right">Lots</th><th className="px-2 py-1 font-normal text-right">Trigger</th><th className="px-2 py-1 font-normal text-right">Current</th><th className="px-2 py-1 font-normal text-right">Distance</th><th className="px-2 py-1 font-normal text-right">SL</th><th className="px-2 py-1 font-normal text-right">TP</th><th className="px-2 py-1 font-normal text-right"></th></tr>
              </thead>
              <tbody>
                {pending.map((o: any) => {
                  const d = dg(o.symbol); const trig = Number(o.price); const cur = prices[o.symbol]; const dist = cur != null ? Math.abs(trig - cur) : null;
                  const label = (o.side === "BUY" ? "Buy" : "Sell") + " " + (o.kind === "LIMIT" ? "Limit" : "Stop"); const c = o.side === "BUY" ? "#5aa9ff" : SELL;
                  return (
                  <tr key={o.id} className="border-t border-[var(--border)]" style={{ background: "rgba(90,169,255,0.05)" }}>
                    <td className="px-2 py-1"><i className="fa-regular fa-clock mr-1 text-[var(--muted)]" />{o.symbol}</td>
                    <td className="px-2 py-1"><span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: c + "22", color: c }}>{label}</span></td>
                    <td className="px-2 py-1 text-right">{o.lots}</td>
                    <td className="px-2 py-1 text-right font-semibold">{gnum(trig, d)}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{cur != null ? gnum(cur, d) : "…"}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{dist != null ? gnum(dist, d) : "—"}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{o.sl ? gnum(o.sl, d) : "-"}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{o.tp ? gnum(o.tp, d) : "-"}</td>
                    <td className="px-2 py-1 text-right"><button title="Cancel order" style={{ color: SELL }} onClick={() => cancelPending(o.id)}><i className="fa-solid fa-xmark" /></button></td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "history" && (
            <div className="flex gap-1 px-2 py-1 text-[9px]">
              {(["all", "today", "week", "month"] as const).map((r) => <button key={r} onClick={() => setHistRange(r)} className="rounded px-2 py-0.5" style={histRange === r ? { background: BUY, color: "#04140e" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{r === "all" ? "All" : r === "today" ? "Today" : r === "week" ? "Week" : "Month"}</button>)}
            </div>
          )}
          {botTab === "history" && (
            <table className="w-full text-[10px]">
              <thead><tr className="text-left text-[var(--muted)]"><Sth tbl="chist" k="name" label="Name" /><Sth tbl="chist" k="opened" label="Opened" /><Sth tbl="chist" k="closed" label="Closed" /><Sth tbl="chist" k="qty" label="Qty" align="right" /><Sth tbl="chist" k="open" label="Open" align="right" /><Sth tbl="chist" k="close" label="Close" align="right" /><Sth tbl="chist" k="sl" label="SL" align="right" /><Sth tbl="chist" k="tp" label="TP" align="right" /><Sth tbl="chist" k="reason" label="Reason" /><Sth tbl="chist" k="pnl" label="P/L" align="right" /></tr></thead>
              <tbody>
                {histShown.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={10}>No history.</td></tr> : sortRows("chist", histShown, { name: (h) => h.symbol, opened: (h) => h.openedAt ? new Date(h.openedAt).getTime() : null, closed: (h) => h.closedAt ? new Date(h.closedAt).getTime() : null, qty: (h) => Number(h.lots), open: (h) => Number(h.openPrice), close: (h) => Number(h.closePrice), sl: (h) => Number(h.sl), tp: (h) => Number(h.tp), reason: (h) => h.closeReason || "MANUAL", pnl: (h) => Number(h.pnl) }).map((h) => {
                  const r = h.closeReason || "MANUAL";
                  const rc = r === "TP" ? "#10b981" : r === "SL" ? "#f43f5e" : r === "MC" ? "#f59e0b" : "var(--muted)";
                  return (
                  <tr key={h.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1">{h.symbol} <span style={{ color: h.side === "BUY" ? BUY : SELL }}>{h.side}</span></td>
                    <td className="px-2 py-1 text-[var(--muted)]">{h.openedAt ? new Date(h.openedAt).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-[var(--muted)]">{h.closedAt ? new Date(h.closedAt).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{h.lots}</td>
                    <td className="px-2 py-1 text-right">{gnum(h.openPrice, dg(h.symbol))}</td>
                    <td className="px-2 py-1 text-right">{gnum(h.closePrice, dg(h.symbol))}</td>
                    <td className="px-2 py-1 text-right" style={{ color: h.sl ? "#f43f5e" : "var(--muted)" }}>{h.sl ? gnum(h.sl, dg(h.symbol)) : "—"}</td>
                    <td className="px-2 py-1 text-right" style={{ color: h.tp ? "#10b981" : "var(--muted)" }}>{h.tp ? gnum(h.tp, dg(h.symbol)) : "—"}</td>
                    <td className="px-2 py-1"><span style={{ color: rc, fontWeight: r !== "MANUAL" ? 600 : "normal" }}>{r === "MANUAL" ? "—" : r}</span></td>
                    <td className="px-2 py-1 text-right" style={{ color: h.pnl >= 0 ? BUY : SELL }}>{(h.pnl >= 0 ? "+$" : "-$") + fmt(Math.abs(h.pnl))}</td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "summary" && (() => {
            // By direction
            const buys = positions.filter((p) => p.type === "BUY");
            const sells = positions.filter((p) => p.type === "SELL");
            const buyPnl = buys.reduce((a: number, p: any) => a + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
            const sellPnl = sells.reduce((a: number, p: any) => a + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
            const buyLots = buys.reduce((a: number, p: any) => a + Number(p.lots), 0);
            const sellLots = sells.reduce((a: number, p: any) => a + Number(p.lots), 0);
            // By symbol
            const symMap: Record<string, { buy: number; sell: number; lots: number; pnl: number }> = {};
            for (const p of positions) {
              const s = p.symbol; if (!symMap[s]) symMap[s] = { buy: 0, sell: 0, lots: 0, pnl: 0 };
              const pl = pnlOf(p, prices[s] ?? p.openPrice, csz(s));
              symMap[s].lots += Number(p.lots); symMap[s].pnl += pl;
              if (p.type === "BUY") symMap[s].buy += Number(p.lots);
              else symMap[s].sell += Number(p.lots);
            }
            const symRows = Object.entries(symMap).sort((a, b) => Math.abs(b[1].pnl) - Math.abs(a[1].pnl));
            return (
              <div className="p-3 text-[10px]">
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([["BALANCE", fmt(balance), "var(--text)"], ["EQUITY", fmt(equity), "var(--text)"], ["FLOATING P/L", fmt(floating), floating >= 0 ? BUY : SELL], ["CLOSED P/L", fmt(Number(account?.pnl || 0)), Number(account?.pnl || 0) >= 0 ? BUY : SELL], ["DEPOSITS", fmt(Number(account?.deposit || 0)), BUY], ["WITHDRAWALS", "-" + fmt(Number(account?.withdrawal || 0)), SELL], ["FREE MARGIN", fmt(free), "var(--text)"], ["MARGIN LEVEL", level ? level.toFixed(1) + "%" : "—", GOLD]] as [string, string, string][]).map(([k, v, c]) => (
                    <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{k}</div><div className="mt-1 text-sm font-bold tabular-nums" style={{ color: c }}>{v}</div></div>
                  ))}
                </div>
                <div className="mb-3">
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>By Direction</div>
                  <table className="w-full">
                    <thead><tr className="text-[var(--muted)]"><th className="py-1 pr-3 text-left font-normal">Direction</th><th className="py-1 pr-3 text-right font-normal">Trades</th><th className="py-1 pr-3 text-right font-normal">Lots</th><th className="py-1 text-right font-normal">Floating P/L</th></tr></thead>
                    <tbody>
                      <tr className="border-t border-[var(--border)]">
                        <td className="py-1 pr-3 font-semibold" style={{ color: BUY }}>BUY</td>
                        <td className="py-1 pr-3 text-right">{buys.length}</td>
                        <td className="py-1 pr-3 text-right">{buyLots.toFixed(2)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: buyPnl >= 0 ? BUY : SELL }}>{(buyPnl >= 0 ? "+$" : "-$") + fmt(Math.abs(buyPnl))}</td>
                      </tr>
                      <tr className="border-t border-[var(--border)]">
                        <td className="py-1 pr-3 font-semibold" style={{ color: SELL }}>SELL</td>
                        <td className="py-1 pr-3 text-right">{sells.length}</td>
                        <td className="py-1 pr-3 text-right">{sellLots.toFixed(2)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: sellPnl >= 0 ? BUY : SELL }}>{(sellPnl >= 0 ? "+$" : "-$") + fmt(Math.abs(sellPnl))}</td>
                      </tr>
                      <tr className="border-t-2 border-[var(--border)]">
                        <td className="py-1 pr-3 font-semibold">Total</td>
                        <td className="py-1 pr-3 text-right">{positions.length}</td>
                        <td className="py-1 pr-3 text-right">{(buyLots + sellLots).toFixed(2)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: floating >= 0 ? BUY : SELL }}>{(floating >= 0 ? "+$" : "-$") + fmt(Math.abs(floating))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {symRows.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>By Symbol</div>
                    <table className="w-full">
                      <thead><tr className="text-[var(--muted)]"><th className="py-1 pr-3 text-left font-normal">Symbol</th><th className="py-1 pr-3 text-right font-normal">Buy L</th><th className="py-1 pr-3 text-right font-normal">Sell L</th><th className="py-1 pr-3 text-right font-normal">Total L</th><th className="py-1 text-right font-normal">Floating P/L</th></tr></thead>
                      <tbody>
                        {symRows.map(([sym, v]) => (
                          <tr key={sym} className="border-t border-[var(--border)]">
                            <td className="py-1 pr-3 font-medium">{sym}</td>
                            <td className="py-1 pr-3 text-right" style={{ color: BUY }}>{v.buy > 0 ? v.buy.toFixed(2) : "—"}</td>
                            <td className="py-1 pr-3 text-right" style={{ color: SELL }}>{v.sell > 0 ? v.sell.toFixed(2) : "—"}</td>
                            <td className="py-1 pr-3 text-right">{v.lots.toFixed(2)}</td>
                            <td className="py-1 text-right font-semibold" style={{ color: v.pnl >= 0 ? BUY : SELL }}>{(v.pnl >= 0 ? "+$" : "-$") + fmt(Math.abs(v.pnl))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {positions.length === 0 && <div className="py-4 text-center" style={{ color: "var(--muted)" }}>No open positions to summarize.</div>}
              </div>
            );
          })()}
          {botTab === "requests" && (
            <div className="p-3 text-[11px]">
              {!myReqsLoaded ? (
                <div className="py-4 text-center text-[var(--muted)]">Loading…</div>
              ) : myReqs.length === 0 ? (
                <div className="py-4 text-center text-[var(--muted)]">No requests yet.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[var(--muted)]">
                      <th className="px-2 py-1 font-normal">Type</th>
                      <th className="px-2 py-1 font-normal text-right">Amount</th>
                      <th className="px-2 py-1 font-normal">Method</th>
                      <th className="px-2 py-1 font-normal">Status</th>
                      <th className="px-2 py-1 font-normal">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myReqs.map((r: any) => {
                      const isAcc = r.kind === "ACCOUNT";
                      return (
                        <tr key={r.id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 font-medium">
                            <span style={{ color: isAcc ? "#3b82f6" : r.kind === "DEPOSIT" ? BUY : SELL }}>
                              <i className={"fa-solid mr-1 " + (isAcc ? "fa-circle-plus" : r.kind === "DEPOSIT" ? "fa-arrow-down" : "fa-arrow-up")} />
                              {isAcc ? `New ${r.type === "DEMO" ? "Demo" : "Live"} Account` : r.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right font-semibold tabular-nums">{isAcc ? <span className="text-[var(--muted)]">1:{r.leverage}</span> : "$" + gmoney(r.amount)}</td>
                          <td className="px-2 py-1 text-[var(--muted)]">{isAcc ? r.currency : (r.method || "—")}</td>
                          <td className="px-2 py-1">
                            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: r.status === "APPROVED" ? "rgba(22,163,74,0.15)" : r.status === "REJECTED" ? "rgba(220,38,38,0.15)" : "rgba(240,180,41,0.15)", color: r.status === "APPROVED" ? BUY : r.status === "REJECTED" ? SELL : GOLD }}>{r.status}</span>
                          </td>
                          <td className="px-2 py-1 text-[var(--muted)]">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {stmtRep && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="ui-pop w-[340px] max-w-[95vw] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold">Statement / Report</div>
            <div className="mb-3 text-[10px]" style={{ color: "var(--muted)" }}>{curAcct?.login} · {curAcct?.type}</div>
            <div className="mb-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Date Range</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["day", "week", "month", "year", "all", "custom"] as const).map((p) => (
                <button key={p} onClick={() => { setRepPreset(p); setRepMsg(""); if (p !== "custom") { const now = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10); if (p === "day") { const dd = iso(now); setRepFrom(dd); setRepTo(dd); } else if (p === "week") { const f = new Date(now); f.setDate(now.getDate() - 7); setRepFrom(iso(f)); setRepTo(iso(now)); } else if (p === "month") { const y = now.getFullYear(), m = now.getMonth(); setRepFrom(new Date(y, m, 1).toISOString().slice(0, 10)); setRepTo(new Date(y, m + 1, 0).toISOString().slice(0, 10)); } else if (p === "year") { const y = now.getFullYear(); setRepFrom(`${y}-01-01`); setRepTo(`${y}-12-31`); } else { setRepFrom(""); setRepTo(""); } } }} className="rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize" style={{ background: repPreset === p ? BUY : "var(--soft)", color: repPreset === p ? "#04140e" : "var(--text)", border: "1px solid " + (repPreset === p ? "transparent" : "var(--border)") }}>{p === "all" ? "All Time" : p}</button>
              ))}
            </div>
            {repPreset === "custom" && (
              <div className="mb-3 flex gap-2">
                <input type="date" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} className="flex-1 rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                <input type="date" value={repTo} onChange={(e) => setRepTo(e.target.value)} className="flex-1 rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
            )}
            <div className="mb-2 text-[9px]" style={{ color: "var(--muted)" }}>Email is sent to your registered address ({account?.email || "—"}) as no-reply.</div>
            {repMsg && <div className="mb-2 text-[10px]" style={{ color: repMsg.startsWith("✓") ? "#16a34a" : "#ef4444" }}>{repMsg}</div>}
            <div className="flex gap-2">
              <button onClick={() => setStmtRep(false)} className="flex-1 rounded border py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Close</button>
              <button onClick={() => { const q = new URLSearchParams({ accountId: accId || "" }); if (repFrom) q.set("from", repFrom); if (repTo) q.set("to", repTo); window.open("/api/client/statement?" + q.toString(), "_blank"); }} className="flex-1 rounded py-2 text-[11px] font-semibold" style={{ background: "#ef4444", color: "#fff" }}><i className="fa-solid fa-file-pdf mr-1" /> Download</button>
              <button disabled={repSending} onClick={async () => {
                setRepSending(true); setRepMsg("");
                const r = await fetch("/api/client/statement/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: accId, from: repFrom || undefined, to: repTo || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false }));
                setRepSending(false);
                setRepMsg(r.ok ? "✓ Sent to " + r.to : (r.error || "Failed to send"));
              }} className="flex-1 rounded py-2 text-[11px] font-semibold disabled:opacity-60" style={{ background: BUY, color: "#04140e" }}><i className="fa-solid fa-envelope mr-1" /> {repSending ? "…" : "Email"}</button>
            </div>
          </div>
        </div>
      )}
      {walletModal && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-auto p-4 sm:items-center" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop w-full max-w-2xl rounded-xl bg-[var(--panel)] text-[var(--text)] p-5 shadow-2xl" style={{ ["--foreground" as any]: "var(--text)", "--card": "var(--soft)", "--card-foreground": "var(--text)", "--background": "var(--bg)", "--secondary": "var(--soft)", "--secondary-foreground": "var(--text)", "--muted-foreground": "var(--muted)" } as any} onClick={(e) => e.stopPropagation()}>
            <WalletPanel key={walletModal} accountId={accId} initialTab={walletModal} tabs={walletModal === "kyc" ? ["kyc"] : ["deposit", "withdraw"]} onClose={() => setWalletModal(null)} />
          </div>
        </div>
      )}
      {pinModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="ui-pop w-[300px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{pinHasPin ? "Change PIN" : "Set PIN"}</div>
              <button onClick={() => setPinModal(false)} aria-label="Close" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            {pinHasPin && (<><div className="text-[10px] text-[var(--muted)]">Current PIN</div><input type="password" inputMode="numeric" value={pinForm.current || ""} onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })} className="mb-2 mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-center text-[var(--text)]" /></>)}
            <div className="text-[10px] text-[var(--muted)]">New PIN (4-6 digits)</div>
            <input type="password" inputMode="numeric" value={pinForm.pin || ""} onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-center text-[var(--text)]" />
            {pinErr && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{pinErr}</div>}
            <button onClick={savePin} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Save PIN</button>
          </div>
        </div>
      )}
      {pinLock && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ background: "rgba(5,9,16,0.96)" }}>
          <div className="ui-pop w-[300px] rounded-xl border p-5 text-center" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            <div className="mb-1 text-sm font-semibold">Enter your PIN</div>
            <div className="mb-3 text-[10px] text-[var(--muted)]">This terminal is locked.</div>
            <input type="password" inputMode="numeric" autoFocus value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") unlock(); }} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center text-lg tracking-widest text-[var(--text)]" />
            {pinErr && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{pinErr}</div>}
            <button onClick={unlock} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Unlock</button>
            <button onClick={unlockPasskey} className="mt-2 w-full rounded border border-[var(--border)] py-2 text-xs">Unlock with passkey</button>
          </div>
        </div>
      )}
      {xferModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: "rgba(5,9,16,0.7)" }}>
          <div className="ui-pop w-[320px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold">Transfer Between Accounts</div>
            <div className="text-[10px] text-[var(--muted)]">From</div>
            <select value={xfer.fromId || accId} onChange={(e) => setXfer({ ...xfer, fromId: e.target.value })} className="mb-2 mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)]">{accts.map((a) => <option key={a.id} value={a.id}>{a.login} - {a.type}</option>)}</select>
            <div className="text-[10px] text-[var(--muted)]">To</div>
            <select value={xfer.toId || ""} onChange={(e) => setXfer({ ...xfer, toId: e.target.value })} className="mb-2 mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)]"><option value="">Select account</option>{accts.map((a) => <option key={a.id} value={a.id}>{a.login} - {a.type}</option>)}</select>
            {(() => { const xf = accts.find((a: any) => a.id === (xfer.fromId || accId)); const av = xf ? (pnlOnly ? Math.max(0, Number(xf.pnl || 0)) : (Number(xf.deposit || 0) - Number(xf.withdrawal || 0) + Number(xf.credit || 0) + Number(xf.bonus || 0) + Number(xf.pnl || 0))) : 0; return (
              <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-[var(--muted)]">Available {pnlOnly ? "(profit only)" : "balance"}</span><button type="button" onClick={() => setXfer({ ...xfer, amount: String(av.toFixed(2)) })} className="font-semibold" style={{ color: "#22d3ee" }}>${fmt(av)} · Use max</button></div>
            ); })()}
            <div className="text-[10px] text-[var(--muted)]">Amount</div>
            <input type="number" value={xfer.amount || ""} onChange={(e) => setXfer({ ...xfer, amount: e.target.value })} className="mb-2 mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]" />
            {xferErr && <div className="mb-2 text-[10px]" style={{ color: SELL }}>{xferErr}</div>}
            <div className="flex gap-2"><button onClick={() => setXferModal(false)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button><button onClick={doTransfer} className="flex-1 rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Transfer</button></div>
          </div>
        </div>
      )}
      {dragging && <div className="fixed inset-0 z-[60]" />}
    </div>
  );
}
