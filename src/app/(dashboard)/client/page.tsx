"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import LWChart from "@/components/LWChart";
import { playSound, soundForNotification } from "@/lib/sounds";
import PriceCell from "@/components/PriceCell";
import toast from "react-hot-toast";
import WalletPanel from "@/components/WalletPanel";
import { titleCaseName } from "@/lib/format";
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
  const [chartInd, setChartInd] = useState({ sma: false, ema: false, bb: false, rsi: false, macd: false });
  const [pnlOnly, setPnlOnly] = useState(false);
  const [mwSearch, setMwSearch] = useState("");
  const [chartTool, setChartTool] = useState<"none" | "hline" | "trend">("none");
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
  useEffect(() => { if (botTab === "requests" && !myReqsLoaded) { fetch("/api/client/payments").then((r) => r.json()).then((d) => { if (d.ok) setMyReqs(d.requests || []); setMyReqsLoaded(true); }).catch(() => setMyReqsLoaded(true)); } }, [botTab, myReqsLoaded]);
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
  const [rtW, setRtW] = useState(250);
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
  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);

  const selSymRef = useRef(selSym);
  useEffect(() => { selSymRef.current = selSym; }, [selSym]);
  // Remember last symbol / timeframe / indicators across refreshes.
  useEffect(() => {
    try { const sv = JSON.parse(localStorage.getItem("cubex-client-setup") || "null"); if (sv) { if (sv.selSym) setSelSym(sv.selSym); if (sv.tf) setTf(sv.tf); if (sv.chartInd) setChartInd(sv.chartInd); } } catch {}
  }, []);
  useEffect(() => { if (!selSym) return; try { localStorage.setItem("cubex-client-setup", JSON.stringify({ selSym, tf, chartInd })); } catch {} }, [selSym, tf, chartInd]);
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
    if (!selSymRef.current && d.symbols.length) setSelSym(d.symbols[0].symbol);
    fetch("/api/client/accounts").then((r) => r.json()).then((ad) => { if (ad.ok) { setAccts(ad.accounts || []); if (!accIdRef.current && ad.accounts && ad.accounts.length) { accIdRef.current = ad.accounts[0].id; setAccId(ad.accounts[0].id); } } }).catch((e) => console.warn("[client] accounts fetch failed", e));
    loadNotifs();
    fetch("/api/client/pending?accountId=" + (accIdRef.current || "")).then((r) => r.json()).then((pd) => { if (pd.ok) setPending(pd.pending || []); }).catch(() => {});
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
    pushToast({ title: "Trade closed" + (d.pnl != null ? ` · P/L $${Number(d.pnl).toFixed(2)}` : ""), type: "TRADE" }); load();
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
    if (account?.locked) { toast.error("Your account is read-only. Cannot create new accounts."); return; }
    const tid = toast.loading(`Opening ${type === "LIVE" ? "live" : "demo"} account…`);
    const r = await fetch("/api/client/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { toast.error(r.error || "Failed to open account", { id: tid }); setErr(r.error || "Failed"); return; }
    toast.success(`${type === "LIVE" ? "Live" : "Demo"} account ${r.account?.login || ""} created`, { id: tid });
    if (r.account) { accIdRef.current = r.account.id; setAccId(r.account.id); }
    load();
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
  const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const groups: Record<string, any[]> = {};
  const mwq = mwSearch.trim().toLowerCase();
  symbols.filter((s) => !mwq || (s.symbol + " " + (s.display || "")).toLowerCase().includes(mwq)).forEach((s) => { const c = s.category || "other"; (groups[c] || (groups[c] = [])).push(s); });
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const orderedGroups = Object.entries(groups).sort((a, b) => { const ia = CAT_ORDER.indexOf(a[0]); const ib = CAT_ORDER.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
  const histShown = history.filter((h: any) => { if (histRange === "all") return true; const t = new Date(h.closedAt).getTime(); const now = Date.now(); const day = 86400000; if (histRange === "today") return t >= now - day; if (histRange === "week") return t >= now - 7 * day; return t >= now - 30 * day; });
  const tab = (active: boolean) => "px-3 py-1.5 text-[11px] " + (active ? "" : "text-[var(--muted)]");

  // Client uses the app UI on every device (no separate desktop terminal) — it's
  // rendered as a centered phone-width column on larger screens.
  return <ClientMobile t={{ theme, brand, account, accts, accId, pnlOnly, readOnly, needKyc, openKyc: () => setWalletModal("kyc"), positions, pending, history, financials, notis, symbols, prices, dirs, selSym, vol, orderType, pendingPrice, sl, tp, err, balance, equity, floating, free, used, level, price, bid, ask, d, tf, TFS, setSelSym, setVol, setSl, setTp, setOrderType, setPendingPrice, setTf, place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr, toggleTheme, enablePush, disablePush, addPasskey, openPin: () => { setPinErr(""); setPinForm({}); setPinModal(true); }, favs, toggleFav, avatarUrl, uploadAvatar, fmt, csz, pnlOf, dg, markAllNotifsRead, logout: async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }, pin: { pinLock, pinInput, setPinInput, pinErr, unlock, unlockPasskey, pinModal, setPinModal, pinHasPin, setPinHasPin, pinForm, setPinForm, savePin, disablePin: async () => { if (!confirm("Disable PIN? You will no longer need a PIN to open the app.")) return; const r = await fetch("/api/client/pin", { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false })); if (r.ok) { setPinHasPin(false); sessionStorage.removeItem("cubex-pin-ok"); } } }, cToasts, pushToast, dismissToasts: () => setCToasts([]) }} />;
}
