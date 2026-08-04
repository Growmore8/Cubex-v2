"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import { io, Socket } from "socket.io-client";
import KLineProChart from "@/components/KLineProChart";
import { playSound, soundForNotification } from "@/lib/sounds";
import PriceCell from "@/components/PriceCell";
import toast from "react-hot-toast";
import WalletPanel from "@/components/WalletPanel";
import ClientSplash from "@/components/ClientSplash";
import { SymIcon } from "@/lib/symIcon";
import { titleCaseName, gnum, gmoney, currencySymbol } from "@/lib/format";
import { COUNTRIES } from "@/config/countries";
import { iconForNotification } from "@/lib/notif";
import instruments from "@/config/instruments";
import { contractFor } from "@/config/contracts";
import ClientMobile from "@/components/ClientMobile";
import DomPanel from "@/components/DomPanel";

// ADSS palette (matches the admin desk) — fixed, not tenant colour.
const DARK: any = { "--bg": "#0a0d12", "--panel": "#11151d", "--border": "#1c2330", "--text": "#e7ecf3", "--muted": "#8a93a6", "--soft": "#151b25", "--accent": "#16c79a" };
const LIGHT: any = { "--bg": "#f3f5f9", "--panel": "#ffffff", "--border": "#e6eaf0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f6", "--accent": "#0f9d77" };
const BUY = "#26a69a", SELL = "#ef5350", GOLD = "#0078d7";
const LOTS = [0.01, 0.05, 0.1, 0.5, 1];
const TFS = ["1M", "5M", "15M", "30M", "1H", "4H", "1D"];
const INDS: [string, string][] = [["RSI", "RSI@tv-basicstudies"], ["MACD", "MACD@tv-basicstudies"], ["Stoch", "Stochastic@tv-basicstudies"], ["BBands", "BB@tv-basicstudies"], ["MA", "MASimple@tv-basicstudies"], ["ROC", "ROC@tv-basicstudies"]];

const DIGITS: Record<string, number> = {};
function dg(sym: string, f = 2) { return DIGITS[sym] ?? instruments[sym]?.digits ?? f; }
function effectiveDg(configDigits: number, price: number | undefined): number {
  if (price == null || price <= 0 || price >= 1) return configDigits;
  const minD = Math.ceil(1 - Math.log10(price * 0.001));
  return Math.max(configDigits, Math.min(minD, 8));
}
// Same rule as server's pipForDigits: for instruments with ≥3 decimal places (forex)
// pip = 10^-(digits-1); for 2-decimal instruments (metals, high-priced crypto) pip = 10^-digits.
function pipOf(digits: number): number {
  return digits >= 3 ? Math.pow(10, -(digits - 1)) : Math.pow(10, -digits);
}
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
  const [creditRequest, setCreditRequest] = useState<any>(null);
  const [creditLocked, setCreditLocked] = useState(false);
  const [instantCreditModal, setInstantCreditModal] = useState(false);
  const [icAmount, setIcAmount] = useState("500");
  const [icNote, setIcNote] = useState("");
  const [icErr, setIcErr] = useState("");
  const [icMsg, setIcMsg] = useState("");
  const [icSending, setIcSending] = useState(false);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: "", logoUrl: null });
  // Branded loading splash: fast brand fetch for the logo/slogan, hidden once the
  // first account/prices load completes.
  const [splashBrand, setSplashBrand] = useState<any>(null);
  const [dataReady, setDataReady] = useState(false); // first account/prices loaded
  const [minElapsed, setMinElapsed] = useState(false); // 3s branding minimum
  const [splashGone, setSplashGone] = useState(false);
  const [tenantSuspended, setTenantSuspended] = useState(false);
  const booted = dataReady && minElapsed; // start fade only when both are true
  const [kycVerified, setKycVerified] = useState(true); // assume ok until /account resolves
  const [swapEnabled, setSwapEnabled] = useState(true);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
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
  const [symbolSpreads, setSymbolSpreads] = useState<Record<string, { min: number; max: number; type: string }>>({});
  const [groupSpread, setGroupSpread] = useState(0);
  const [accountSpreadMarkup, setAccountSpreadMarkup] = useState(0);
  const [fxRate, setFxRate] = useState(1); // USD per 1 unit of account currency (1.0 for USD)
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [liveSpreadPips, setLiveSpreadPips] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [spreadDirs, setSpreadDirs] = useState<Record<string, number>>({});
  const notifSeen = useRef<Set<string>>(new Set());
  const notifPrimed = useRef(false);
  const prevLevelRef = useRef<number | null>(null);
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
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">("MARKET");
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
  const [comment, setComment] = useState("");
  const [stopLimitType, setStopLimitType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">("MARKET");
  const [stopLimitEntry, setStopLimitEntry] = useState(""); // stop limit trigger price
  const [partialClose, setPartialClose] = useState<{ id: string; sym: string; lots: number; closeLots: string } | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertModal, setAlertModal] = useState(false);
  const [alertForm, setAlertForm] = useState({ condition: "ABOVE", price: "", note: "" });
  const loadAlerts = () => fetch("/api/client/alerts?accountId=" + (accIdRef.current || "")).then((r) => r.json()).then((d) => { if (d.ok) { setAlerts(d.alerts); setAlertsLoaded(true); } }).catch(() => {});
  useEffect(() => { if (accId) loadAlerts(); }, [accId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rightTab, setRightTab] = useState<"TRADE"|"SIGNALS"|"NEWS"|"CALENDAR"|"ANALYTICS"|"DOM">("TRADE");
  const [signals, setSignals] = useState<any[]>([]);
  const [signalsLoaded, setSignalsLoaded] = useState(false);
  const [calendar, setCalendar] = useState<any[]>([]);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calImpact, setCalImpact] = useState<"all" | "high" | "medium" | "low">("all");
  const [calTick, setCalTick] = useState(0);
  const [oneClick, setOneClick] = useState(false);
  const mwSearchRef = useRef<HTMLInputElement>(null);
  const volInputRef  = useRef<HTMLInputElement>(null);
  useEffect(() => { try { setOneClick(localStorage.getItem("cubex-1click") === "1"); } catch {} }, []);
  function toggleOneClick() { setOneClick((v) => { const n = !v; try { localStorage.setItem("cubex-1click", n ? "1" : "0"); } catch {} return n; }); }
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
  const [tpSlEdit, setTpSlEdit] = useState<{ id: string; field: "tp" | "sl" | "trailingStop"; val: string } | null>(null);
  const [posCtx, setPosCtx] = useState<{ x: number; y: number; pos: any } | null>(null);
  const [err, setErr] = useState("");
  // Auto-clear inline trade errors after 5 seconds so they never stick permanently.
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(""), 5000); return () => clearTimeout(t); }, [err]);
  const [pinLock, setPinLock] = useState(false);
  const [pinHasPin, setPinHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinModal, setPinModal] = useState(false);
  const [pinForm, setPinForm] = useState<any>({});
  const [pinErr, setPinErr] = useState("");
  const [notis, setNotis] = useState<any[]>([]);
  const [pendingPrice, setPendingPrice] = useState("");
  const [gtdExpiry, setGtdExpiry] = useState("");
  const [pending, setPending] = useState<any[]>([]);
  const [pendEdit, setPendEdit] = useState<{ id: string; price: string; sl: string; tp: string } | null>(null);
  const [notiOpen, setNotiOpen] = useState(false);
  const [acctSwitchOpen, setAcctSwitchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mwW, setMwW] = useState(295);
  const [rtW, setRtW] = useState(280);
  const [tbH, setTbH] = useState(200);
  const [dragging, setDragging] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [newsLoaded, setNewsLoaded] = useState(false);
  const [indicators, setIndicators] = useState<string[]>([]);
  function toggleInd(id: string) { setIndicators((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]); }
  const [dailyOpen, setDailyOpen] = useState<Record<string, number>>({});
  const dailyOpenRef = useRef<Record<string, number>>({});
  const [analyticsRange, setAnalyticsRange] = useState<"today" | "week" | "month" | "all">("all");
  const alertsRef = useRef<any[]>([]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  const pendingRef = useRef<any[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const [histRange, setHistRange] = useState<"all" | "today" | "week" | "month">("all");
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNowMs(Date.now()), 10000); return () => clearInterval(iv); }, []);
  const [symInfoOpen, setSymInfoOpen] = useState(false);
  // Per-table column sort (1st click asc, 2nd desc, 3rd clears).
  const [sortBy, setSortBy] = useState<Record<string, { k: string; d: 1 | -1 }>>({});
  const toggleSort = (tbl: string, k: string) => setSortBy((s) => { const cur = s[tbl]; if (!cur || cur.k !== k) return { ...s, [tbl]: { k, d: 1 } }; if (cur.d === 1) return { ...s, [tbl]: { k, d: -1 } }; const n = { ...s }; delete n[tbl]; return n; });
  const sortRows = (tbl: string, rows: any[], acc: Record<string, (r: any) => any>) => { const cfg = sortBy[tbl]; if (!cfg || !acc[cfg.k]) return rows; const get = acc[cfg.k]; return [...rows].sort((a, b) => { const va = get(a), vb = get(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; if (typeof va === "number" && typeof vb === "number") return (va - vb) * cfg.d; return String(va).localeCompare(String(vb), undefined, { numeric: true }) * cfg.d; }); };
  const Sth = ({ tbl, k, label, align, cls }: { tbl: string; k: string; label: any; align?: "right"; cls?: string }) => { const cfg = sortBy[tbl]; const active = !!cfg && cfg.k === k; return (<th className={(cls || "px-2 py-1 font-normal") + (align === "right" ? " text-right" : " text-left") + " cursor-pointer select-none"} onClick={() => toggleSort(tbl, k)}><span className={"inline-flex items-center gap-1 " + (align === "right" ? "flex-row-reverse" : "")}>{label}<i className={"fa-solid text-[8px] " + (active ? (cfg!.d === 1 ? "fa-arrow-up-long" : "fa-arrow-down-long") : "fa-sort")} style={{ opacity: active ? 1 : 0.3 }} /></span></th>); };
  useEffect(() => { if (rightTab === "NEWS" && !newsLoaded) { fetch("/api/client/news?category=forex").then((r) => r.json()).then((dd) => { if (dd.ok) { setNews(dd.items || []); setNewsLoaded(true); } }).catch(() => { setNewsLoaded(true); }); } }, [rightTab, newsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab === "CALENDAR" && !calendarLoaded) { fetch("/api/client/calendar").then((r) => r.json()).then((dd) => { if (dd.ok) { setCalendar(dd.events || []); setCalendarLoaded(true); } }).catch(() => {}); } }, [rightTab, calendarLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tick every second while calendar is open so countdown timers refresh live.
  useEffect(() => {
    if (rightTab !== "CALENDAR") return;
    const t = setInterval(() => setCalTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [rightTab]);
  useEffect(() => { if (rightTab === "SIGNALS" && !signalsLoaded) { fetch("/api/client/signals").then((r) => r.json()).then((dd) => { if (dd.ok) { setSignals(dd.signals || []); setSignalsLoaded(true); } }).catch(() => { setSignalsLoaded(true); }); } }, [rightTab, signalsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/client/avatar").then((r) => r.json()).then((d) => { if (d.ok) setAvatarUrl(d.avatarUrl || ""); }).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/auth/totp/status").then((r) => r.json()).then((d) => { if (d.ok) setDeskTotpEnabled(d.totpEnabled); }).catch(() => {}); }, []);
  async function deskOpenTotpSetup() {
    setDeskTotpErr(""); setDeskTotpCode(""); setDeskTotpQr(""); setDeskTotpSecret(""); setDeskTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/setup").then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setDeskTotpQr(r.qrDataUrl); setDeskTotpSecret(r.secret); setDeskTotpModal("setup");
    } catch (e: any) { setDeskTotpErr(e.message || "Failed"); }
    finally { setDeskTotpBusy(false); }
  }
  async function deskConfirmTotpEnable() {
    setDeskTotpErr(""); setDeskTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: deskTotpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setDeskTotpEnabled(true); setDeskTotpModal(null);
    } catch (e: any) { setDeskTotpErr(e.message || "Invalid code"); }
    finally { setDeskTotpBusy(false); }
  }
  async function deskConfirmTotpDisable() {
    setDeskTotpErr(""); setDeskTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: deskTotpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setDeskTotpEnabled(false); setDeskTotpModal(null);
    } catch (e: any) { setDeskTotpErr(e.message || "Invalid code"); }
    finally { setDeskTotpBusy(false); }
  }
  async function uploadAvatar(e: any) { const file = e.target.files && e.target.files[0]; if (!file) return; setAvatarUploading(true); const fd = new FormData(); fd.append("file", file); const r = await fetch("/api/client/avatar", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false })); setAvatarUploading(false); if (r.ok && r.avatarUrl) setAvatarUrl(r.avatarUrl); else toast.error(r.error || "Avatar upload failed"); }
  const [profileOpen, setProfileOpen] = useState(false);
  const [refData, setRefData] = useState<any>(null);
  const [refCopied, setRefCopied] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [deskTotpEnabled, setDeskTotpEnabled] = useState(false);
  const [deskTotpModal, setDeskTotpModal] = useState<"setup" | "disable" | null>(null);
  const [deskTotpQr, setDeskTotpQr] = useState("");
  const [deskTotpSecret, setDeskTotpSecret] = useState("");
  const [deskTotpCode, setDeskTotpCode] = useState("");
  const [deskTotpBusy, setDeskTotpBusy] = useState(false);
  const [deskTotpErr, setDeskTotpErr] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", phone: "", country: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [profilePrompted, setProfilePrompted] = useState(false);
  function openProfileEdit() { setProfileForm({ name: account?.ownerName || account?.name || "", phone: account?.phone || "", country: account?.country || "" }); setProfileErr(""); setProfileModal(true); }
  async function saveProfile() {
    setProfileSaving(true); setProfileErr("");
    const r = await fetch("/api/client/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileForm) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setProfileSaving(false);
    if (!r.ok) { setProfileErr(r.error || "Update failed"); return; }
    setProfileModal(false);
    load();
  }
  useEffect(() => {
    if (account && !profilePrompted && (!(account.ownerName || account.name) || !account.phone || !account.country)) {
      setProfilePrompted(true);
      setProfileForm({ name: account?.ownerName || account?.name || "", phone: account?.phone || "", country: account?.country || "" });
      setProfileErr("");
      setProfileModal(true);
    }
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps
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
      if (d.code === "TENANT_SUSPENDED") { setTenantSuspended(true); setDataReady(true); return; }
      setErr(d.error || "Failed"); return;
    }
    setAccount(d.account); setKycVerified(!!d.kycVerified); setSwapEnabled(d.swapEnabled !== false); setPositions(d.positions); setHistory(d.history); setFinancials(d.financials || []); setSymbols(d.symbols); setPnlOnly(!!d.pnlOnly); if (d.brand) setBrand(d.brand); if (d.symbolSpreads) setSymbolSpreads(d.symbolSpreads); if (d.groupSpread != null) setGroupSpread(Number(d.groupSpread)); if (d.accountSpreadMarkup != null) setAccountSpreadMarkup(Number(d.accountSpreadMarkup)); if (d.fxRate != null) setFxRate(Number(d.fxRate) || 1);
    setCreditRequest(d.creditRequest || null); setCreditLocked(!!d.creditLocked);
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
    fetch("/api/client/signals").then((r) => r.json()).then((d) => { if (d.ok) { setSignals(d.signals || []); setSignalsLoaded(true); } }).catch(() => {});
  }
  async function markAllNotifsRead() {
    await fetch("/api/client/notifications", { method: "POST" }).catch(() => {});
    loadNotifs();
  }
  useEffect(() => { load(); }, []);
  // Fast brand fetch so the splash shows the logo/slogan immediately.
  useEffect(() => { fetch("/api/public/brand").then((r) => r.json()).then((b) => { if (b.ok) setSplashBrand(b); }).catch(() => {}); }, []);
  // Check trial status to hide account-creation options on demo tenants.
  useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then((d) => { if (!d.ok) return; if (d.trial) setIsTrial(true); if (d.features) setFeatures(d.features); }).catch(() => {}); }, []);
  // Load referral data when profile panel opens (only if referralProgram is enabled).
  useEffect(() => {
    if (profileOpen && features.referralProgram !== false && !refData) {
      fetch("/api/client/referral").then((r) => r.json()).then((d) => { if (d.ok) setRefData(d); }).catch(() => {});
    }
  }, [profileOpen, features.referralProgram]); // eslint-disable-line react-hooks/exhaustive-deps
  // If the current right-tab becomes feature-gated (SA disabled it), fall back to TRADE.
  useEffect(() => {
    if (rightTab === "SIGNALS"   && features.copyTrading       === false) setRightTab("TRADE");
    if (rightTab === "NEWS"      && features.marketNewsFeed    === false) setRightTab("TRADE");
    if (rightTab === "CALENDAR"  && features.economicCalendar  === false) setRightTab("TRADE");
    if (rightTab === "ANALYTICS" && features.advancedAnalytics === false) setRightTab("TRADE");
  }, [features]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the splash up for at least 3s (branding), regardless of how fast data loads.
  useEffect(() => { const t = setTimeout(() => setMinElapsed(true), 3000); return () => clearTimeout(t); }, []);
  // Once booted (data ready AND 3s elapsed), fade the splash out then unmount it.
  useEffect(() => { if (!booted) return; const t = setTimeout(() => setSplashGone(true), 480); return () => clearTimeout(t); }, [booted]);
  useEffect(() => { fetch("/api/client/pin").then((r) => r.json()).then((d) => { if (d.ok && d.hasPin) { setPinHasPin(true); if (sessionStorage.getItem("cubex-pin-ok") !== "1") setPinLock(true); } }).catch(() => {}); }, []);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    const pP: Record<string, number> = {};
    const pD: Record<string, number> = {};
    const pS: Record<string, number> = {};
    const pSD: Record<string, number> = {};
    const prevSp: Record<string, number> = {};
    const flush = () => {
      const pxKeys = Object.keys(pP), drKeys = Object.keys(pD), skKeys = Object.keys(pS), sdKeys = Object.keys(pSD);
      if (!pxKeys.length && !drKeys.length && !skKeys.length && !sdKeys.length) return;
      const px = { ...pP }, dr = { ...pD }, sp = { ...pS }, sd = { ...pSD };
      for (const k in pP) delete pP[k]; for (const k in pD) delete pD[k]; for (const k in pS) delete pS[k]; for (const k in pSD) delete pSD[k];
      // Spread pips: urgent (drives bid/ask display, must not lag)
      if (skKeys.length) setLiveSpreadPips((ss) => ({ ...ss, ...sp }));
      if (sdKeys.length) setSpreadDirs((sd2) => ({ ...sd2, ...sd }));
      // Smoothed prices + dirs: low-priority (visual animation)
      startTransition(() => {
        if (pxKeys.length) setPrices((pp) => ({ ...pp, ...px }));
        if (drKeys.length) setDirs((dd) => ({ ...dd, ...dr }));
      });
    };
    // MT5 model: price = smoothed BID (primary). real = exchange ASK (for live spread).
    // ask = price + spread, bid = price — no separate liveBids/liveAsks needed.
    socket.on("tick", ({ symbol, price, bid, real }: any) => {
      const prev = prevRef.current[symbol];
      if (prev != null && prev !== price) pD[symbol] = price > prev ? 1 : -1;
      prevRef.current[symbol] = price;
      pP[symbol] = price;
      if (!dailyOpenRef.current[symbol] && price > 0) {
        dailyOpenRef.current[symbol] = price;
        setDailyOpen((prev2) => prev2[symbol] ? prev2 : { ...prev2, [symbol]: price });
      }
      // Compute live exchange spread from real ask vs exchange bid for FLOATING display
      if (real != null && real > 0 && bid != null && bid > 0 && real > bid) {
        const d = DIGITS[symbol] ?? 2;
        const sp2 = (real - bid) / pipOf(d);
        const pv2 = prevSp[symbol];
        if (pv2 != null && sp2 !== pv2) pSD[symbol] = sp2 > pv2 ? 1 : -1;
        prevSp[symbol] = sp2;
        pS[symbol] = sp2;
      }
    });
    // Initial price snapshot on connect — seeds prices for frozen/closed markets so
    // open positions show their last P&L immediately.
    socket.on("prices", (snap: Record<string, number>) => {
      if (snap && typeof snap === "object") {
        for (const k in snap) {
          prevRef.current[k] = snap[k];
          if (!dailyOpenRef.current[k] && snap[k] > 0) dailyOpenRef.current[k] = snap[k];
        }
        startTransition(() => {
          setPrices((pp) => ({ ...snap, ...pp }));
          setDailyOpen((prev) => { const n = { ...prev }; let changed = false; for (const k in snap) { if (!n[k] && snap[k] > 0) { n[k] = snap[k]; changed = true; } } return changed ? n : prev; });
        });
      }
    });
    const flushIv = setInterval(flush, 80);
    const clr = setInterval(() => {
      setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; });
      setSpreadDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; });
    }, 650);
    socket.on("refresh", (p: any) => { if (p && p.kind === "notification") loadNotifs(); else load(); });
    // Real-time spread updates: admin changes spread → server pushes to tenant room → update instantly
    socket.on("sym-spreads", (spreads: Record<string, { min: number; max: number; type: string }>) => {
      startTransition(() => setSymbolSpreads((prev) => ({ ...prev, ...spreads })));
    });
    return () => { socket.disconnect(); clearInterval(clr); clearInterval(flushIv); };
  }, []);

  async function place(type: "BUY" | "SELL") {
    setErr("");
    if (account?.locked) { setErr("Your account is read-only (locked). Trading is disabled."); return; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return; }
    // Client-side SL/TP sanity check before sending to server
    const curBid = prices[selSym]; // prices = smoothed BID (MT5 model)
    if (curBid && orderType === "MARKET") {
      const curAsk = ask; const dd = dg(selSym);
      const slv = Number(sl) || 0; const tpv = Number(tp) || 0;
      if (slv > 0) {
        if (type === "BUY" && slv >= curAsk) { setErr(`SL must be below ask ${gnum(curAsk, dd)}`); return; }
        if (type === "SELL" && slv <= curBid) { setErr(`SL must be above bid ${gnum(curBid, dd)}`); return; }
      }
      if (tpv > 0) {
        if (type === "BUY" && tpv <= curAsk) { setErr(`TP must be above ask ${gnum(curAsk, dd)}`); return; }
        if (type === "SELL" && tpv >= curBid) { setErr(`TP must be below bid ${gnum(curBid, dd)}`); return; }
      }
    }
    if (orderType === "LIMIT" || orderType === "STOP") {
      const trig = Number(pendingPrice); if (!trig) { setErr("Enter an entry price"); return; }
      const kind = orderType;
      const rp = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side: type, lots: Number(vol), price: trig, kind, sl: Number(sl) || 0, tp: Number(tp) || 0, comment: comment || undefined, accountId: accIdRef.current, currentAsk: ask }) });
      const dp = await rp.json(); if (!dp.ok) { setErr(dp.error || "Failed"); return; }
      pushToast({ title: `${type} ${kind} ${selSym} placed`, type: "TRADE" }); setPendingPrice(""); load(); return;
    }
    if (orderType === "STOP_LIMIT") {
      const trig = Number(pendingPrice); const limit = Number(stopLimitEntry);
      if (!trig) { setErr("Enter stop price"); return; }
      if (!limit) { setErr("Enter limit price"); return; }
      const rp = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side: type, lots: Number(vol), price: trig, kind: "STOP_LIMIT", stopLimit: limit, sl: Number(sl) || 0, tp: Number(tp) || 0, comment: comment || undefined, accountId: accIdRef.current }) });
      const dp = await rp.json(); if (!dp.ok) { setErr(dp.error || "Failed"); return; }
      pushToast({ title: `${type} STOP_LIMIT ${selSym} placed`, type: "TRADE" }); setPendingPrice(""); setStopLimitEntry(""); load(); return;
    }
    try {
      const r = await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selSym, side: type, lots: Number(vol), sl: Number(sl) || 0, tp: Number(tp) || 0, trailingStop: Number(trail) || 0, comment: comment || undefined, accountId: accIdRef.current }) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Order failed"); pushToast({ title: d.error || "Order failed", type: "NOTICE" }); return; }
      pushToast({ title: `${type} ${selSym} ${vol}L opened`, type: "TRADE" });
      // Optimistic update — add position immediately so the table doesn't wait 4 s for load()
      if (d.id && d.ticket) {
        setPositions((prev) => [...prev, { id: d.id, ticket: d.ticket, symbol: d.symbol ?? selSym, type: d.type ?? type, lots: d.lots ?? vol, openPrice: d.openPrice ?? ask, sl: d.sl ?? 0, tp: d.tp ?? 0, commission: d.commission ?? 0, swap: 0, openedAt: d.openedAt ?? new Date().toISOString() }]);
      }
      load();
    } catch (e: any) {
      setErr(e?.message || "Order failed — check your connection");
      pushToast({ title: "Order failed — check your connection", type: "NOTICE" });
    }
  }
  async function quickTrade(sym: string, side: "BUY" | "SELL", lots?: number) {
    setSelSym(sym); setErr("");
    if (account?.locked) { setErr("Account is read-only."); return false; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return false; }
    try {
      const r = await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym, side, lots: Number(lots ?? vol), sl: 0, tp: 0, accountId: accIdRef.current }) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Order failed"); pushToast({ title: d.error || "Order failed", type: "NOTICE" }); return false; }
      pushToast({ title: `${side} ${sym} ${Number(lots ?? vol)}L opened`, type: "TRADE" }); load(); return true;
    } catch (e: any) { setErr(e?.message || "Order failed"); pushToast({ title: "Order failed — check connection", type: "NOTICE" }); return false; }
  }
  // Mobile/explicit pending order: kind = LIMIT | STOP
  async function placePending(sym: string, side: "BUY" | "SELL", kind: "LIMIT" | "STOP", trigger: number, lots: number, slv = 0, tpv = 0, expiresAt?: string) {
    setErr("");
    if (account?.locked) { setErr("Account is read-only."); return false; }
    if (needKyc) { setErr("Verify your KYC to trade on a live account."); setWalletModal("kyc"); return false; }
    if (!trigger || trigger <= 0) { setErr("Enter a trigger price"); return false; }
    const pBid = prices[sym] ?? 0;
    const pAsk = pBid > 0 ? pBid + _spreadPx(sym) : 0;
    if (pBid > 0) {
      // BUY pending: server triggers at ask — compare trigger vs ask
      // SELL pending: server triggers at bid — compare trigger vs bid
      if (side === "BUY"  && kind === "LIMIT" && trigger >= pAsk) { setErr("Buy Limit must be below ask " + gnum(pAsk, dg(sym))); return false; }
      if (side === "BUY"  && kind === "STOP"  && trigger <= pAsk) { setErr("Buy Stop must be above ask " + gnum(pAsk, dg(sym))); return false; }
      if (side === "SELL" && kind === "LIMIT" && trigger <= pBid) { setErr("Sell Limit must be above bid " + gnum(pBid, dg(sym))); return false; }
      if (side === "SELL" && kind === "STOP"  && trigger >= pBid) { setErr("Sell Stop must be below bid " + gnum(pBid, dg(sym))); return false; }
    }
    const r = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, side, kind, lots: Number(lots), price: trigger, sl: slv, tp: tpv, comment: comment || undefined, accountId: accIdRef.current, currentAsk: pAsk, expiresAt: expiresAt ?? null }) });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Pending failed"); return false; }
    pushToast({ title: `Pending ${side} ${sym} placed`, type: "TRADE" }); load(); return true;
  }
  async function cancelPending(id: string) { await fetch("/api/client/pending/" + id, { method: "DELETE" }); pushToast({ title: "Pending order cancelled", type: "TRADE" }); load(); }
  async function editPending(id: string, price: number, sl: number, tp: number) {
    const r = await fetch("/api/client/pending/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ price, sl, tp }) });
    const d = await r.json();
    if (!d.ok) { pushToast({ title: d.error || "Edit failed", type: "NOTICE" }); return; }
    pushToast({ title: "Pending order updated", type: "TRADE" }); load();
  }
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
    // Validate SL/TP direction before sending (trailing stop is in pips — skip price check)
    if (!isNaN(val) && val > 0 && tpSlEdit.field !== "trailingStop") {
      const pos = positions.find((p: any) => p.id === tpSlEdit.id);
      if (pos) {
        const curPx = prices[pos.symbol] ?? Number(pos.openPrice);
        const dd = dg(pos.symbol);
        if (tpSlEdit.field === "sl") {
          if (pos.type === "BUY" && val >= curPx) { setErr(`SL must be below current price ${gnum(curPx, dd)}`); setTpSlEdit(null); return; }
          if (pos.type === "SELL" && val <= curPx) { setErr(`SL must be above current price ${gnum(curPx, dd)}`); setTpSlEdit(null); return; }
        } else {
          if (pos.type === "BUY" && val <= curPx) { setErr(`TP must be above current price ${gnum(curPx, dd)}`); setTpSlEdit(null); return; }
          if (pos.type === "SELL" && val >= curPx) { setErr(`TP must be below current price ${gnum(curPx, dd)}`); setTpSlEdit(null); return; }
        }
      }
    }
    let sendVal: number = isNaN(val) ? 0 : val;
    if (tpSlEdit.field === "trailingStop" && sendVal > 0) {
      const pos = positions.find((p: any) => p.id === tpSlEdit.id);
      if (pos) sendVal = sendVal * pipOf(dg(pos.symbol));
    }
    const body: any = { [tpSlEdit.field]: sendVal };
    const r = await fetch("/api/client/orders/" + tpSlEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setTpSlEdit(null);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    load();
  }
  async function close(id: string, closeLots?: number) {
    if (account?.locked) { setErr("Your account is read-only. Closing is disabled."); return; }
    const body = closeLots != null ? { lots: closeLots } : {};
    const r = await fetch("/api/client/orders/" + id + "/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Close failed"); return; }
    pushToast({ title: (d.isPartial ? `Partial close ${closeLots}L` : "Trade closed") + (d.pnl != null ? ` · P/L $${gnum(d.pnl, 2)}` : ""), type: "TRADE" }); load();
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
    if (!r.ok) { toast.error(r.error || "Failed to open account", { id: tid }); return r; }
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
    pushToast({ title: `Demo balance topped up ${cSym}${amt.toLocaleString()}`, type: "FUNDS" }); load();
  }

  function exportCSV(type: "positions" | "history") {
    if (type === "positions") {
      const headers = ["Ticket","Symbol","Type","Lots","Open Price","Current","SL","TP","Commission","Swap","P/L","Opened At"];
      const rows = positions.map((p: any) => {
        const cur = prices[p.symbol] ?? p.openPrice;
        const pl  = pnlOfAcc(p, cur, csz(p.symbol));
        return [p.ticket ?? "", p.symbol, p.type, p.lots, p.openPrice, cur, p.sl || "", p.tp || "", p.commission || 0, p.swap || 0, pl.toFixed(2), new Date(p.openedAt).toLocaleString()];
      });
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "positions.csv"; a.click();
    } else {
      const headers = ["Ticket","Symbol","Type","Lots","Open Price","Close Price","SL","TP","P/L","Swap","Commission","Opened At","Closed At"];
      const rows = history.map((h: any) => [h.ticket ?? "", h.symbol, h.side, h.lots, h.openPrice, h.closePrice, h.sl || "", h.tp || "", h.pnl, h.swap || 0, h.commission || 0, h.openedAt ? new Date(h.openedAt).toLocaleString() : "", h.closedAt ? new Date(h.closedAt).toLocaleString() : ""]);
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "history.csv"; a.click();
    }
  }

  // Price alert trigger — checked on every price update
  useEffect(() => {
    const al = alertsRef.current;
    if (!al.length) return;
    const hit = al.filter((a) => {
      if (a.triggered) return false; // server already fired this alert; don't double-email
      const p = prices[a.symbol]; if (!p) return false;
      return a.condition === "ABOVE" ? p >= Number(a.price) : p <= Number(a.price);
    });
    if (!hit.length) return;
    hit.forEach((a) => {
      pushToast({ title: `Alert: ${a.symbol} ${a.condition === "ABOVE" ? "≥" : "≤"} ${a.price}`, body: a.note || undefined, type: "NOTICE" });
      fetch("/api/client/alerts?id=" + a.id + "&fire=1", { method: "DELETE" }).catch(() => {});
    });
    setAlerts((prev) => prev.filter((x) => !hit.find((h) => h.id === x.id)));
  }, [prices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pending order trigger + expiry — checked on every price update
  useEffect(() => {
    const orders = pendingRef.current;
    if (!orders.length) return;
    // Expire orders whose GTC deadline has passed
    const now = Date.now();
    const expired = orders.filter((o: any) => o.expiresAt && new Date(o.expiresAt).getTime() < now);
    if (expired.length) {
      setPending((prev) => prev.filter((x: any) => !expired.find((e: any) => e.id === x.id)));
      expired.forEach((o: any) => {
        fetch("/api/client/pending/" + o.id + "/execute", { method: "POST" }).catch(() => {});
      });
    }
    const hit = orders.filter((o: any) => {
      const bid = prices[o.symbol]; if (bid == null) return false;
      const ask = bid + _spreadPx(o.symbol);
      const trig = Number(o.price);
      if (o.kind === "LIMIT" && o.side === "BUY")        return ask <= trig;
      if (o.kind === "STOP"  && o.side === "BUY")        return ask >= trig;
      if (o.kind === "LIMIT" && o.side === "SELL")       return bid >= trig;
      if (o.kind === "STOP"  && o.side === "SELL")       return bid <= trig;
      if (o.kind === "STOP_LIMIT" && o.side === "BUY")  return ask >= trig;
      if (o.kind === "STOP_LIMIT" && o.side === "SELL") return bid <= trig;
      return false;
    });
    if (!hit.length) return;
    setPending((prev) => prev.filter((x: any) => !hit.find((h: any) => h.id === x.id)));
    hit.forEach((o: any) => {
      fetch("/api/client/pending/" + o.id + "/execute", { method: "POST" })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            if (d.stopLimitConverted) {
              pushToast({ title: `${o.symbol} STOP_LIMIT triggered — limit order placed @ ${o.stopLimit}`, type: "TRADE" });
            } else {
              pushToast({ title: `${o.kind} ${o.side} ${o.symbol} executed`, type: "TRADE" });
            }
          } else {
            if (!d.expired) pushToast({ title: d.error || `${o.symbol} order failed`, type: "NOTICE" });
          }
          load();
        })
        .catch(() => {});
    });
  }, [prices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts: F9=new order, Ctrl+F=search, Escape=close overlays
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || tag === "select";
      if (e.key === "F9") { setRightTab("TRADE"); setTimeout(() => volInputRef.current?.focus(), 50); }
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); mwSearchRef.current?.focus(); }
      if (e.key === "Escape") { setCtx(null); setPosCtx(null); setAlertModal(false); setPartialClose(null); setNotiOpen(false); setAcctSwitchOpen(false); setProfileOpen(false); if (inInput) (e.target as HTMLElement).blur(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dragX(e: any, which: "mw" | "rt") { e.preventDefault(); setDragging(true); const sx = e.clientX; const sw = which === "mw" ? mwW : rtW; const mv = (ev: any) => { const dx = ev.clientX - sx; if (which === "mw") setMwW(Math.max(150, Math.min(380, sw + dx))); else setRtW(Math.max(200, Math.min(380, sw - dx))); }; const up = () => { setDragging(false); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function dragY(e: any) { e.preventDefault(); setDragging(true); const sy = e.clientY; const sh = tbH; const mv = (ev: any) => { const dy = sy - ev.clientY; setTbH(Math.max(120, Math.min(520, sh + dy))); }; const up = () => { setDragging(false); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function toggleCat(c: string) { setCollapsed((o) => ({ ...o, [c]: !o[c] })); }

  const unread = notis.filter((n: any) => !n.read).length;
  const curAcct = accts.find((a) => a.id === accId);
  const readOnly = !!account?.locked || creditLocked;

  async function submitInstantCredit() {
    const amt = Number(icAmount);
    if (amt < 250 || amt > 1000) { setIcErr("Amount must be between $250 and $1,000"); return; }
    setIcSending(true); setIcErr(""); setIcMsg("");
    const fd = new FormData();
    fd.set("kind", "CREDIT_REQUEST"); fd.set("amount", String(amt));
    if (icNote) fd.set("note", icNote);
    if (accId) fd.set("accountId", accId);
    try {
      const d = await fetch("/api/client/payments", { method: "POST", body: fd }).then((r) => r.json());
      if (!d.ok) { setIcErr(d.error || "Failed"); } else { setIcMsg("Credit request submitted — awaiting admin approval."); setInstantCreditModal(false); load(); }
    } catch { setIcErr("Network error — try again"); }
    setIcSending(false);
  }
  const [isTrial, setIsTrial] = useState(false);
  // Live accounts require KYC; demo accounts never do. Drives the banner + trade gate.
  const needKyc = account?.type === "LIVE" && !kycVerified;
  // App-style order-kind grid for the desktop ticket
  const ORDER_KINDS_DESK: [string, "BUY" | "SELL", string][] = [["MARKET", "BUY", "Market Buy"], ["MARKET", "SELL", "Market Sell"], ["LIMIT", "BUY", "Buy Limit"], ["LIMIT", "SELL", "Sell Limit"], ["STOP", "BUY", "Buy Stop"], ["STOP", "SELL", "Sell Stop"]];
  const [ordKind, ordSide, ordLabel] = ORDER_KINDS_DESK[ordIdx] || ORDER_KINDS_DESK[0];
  const ordPending = ordKind !== "MARKET";
  async function submitTicket() {
    if (ordKind === "MARKET") { setOrderType("MARKET"); await place(ordSide); }
    else await placePending(selSym, ordSide, ordKind as "LIMIT" | "STOP", Number(pendingPrice), Number(vol), Number(sl) || 0, Number(tp) || 0, gtdExpiry ? new Date(gtdExpiry).toISOString() : undefined);
  }
  const catMap: Record<string, string> = Object.fromEntries(symbols.map((s) => [s.symbol, s.category || "forex"]));
  function csz(sym: string) { return contractFor(catMap[sym] || "forex", sym); }
  // Account-currency P&L wrapper: divides USD result by fxRate so all live P&L is in account currency.
  const pnlOfAcc = (p: any, price: number, cs: number) => pnlOf(p, price, cs) / fxRate;
  const floating = positions.reduce((s, p) => s + pnlOfAcc(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
  const balance = account ? account.deposit + account.pnl - account.withdrawal : 0;
  const equity = balance + floating + (account ? account.credit + account.bonus + (account.insurance || 0) : 0);
  const used = account ? (() => {
    // hedged (net) margin: net BUY−SELL lots per symbol, charge margin on |net| only.
    // usedMargin() returns USD; divide by fxRate to display in account currency.
    const net: Record<string, number> = {};
    for (const p of positions) net[p.symbol] = (net[p.symbol] || 0) + (p.type === "BUY" ? 1 : -1) * Number(p.lots);
    let m = 0;
    for (const s in net) { const nl = Math.abs(net[s]); if (nl < 1e-9) continue; const pr = prices[s] ?? (positions.find((p) => p.symbol === s)?.openPrice ?? 0); let mg = (nl * csz(s) * pr) / account.leverage; if (/JPY$/i.test(s)) mg = mg / 100; m += mg; }
    return m / fxRate;
  })() : 0;
  const free = equity - used;
  const level = used > 0 ? (equity / used) * 100 : 0;
  // Margin level warning — lives here (after level is computed) to satisfy TypeScript TDZ
  useEffect(() => {
    if (!account || !used || used < 0.01) return;
    const prev = prevLevelRef.current;
    prevLevelRef.current = level;
    if (prev == null) return;
    if (prev >= 150 && level < 150) pushToast({ title: "Margin level below 150% — reduce exposure", type: "NOTICE" });
    else if (prev >= 100 && level < 100) pushToast({ title: "Margin call warning! Level below 100%", type: "NOTICE" });
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  const price = prices[selSym];
  const d = dg(selSym);
  // Market sessions (UTC windows)
  const sessions = (() => {
    const utcH = new Date(nowMs).getUTCHours();
    const utcM = new Date(nowMs).getUTCMinutes();
    const t = utcH * 60 + utcM;
    const inRange = (s: number, e: number) => s < e ? t >= s && t < e : t >= s || t < e;
    return [
      { name: "TKY", open: inRange(0, 9 * 60) },
      { name: "LON", open: inRange(8 * 60, 17 * 60) },
      { name: "NY",  open: inRange(13 * 60, 22 * 60) },
      { name: "SYD", open: inRange(22 * 60, 7 * 60) },
    ];
  })();
  const utcTime = new Date(nowMs).toUTCString().slice(17, 22);
  const pipVal = (vol * 1) / fxRate; // $1/pip/lot model in account currency
  // Effective spread the client pays — matches MT5 model and server execution exactly.
  // bid = ask − spreadPips × pip (same formula used by server.js for TP/SL/MC/pending).
  // FIXED: sym.min pips always constant.
  // FLOATING: sym.min during peak hours (Mon–Fri 08–17 UTC), sym.max off-hours.
  // Group/account FIXED markups are added on top.
  const _spreadPips = (sym: string) => {
    const s = symbolSpreads[sym];
    const grpAcc = groupSpread + accountSpreadMarkup;
    // Use real live spread from exchange when available (Binance/Kraken/Massive)
    const liveSp = liveSpreadPips[sym];
    if (liveSp != null && liveSp > 0) return liveSp + grpAcc;
    // Fall back to SA/admin configured spread
    const basePips = s ? (s.min || 0) : 0;
    const effective = basePips + grpAcc;
    if (effective <= 0) return 0;
    // Subtle noise tied to price so spread appears dynamic — never reveals fixed config
    const p = prices[sym];
    if (p != null) {
      const noise = (Math.sin(p * 97.3) * 0.05 + Math.cos(p * 317.1) * 0.04) * effective;
      return Math.max(effective * 0.85, effective + noise);
    }
    return effective;
  };
  const eDg = (sym: string) => effectiveDg(dg(sym), prices[sym]);
  const _spreadPx = (sym: string) => _spreadPips(sym) * pipOf(eDg(sym));
  // MT5 model: price = smoothed BID (primary). ask = price + configured spread.
  // Works for both FIXED and FLOATING — spread source differs, derivation is identical.
  const ask = (price ?? 0) + _spreadPx(selSym);
  const bid = price ?? 0;
  const margin = (price != null ? ((vol * csz(selSym) * price) / (account?.leverage || 100)) / (/JPY$/i.test(selSym) ? 100 : 1) : 0) / fxRate;
  const fmt = (v: number) => gmoney(v);
  const cSym = currencySymbol(account?.currency);
  const groups: Record<string, any[]> = {};
  const mwq = mwSearch.trim().toLowerCase();
  symbols.filter((s) => !mwq || (s.symbol + " " + (s.display || "")).toLowerCase().includes(mwq)).forEach((s) => { const c = s.category || "other"; (groups[c] || (groups[c] = [])).push(s); });
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const orderedGroups = Object.entries(groups).sort((a, b) => { const ia = CAT_ORDER.indexOf(a[0]); const ib = CAT_ORDER.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
  const histShown = history.filter((h: any) => { if (histRange === "all") return true; const t = new Date(h.closedAt).getTime(); const now = Date.now(); const day = 86400000; if (histRange === "today") return t >= now - day; if (histRange === "week") return t >= now - 7 * day; return t >= now - 30 * day; });
  const tab = (active: boolean) => "px-3 py-1.5 text-[11px] " + (active ? "" : "text-[var(--muted)]");

  // Branded loading page — shown on its own (not overlaid) until data is ready
  // and the 3s branding minimum has passed, then the app mounts.
  if (!splashGone) return <ClientSplash brand={splashBrand || brand} theme={theme} hiding={booted} />;

  if (isMobile) return <ClientMobile t={{ features, theme, brand, account, accts, accId, pnlOnly, swapEnabled, readOnly, isTrial, needKyc, signals, openKyc: () => setWalletModal("kyc"), positions, pending, history, financials, notis, symbols, symbolSpreads, groupSpread, accountSpreadMarkup, prices, liveSpreadPips, dirs, selSym, vol, orderType, pendingPrice, sl, tp, err, balance, equity, floating, free, used, level, price, bid, ask, d, tf, TFS, setSelSym, setVol, setSl, setTp, setOrderType, setPendingPrice, setTf, place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr, toggleTheme, enablePush, disablePush, addPasskey, openPin: () => { setPinErr(""); setPinForm({}); setPinModal(true); }, favs, toggleFav, avatarUrl, avatarUploading, uploadAvatar, fmt, csz, pnlOf: pnlOfAcc, cSym, fxRate, dg, markAllNotifsRead, chartInd, setChartInd, chartCfg, setChartCfg, acctReqModal, setAcctReqModal, logout: async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }, pin: { pinLock, pinInput, setPinInput, pinErr, unlock, unlockPasskey, pinModal, setPinModal, pinHasPin, setPinHasPin, pinForm, setPinForm, savePin, disablePin: async () => { if (!confirm("Disable PIN? You will no longer need a PIN to open the app.")) return; const r = await fetch("/api/client/pin", { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false })); if (r.ok) { setPinHasPin(false); sessionStorage.removeItem("cubex-pin-ok"); } } }, cToasts, pushToast, dismissToasts: () => setCToasts([]), creditRequest, creditLocked, openInstantCredit: () => setInstantCreditModal(true) }} />;
  if (tenantSuspended) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-center px-6" style={{ background: "#0f172a", color: "#94a3b8" }}>
        <div className="rounded-full w-16 h-16 flex items-center justify-center mb-2" style={{ background: "#1e293b" }}>
          <i className="fa-solid fa-lock text-2xl" style={{ color: "#f59e0b" }} />
        </div>
        <div className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>Platform Temporarily Unavailable</div>
        <div className="text-sm max-w-xs" style={{ color: "#64748b" }}>This platform is currently undergoing maintenance. Please contact your broker for assistance.</div>
        <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => { window.location.href = "/login"; })} className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "#1e293b", color: "#94a3b8" }}>
          Sign Out
        </button>
      </div>
    );
  }

  // ── PROFILE GATE — blocks the entire app until name/phone/country are set ──
  if (profileModal) {
    return (
      <div style={{ ...(theme === "dark" ? DARK : LIGHT), fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }} className="flex h-screen flex-col items-center justify-center overflow-hidden bg-[var(--bg)] text-[var(--text)]">
        <div className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
          <div className="mb-4 flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(38,166,154,0.12)" }}>
              <i className="fa-solid fa-user-check text-xl" style={{ color: BUY }} />
            </div>
            <div className="text-lg font-bold">Complete Your Profile</div>
            <p className="text-center text-[11px]" style={{ color: "var(--muted)" }}>Required before accessing the platform. Must match your government-issued ID and cannot be changed after submission.</p>
          </div>
          <div className="space-y-3 text-[13px]">
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--muted)" }}>Full Name <span style={{ color: SELL }}>*</span></label>
              <input value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }} placeholder="As it appears on your ID" />
              <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>Must match your government-issued ID exactly.</p>
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--muted)" }}>Phone Number <span style={{ color: SELL }}>*</span></label>
              <input value={profileForm.phone} onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }} placeholder="+1 234 567 8900" type="tel" />
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--muted)" }}>Country <span style={{ color: SELL }}>*</span></label>
              <select value={profileForm.country} onChange={(e) => setProfileForm((f) => ({ ...f, country: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}>
                <option value="">Select country…</option>
                {COUNTRIES.map((c) => <option key={c.code} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {profileErr && <div className="rounded px-2 py-1.5 text-[12px]" style={{ background: "rgba(239,83,80,0.1)", color: SELL }}>{profileErr}</div>}
            <button onClick={saveProfile} disabled={profileSaving} className="mt-1 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: BUY }}>
              {profileSaving ? <><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />Saving…</> : "Submit & Continue"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...(theme === "dark" ? DARK : LIGHT), fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }} className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
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
          <button onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"} className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]"><i className={"fa-solid " + (theme === "dark" ? "fa-sun" : "fa-moon")} /></button>
          <div className="relative">
            <button onClick={() => { const w = !notiOpen; setNotiOpen(w); if (w && unread > 0) { fetch("/api/client/notifications", { method: "POST" }).then(() => setNotis((ns) => ns.map((n) => ({ ...n, read: true })))); } }} title="Notifications" className="relative rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-bell" />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-bold" style={{ background: SELL, color: "#fff" }}>{unread}</span>}</button>
            {notiOpen && (<><div className="fixed inset-0 z-[80]" onClick={() => setNotiOpen(false)} /><div className="ui-pop absolute right-0 z-[90] mt-1 max-h-80 w-72 overflow-hidden rounded-xl border text-left text-[11px]" style={{ background: "var(--panel)", borderColor: "var(--border)" }}><div className="sticky top-0 flex items-center justify-between border-b px-3 py-2" style={{ background: "var(--panel)", borderColor: "var(--border)" }}><span className="font-semibold">Notifications</span>{notis.length > 0 && <button onClick={() => { markAllNotifsRead(); }} className="text-[10px]" style={{ color: GOLD }}>Mark all read</button>}</div><div className="overflow-auto" style={{ maxHeight: "calc(20rem - 36px)" }}>{notis.length === 0 ? <div className="px-2 py-3 text-center text-[var(--muted)]">No notifications</div> : notis.map((n, i) => { const ic = iconForNotification(n); return (<div key={i} className="flex items-start gap-2 border-b px-2 py-2 last:border-0" style={{ borderColor: "var(--border)", background: !n.read ? "color-mix(in srgb, var(--soft) 60%, transparent)" : undefined }}><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: ic.color + "22", color: ic.color }}><i className={"fa-solid " + ic.icon + " text-[10px]"} /></span><div className="min-w-0 flex-1"><div className="font-medium text-[var(--text)]">{n.title}</div>{n.body && <div className="mt-0.5 whitespace-pre-line text-[var(--muted)]">{n.body}</div>}{n.image && <img src={n.image} alt="" className="mt-1 max-h-28 w-full rounded object-cover" />}<div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</div></div></div>); })}</div></div></>)}
          </div>
          <button onClick={() => setProfileOpen((o) => !o)} title="Profile" className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] hover:border-[var(--accent)]">
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <i className="fa-solid fa-user text-[11px] text-[var(--muted)]" />}
            {(!account?.phone || !account?.country) && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--panel)]" style={{ background: SELL }} />}
          </button>
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

      {profileOpen && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setProfileOpen(false)} />
          <div className="fixed right-0 top-0 z-[160] flex h-full w-72 flex-col border-l" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            {/* header */}
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span className="text-[11px] font-semibold tracking-wide">PROFILE</span>
              <button onClick={() => setProfileOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark text-[11px]" /></button>
            </div>

            {/* avatar + name */}
            <div className="shrink-0 flex items-center gap-3 border-b px-3 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="relative shrink-0">
                <input type="file" accept="image/*" style={{ display: "none" }} ref={avatarInputRef} onChange={uploadAvatar} />
                <button onClick={() => avatarInputRef.current?.click()} className="relative h-11 w-11 overflow-hidden rounded-full border-2" style={{ borderColor: "var(--accent)" }}>
                  {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-base font-bold" style={{ background: "var(--soft)", color: "var(--accent)" }}>{(account?.ownerName || account?.name || "?")[0].toUpperCase()}</span>}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"><i className="fa-solid fa-camera text-white text-[9px]" /></span>
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold">{account?.ownerName || account?.name}</div>
                <div className="truncate text-[10px] text-[var(--muted)]">{account?.email}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                  <i className="fa-solid fa-phone text-[8px] text-[var(--muted)]" /><span className="text-[var(--muted)]">{account?.phone || <span style={{ color: SELL }}>—</span>}</span>
                  <i className="fa-solid fa-globe text-[8px] text-[var(--muted)] ml-1" /><span className="text-[var(--muted)]">{account?.country || <span style={{ color: SELL }}>—</span>}</span>
                </div>
              </div>
              {(!account?.phone || !account?.country) && (
                <button onClick={() => { setProfileOpen(false); openProfileEdit(); }} className="shrink-0 rounded-lg px-2 py-1 text-[9px] font-semibold text-white" style={{ background: SELL }}>Fix</button>
              )}
            </div>

            {/* account stats 2-col */}
            <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Account — {curAcct?.login} · {curAcct?.type}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[
                  ["Balance", cSym + fmt(balance), BUY],
                  ["Equity", cSym + fmt(equity), undefined],
                  ["Leverage", "1:" + (account?.leverage || 100), undefined],
                  ["Currency", account?.currency || "USD", undefined],
                ].map(([k, v, c]) => (
                  <div key={k as string} className="flex justify-between text-[11px]">
                    <span className="text-[var(--muted)]">{k}</span>
                    <span className="font-medium tabular-nums" style={c ? { color: c as string } : undefined}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* funds */}
            <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Funds</div>
              {curAcct?.type === "LIVE" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { icon: "fa-circle-dollar-to-slot", label: "Deposit", color: BUY, onClick: () => { setProfileOpen(false); setWalletModal("deposit"); } },
                    { icon: "fa-hand-holding-dollar", label: "Withdraw", color: GOLD, onClick: () => { setProfileOpen(false); setWalletModal("withdraw"); } },
                    ...(accts.length >= 2 ? [{ icon: "fa-money-bill-transfer", label: "Transfer", color: undefined, onClick: () => { setProfileOpen(false); setXferErr(""); setXfer({ fromId: accId }); setXferModal(true); } }] : []),
                    { icon: "fa-bolt-lightning", label: "Credit", color: "#a855f7", onClick: () => { setProfileOpen(false); setIcErr(""); setIcMsg(""); setInstantCreditModal(true); } },
                  ].map((item) => (
                    <button key={item.label} onClick={item.onClick} disabled={readOnly} className="flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold hover:bg-[var(--soft)] disabled:opacity-40">
                      <i className={"fa-solid " + item.icon} style={{ color: item.color || "var(--muted)" }} />
                      <span style={{ color: "var(--muted)" }}>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => { setProfileOpen(false); topUp(); }} disabled={readOnly} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)] disabled:opacity-40">
                  <i className="fa-solid fa-coins w-4 text-center" style={{ color: GOLD }} />Top up Demo
                </button>
              )}
            </div>

            {/* accounts + reports */}
            <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Accounts & Reports</div>
              {!isTrial && !accts.some((a: any) => a.type === "DEMO") && (
                <button onClick={() => { setProfileOpen(false); openAccount("DEMO"); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)]">
                  <i className="fa-solid fa-vial w-4 text-center text-[var(--muted)]" />Open Demo Account
                </button>
              )}
              {!isTrial && (
                <button onClick={async () => { const r = await openAccount("LIVE"); if (r?.pending) { setMyReqsLoaded(false); setBotTab("requests"); } setProfileOpen(false); }} disabled={readOnly} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)] disabled:opacity-40">
                  <i className="fa-solid fa-bolt w-4 text-center" style={{ color: BUY }} />Open Live Account
                </button>
              )}
              {curAcct?.type === "LIVE" && (
                <button onClick={() => { setProfileOpen(false); setWalletModal("kyc"); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)]">
                  <i className="fa-solid fa-id-card w-4 text-center text-[var(--muted)]" />KYC Verification
                </button>
              )}
              <button onClick={() => { setProfileOpen(false); setRepPreset("all"); setRepFrom(""); setRepTo(""); setRepMsg(""); setStmtRep(true); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)]">
                <i className="fa-solid fa-file-invoice w-4 text-center" style={{ color: BUY }} />Statement / Report
              </button>
            </div>

            {/* referral — only shown when feature is enabled */}
            {features.referralProgram !== false && (
              <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Refer &amp; Earn</div>
                {!refData ? (
                  <div className="py-1 text-[10px] text-[var(--muted)]">Loading…</div>
                ) : (
                  <>
                    {/* stats row */}
                    <div className="mb-2 grid grid-cols-2 gap-1.5">
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "var(--soft)" }}>
                        <div className="text-[15px] font-bold tabular-nums" style={{ color: BUY }}>{refData.count}</div>
                        <div className="text-[8px] text-[var(--muted)]">Referred</div>
                      </div>
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "var(--soft)" }}>
                        <div className="text-[15px] font-bold tabular-nums" style={{ color: BUY }}>${Number(refData.totalEarned || 0).toFixed(2)}</div>
                        <div className="text-[8px] text-[var(--muted)]">Earned</div>
                      </div>
                    </div>
                    {/* reward rates */}
                    {(refData.signupBonus > 0 || refData.depositPercent > 0) && (
                      <div className="mb-2 rounded-lg px-2 py-1.5 text-[10px]" style={{ background: "rgba(22,199,154,0.08)", color: BUY }}>
                        {refData.signupBonus > 0 && <div>✓ ${refData.signupBonus} signup bonus per referral</div>}
                        {refData.depositPercent > 0 && <div>✓ {refData.depositPercent}% of each deposit</div>}
                        {refData.tradingPercent > 0 && <div>✓ {refData.tradingPercent}% trading commission</div>}
                      </div>
                    )}
                    {/* referral link */}
                    <div className="mb-1.5 flex items-center gap-1 rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "var(--soft)" }}>
                      <span className="flex-1 truncate font-mono text-[9px] text-[var(--muted)]">{refData.referralCode}</span>
                      <button
                        onClick={() => {
                          const link = `${window.location.origin}/register?ref=${refData.referralCode}`;
                          navigator.clipboard.writeText(link).then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 2000); });
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                        style={{ background: refCopied ? "#16a34a" : BUY }}
                      >
                        {refCopied ? "Copied!" : "Copy Link"}
                      </button>
                    </div>
                    {/* recent referrals */}
                    {refData.referrals?.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {refData.referrals.slice(0, 3).map((r: any) => (
                          <div key={r.id} className="flex items-center justify-between rounded px-1.5 py-1 text-[9px]" style={{ background: "var(--soft)" }}>
                            <span style={{ color: "var(--muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                            <span style={{ color: r.totalEarned > 0 ? BUY : "var(--muted)" }}>{r.totalEarned > 0 ? `+$${r.totalEarned.toFixed(2)}` : r.signupBonusPaid ? "Active" : "Pending"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* security */}
            <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Security</div>
              {[
                { icon: "fa-shield-halved", label: pinHasPin ? "Change PIN" : "Set PIN", onClick: () => { setProfileOpen(false); setPinErr(""); setPinForm({}); setPinModal(true); } },
                { icon: "fa-fingerprint", label: "Biometrics / Face ID", onClick: () => { setProfileOpen(false); addPasskey(); } },
                { icon: "fa-bell-concierge", label: "Push Notifications", onClick: () => { setProfileOpen(false); enablePush(); } },
              ].map((item) => (
                <button key={item.label} onClick={item.onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)]">
                  <i className={"fa-solid " + item.icon} style={{ width: 14, textAlign: "center", color: "var(--muted)" }} />{item.label}
                </button>
              ))}
              <button onClick={() => { setDeskTotpErr(""); setDeskTotpCode(""); if (deskTotpEnabled) { setDeskTotpModal("disable"); } else { deskOpenTotpSetup(); } }} disabled={deskTotpBusy} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)] disabled:opacity-50">
                <i className="fa-solid fa-lock" style={{ width: 14, textAlign: "center", color: deskTotpEnabled ? BUY : "var(--muted)" }} />
                {deskTotpBusy ? "Loading…" : deskTotpEnabled ? "2FA Enabled — click to disable" : "Set up Authenticator App (2FA)"}
              </button>
            </div>

            {/* logout */}
            <div className="px-3 py-2 mt-auto shrink-0">
              <button onClick={async () => { localStorage.removeItem("cubex-remember"); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--soft)]" style={{ color: SELL }}>
                <i className="fa-solid fa-right-from-bracket" style={{ width: 14, textAlign: "center" }} />Logout
              </button>
            </div>
          </div>
        </>
      )}

      {/* Desktop 2FA setup / disable modal */}
      {deskTotpModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => { setDeskTotpModal(null); setDeskTotpErr(""); setDeskTotpCode(""); }}>
          <div className="ui-pop w-full max-w-sm rounded-2xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            {deskTotpModal === "setup" ? (<>
              <div className="mb-2 font-semibold">Set up Two-Factor Authentication</div>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Scan this QR code with Google Authenticator or Authy, then enter the 6-digit code to confirm.</p>
              {deskTotpQr && <img src={deskTotpQr} alt="QR code" className="mx-auto mb-2 rounded-lg" style={{ width: 160, height: 160 }} />}
              <div className="mb-3 rounded-lg px-3 py-2 text-center text-[10px] font-mono break-all" style={{ background: "var(--soft)", color: "var(--muted)" }}>{deskTotpSecret}</div>
              {deskTotpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{deskTotpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={deskTotpCode} onChange={(e) => setDeskTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setDeskTotpModal(null); setDeskTotpCode(""); setDeskTotpErr(""); }} className="flex-1 rounded-xl border py-2.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={deskConfirmTotpEnable} disabled={deskTotpBusy || deskTotpCode.length < 6} className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: BUY }}>
                  {deskTotpBusy ? "Verifying…" : "Enable 2FA"}
                </button>
              </div>
            </>) : (<>
              <div className="mb-2 font-semibold">Disable Two-Factor Authentication</div>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Enter the 6-digit code from your authenticator app to confirm.</p>
              {deskTotpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{deskTotpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={deskTotpCode} onChange={(e) => setDeskTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setDeskTotpModal(null); setDeskTotpCode(""); setDeskTotpErr(""); }} className="flex-1 rounded-xl border py-2.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={deskConfirmTotpDisable} disabled={deskTotpBusy || deskTotpCode.length < 6} className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: SELL }}>
                  {deskTotpBusy ? "Verifying…" : "Disable 2FA"}
                </button>
              </div>
            </>)}
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
        {posCtx && (() => { const p = posCtx.pos; const pl = pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)); const net = swapEnabled ? pl + Number(p.swap) - Number(p.commission) : pl; const _vw = typeof window !== "undefined" ? window.innerWidth : 1200; const _vh = typeof window !== "undefined" ? window.innerHeight : 800; const _px = Math.min(posCtx.x, _vw - 196); const _py = Math.min(Math.max(posCtx.y, 4), _vh - 224); return (<>
          <div className="fixed inset-0 z-[80]" onClick={() => setPosCtx(null)} onContextMenu={(e) => { e.preventDefault(); setPosCtx(null); }} />
          <div className="ui-pop fixed z-[90] min-w-[180px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] py-1 text-[12px] shadow-xl" style={{ left: _px, top: _py }}>
            <div className="border-b border-[var(--border)] px-3 py-1.5">
              <div className="text-[11px] font-bold" style={{ color: "var(--text)" }}>{p.symbol} <span style={{ color: p.type === "BUY" ? BUY : SELL }}>{p.type}</span></div>
              <div className="text-[10px]" style={{ color: "var(--muted)" }}>#{p.ticket} · {p.lots}L · <span style={{ color: net >= 0 ? BUY : SELL }}>{net >= 0 ? "+" : ""}{fmt(net)}</span></div>
            </div>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" style={{ color: SELL }} onClick={() => { close(p.id); setPosCtx(null); }}><i className="fa-solid fa-xmark mr-2" />Close Position</button>
            {Number(p.lots) > 0.01 && <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setPartialClose({ id: p.id, sym: p.symbol, lots: Number(p.lots), closeLots: "" }); setPosCtx(null); }}><i className="fa-solid fa-scissors mr-2 text-[10px]" />Partial Close</button>}
            <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setTpSlEdit({ id: p.id, field: "tp", val: p.tp ? String(p.tp) : "" }); setBotTab("positions"); setPosCtx(null); }}><i className="fa-solid fa-arrow-up mr-2 text-[10px]" style={{ color: "#10b981" }} />{p.tp ? "Modify TP" : "Add TP"}</button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setTpSlEdit({ id: p.id, field: "sl", val: p.sl ? String(p.sl) : "" }); setBotTab("positions"); setPosCtx(null); }}><i className="fa-solid fa-arrow-down mr-2 text-[10px]" style={{ color: "#f43f5e" }} />{p.sl ? "Modify SL" : "Add SL"}</button>
            <div className="border-t border-[var(--border)] mt-1">
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setSelSym(p.symbol); setPosCtx(null); }}><i className="fa-solid fa-chart-line mr-2 text-[10px]" />Open Chart</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(String(p.ticket)); setPosCtx(null); }}><i className="fa-regular fa-copy mr-2 text-[10px]" />Copy Ticket #{p.ticket}</button>
            </div>
          </div>
        </>); })()}
        {ctx && (<>
            <div className="fixed inset-0 z-[80]" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
            {(() => { const _vw2 = typeof window !== "undefined" ? window.innerWidth : 1200; const _vh2 = typeof window !== "undefined" ? window.innerHeight : 800; const _px2 = Math.min(ctx.x, _vw2 - 164); const _py2 = Math.min(Math.max(ctx.y, 4), _vh2 - 180); return (
            <div className="ui-pop fixed z-[90] min-w-[150px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] py-1 text-[12px] shadow-lg" style={{ left: _px2, top: _py2 }}>
              <div className="px-3 py-1 text-[10px] text-[var(--muted)]">{ctx.sym}</div>
              {oneClick && <>
                <button className="block w-full px-3 py-1.5 text-left font-semibold hover:bg-[var(--soft)]" style={{ color: BUY }} onClick={() => { quickTrade(ctx.sym, "BUY"); setCtx(null); }}><i className="fa-solid fa-bolt mr-1.5 text-[9px]" />Buy at Market ({vol}L)</button>
                <button className="block w-full px-3 py-1.5 text-left font-semibold hover:bg-[var(--soft)]" style={{ color: SELL }} onClick={() => { quickTrade(ctx.sym, "SELL"); setCtx(null); }}><i className="fa-solid fa-bolt mr-1.5 text-[9px]" />Sell at Market ({vol}L)</button>
                <div className="border-t border-[var(--border)] my-0.5" />
              </>}
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setSelSym(ctx.sym); setRightTab("TRADE"); setCtx(null); }}>New Order</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { setSelSym(ctx.sym); setCtx(null); }}>Open Chart</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(ctx.sym); setCtx(null); }}>Copy Symbol</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-[var(--soft)]" onClick={() => { toggleFav(ctx.sym); setCtx(null); }}>{favs.includes(ctx.sym) ? "Remove favourite" : "Add favourite"}</button>
            </div>
            ); })()}
          </>)}
          <aside className="flex flex-col border-r border-[var(--border)] bg-[var(--panel)]" style={{ width: mwW }}>
          <div className="border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">MARKET WATCH</div>
          <div className="border-b border-[var(--border)] px-1.5 py-1">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]" />
              <input ref={mwSearchRef} value={mwSearch} onChange={(e) => setMwSearch(e.target.value)} name="mw-search" autoComplete="off" placeholder="Search symbol… (Ctrl+F)" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-1 pl-6 pr-6 text-[10px] text-[var(--text)]" />
              {mwSearch && <button onClick={() => setMwSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]">{"×"}</button>}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-1 pb-2 text-[10px]"><div className="sticky top-0 z-10 grid grid-cols-[minmax(72px,1fr)_58px_58px_26px_40px] bg-[var(--panel)] px-2 py-1 text-[10px] font-bold text-[var(--text)]"><span>Symbol</span><span className="text-right pr-1">Bid</span><span className="text-right pr-1">Ask</span><span className="text-right pr-1" title="Spread in points" style={{ color: "var(--muted)", fontSize: 8 }}>Sprd</span><span className="text-right pr-1" title="% change from session open" style={{ color: "var(--muted)", fontSize: 8 }}>%Chg</span></div>
            {favs.length > 0 && (
              <div>
                <div className="mt-1 rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold" style={{ color: GOLD }}>{"\u2605"} FAVOURITES</div>
                {symbols.filter((s) => favs.includes(s.symbol)).map((s) => { const p = prices[s.symbol]; const dd = eDg(s.symbol); const spPx = _spreadPx(s.symbol); const a = p != null ? p + spPx : null; const b = p ?? null; const dir = dirs[s.symbol] || 0; const sp = _spreadPips(s.symbol); const spDir = spreadDirs[s.symbol] || 0; const dOpen = dailyOpen[s.symbol]; const pct = dOpen && p ? ((p - dOpen) / dOpen) * 100 : null; return (
                  <div key={"fav-" + s.symbol} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }} className={"grid grid-cols-[minmax(72px,1fr)_58px_58px_26px_40px] items-center px-2 py-1 transition-colors hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}>
                    <button onClick={() => setSelSym(s.symbol)} className="flex min-w-0 items-center gap-2 text-left"><SymIcon symbol={s.symbol} size={16} /><span className="truncate">{s.symbol}</span></button>
                    <PriceCell value={b != null ? gnum(b, dd) : "..."} dir={dir} />
                    <PriceCell value={a != null ? gnum(a, dd) : "..."} dir={dir} />
                    <span className="text-right pr-1 tabular-nums" style={{ fontSize: 9, fontWeight: spDir !== 0 ? 700 : 500, color: spDir > 0 ? "#e05260" : spDir < 0 ? "#16c784" : "var(--muted)", transition: "color 0.55s ease-out" }}>{sp > 0 ? Math.round(sp * (dg(s.symbol) >= 3 ? 10 : 1)) : "\u2014"}</span>
                    <span className="text-right pr-1 tabular-nums" style={{ fontSize: 9, fontWeight: 600, color: pct == null ? "var(--muted)" : pct > 0 ? "#16c784" : pct < 0 ? "#e05260" : "var(--muted)" }}>{pct == null ? "\u2014" : (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%"}</span>
                  </div>); })}
              </div>
            )}
            {orderedGroups.map(([c, list]) => (
              <div key={c}>
                <div onClick={() => toggleCat(c)} className="mt-1 cursor-pointer rounded bg-[var(--soft)] px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)]">{collapsed[c] ? "\u25B8" : "\u25BE"} {c.toUpperCase()}</div>
                {!collapsed[c] && list.map((s) => { const p = prices[s.symbol]; const dd = eDg(s.symbol); const spPx = _spreadPx(s.symbol); const a = p != null ? p + spPx : null; const b = p ?? null; const dir = dirs[s.symbol] || 0; const sp = _spreadPips(s.symbol); const spDir = spreadDirs[s.symbol] || 0; const dOpen = dailyOpen[s.symbol]; const pct = dOpen && p ? ((p - dOpen) / dOpen) * 100 : null; return (
                  <div key={s.symbol} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, sym: s.symbol }); }} className={"grid grid-cols-[minmax(72px,1fr)_58px_58px_26px_40px] items-center px-2 py-1 transition-colors hover:bg-[var(--soft)] " + (selSym === s.symbol ? "bg-[var(--soft)]" : "")}>
                    <button onClick={() => setSelSym(s.symbol)} className="flex min-w-0 items-center gap-2 text-left"><SymIcon symbol={s.symbol} size={16} /><span className="truncate">{s.symbol}</span></button>
                    <PriceCell value={b != null ? gnum(b, dd) : "..."} dir={dir} />
                    <PriceCell value={a != null ? gnum(a, dd) : "..."} dir={dir} />
                    <span className="text-right pr-1 tabular-nums" style={{ fontSize: 9, fontWeight: spDir !== 0 ? 700 : 500, color: spDir > 0 ? "#e05260" : spDir < 0 ? "#16c784" : "var(--muted)", transition: "color 0.55s ease-out" }}>{sp > 0 ? Math.round(sp * (dg(s.symbol) >= 3 ? 10 : 1)) : "\u2014"}</span>
                    <span className="text-right pr-1 tabular-nums" style={{ fontSize: 9, fontWeight: 600, color: pct == null ? "var(--muted)" : pct > 0 ? "#16c784" : pct < 0 ? "#e05260" : "var(--muted)" }}>{pct == null ? "\u2014" : (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%"}</span>
                  </div>); })}
              </div>
            ))}
          </div>
        </aside>
        <div onMouseDown={(e) => dragX(e, "mw")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

        <div className="flex min-w-0 flex-1 flex-col">
<div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg)]">{(() => { const pos = [
            ...positions.filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, ticket: o.ticket, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
            ...pending.filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
          ]; return <KLineProChart symbol={selSym} tf={tf} theme={theme} digits={d} symbols={symbols} positions={pos} spreadPips={_spreadPips(selSym)} onSymbolChange={(sm) => setSelSym(sm)} showBuiltinOHLC={false} onTfChange={setTf} />; })()}
          </div>
        </div>
        <div onMouseDown={(e) => dragX(e, "rt")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

        <aside className="relative flex flex-col border-l border-[var(--border)] bg-[var(--panel)]" style={{ width: rtW }}>
          {/* Right panel header: symbol info + alert bell + 1-click toggle */}
          {symInfoOpen && (
            <>
              <div className="fixed inset-0 z-[80]" onClick={() => setSymInfoOpen(false)} />
              <div className="absolute right-2 top-10 z-[90] w-52 overflow-hidden rounded-xl border text-[10px] shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                <div className="border-b px-3 py-2 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{selSym} — Contract Spec</div>
                {[
                  ["Contract Size", csz(selSym).toLocaleString() + " units"],
                  ["Digits", String(d)],
                  ["Spread", Math.round(_spreadPips(selSym)) + " pts"],
                  ["Pip Value", cSym + fmt(pipVal) + " / pip / lot"],
                  ["Margin (1 lot)", cSym + fmt(((price ?? 0) * csz(selSym)) / (account?.leverage || 100) / (/JPY$/i.test(selSym) ? 100 : 1) / fxRate)],
                  ["Leverage", "1:" + (account?.leverage || 100)],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex items-center justify-between border-b px-3 py-1.5 last:border-0" style={{ borderColor: "var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>{k}</span>
                    <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent)" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide shrink-0" style={{ color: "#2f81f7" }}>
              <i className="fa-solid fa-bolt text-[10px]" />NEW ORDER
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setSymInfoOpen((v) => !v)} title="Contract specification" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold hover:opacity-80 transition-opacity" style={{ background: "var(--soft)", color: "#2f81f7" }}>
                <SymIcon symbol={selSym} size={14} />
                {selSym}
                <i className="fa-solid fa-circle-info text-[8px] opacity-60" />
              </button>
              {price != null && <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{gnum(price, d)}</span>}
              <button title={oneClick ? "One-click trading ON — click to disable" : "One-click trading OFF — click to enable"} onClick={toggleOneClick} className="rounded px-1.5 py-0.5 text-[9px] font-bold border transition-colors" style={oneClick ? { background: "#2f81f722", borderColor: "#2f81f7", color: "#2f81f7" } : { borderColor: "var(--border)", color: "var(--muted)" }}>
                <i className="fa-solid fa-bolt mr-0.5" />1-Click
              </button>
              <button title="Price Alerts" onClick={() => setAlertModal(true)} className="rounded p-1 text-[11px]" style={{ color: alerts.length > 0 ? "#f59e0b" : "var(--muted)" }}>
                <i className="fa-solid fa-bell" />
              </button>
            </div>
          </div>
          {/* Tab bar: TRADE | SIGNALS | NEWS | CALENDAR | ANALYTICS | DOM
              Feature flags (SA-controlled, tenant-wide): copyTrading→SIGNALS,
              marketNewsFeed→NEWS, economicCalendar→CALENDAR, advancedAnalytics→ANALYTICS */}
          <div className="flex shrink-0 border-b border-[var(--border)]">
            {(["TRADE", "SIGNALS", "NEWS", "CALENDAR", "ANALYTICS", "DOM"] as const)
              .filter((t) => {
                if (t === "SIGNALS")   return features.copyTrading       !== false;
                if (t === "NEWS")      return features.marketNewsFeed    !== false;
                if (t === "CALENDAR")  return features.economicCalendar  !== false;
                if (t === "ANALYTICS") return features.advancedAnalytics !== false;
                return true;
              })
              .map((t) => (
              <button key={t} onClick={() => setRightTab(t)} className="flex-1 py-1.5 text-[9px] font-semibold uppercase tracking-wide transition-colors" style={rightTab === t ? { color: "#2f81f7", borderBottom: "2px solid #2f81f7" } : { color: "var(--muted)" }}>
                {t === "TRADE" ? <i className="fa-solid fa-arrow-right-arrow-left" /> : t === "SIGNALS" ? <span className="relative"><i className="fa-solid fa-signal" />{signals.length > 0 && <span className="absolute -top-1 -right-1.5 rounded-full px-[3px] text-[7px] font-bold leading-tight" style={{ background: "#2f81f7", color: "#fff" }}>{signals.length}</span>}</span> : t === "NEWS" ? <i className="fa-solid fa-newspaper" /> : t === "CALENDAR" ? <i className="fa-solid fa-calendar-days" /> : t === "ANALYTICS" ? <i className="fa-solid fa-chart-bar" /> : <i className="fa-solid fa-table-list" />}
                <span className="block text-[7px] mt-0.5 leading-none">{t === "TRADE" ? "Trade" : t === "SIGNALS" ? "Signals" : t === "NEWS" ? "News" : t === "CALENDAR" ? "Cal" : t === "ANALYTICS" ? "Stats" : "DOM"}</span>
              </button>
            ))}
          </div>
          {/* Scrollable form area */}
          <div className="min-h-0 flex-1 overflow-auto">
          {rightTab === "DOM" ? (
            price != null ? (
              <DomPanel
                symbol={selSym}
                bid={bid}
                ask={ask}
                spreadPips={_spreadPips(selSym)}
                digits={d}
                onRowClick={(px, side) => {
                  setPendingPrice(px.toFixed(d));
                  setOrderType(side === "ask" ? "LIMIT" : "STOP");
                  setRightTab("TRADE");
                }}
              />
            ) : (
              <div className="p-6 text-center text-[11px]" style={{ color: "var(--muted)" }}>Select a symbol to view DOM.</div>
            )
          ) : rightTab === "SIGNALS" ? (
            <div className="p-2 text-[11px]">
              {!signalsLoaded ? (
                <div className="p-6 text-center text-[var(--muted)]"><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading signals…</div>
              ) : signals.length === 0 ? (
                <div className="p-8 text-center">
                  <i className="fa-solid fa-signal mb-2 block text-2xl" style={{ color: "var(--muted)" }} />
                  <div className="text-[var(--muted)]">No active signals.</div>
                  <div className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>Your analyst will publish signals here.</div>
                </div>
              ) : signals.map((sig: any) => {
                const isBuy = sig.direction === "BUY";
                const dirColor = isBuy ? BUY : SELL;
                const ageMs = Date.now() - new Date(sig.createdAt).getTime();
                const ageStr = ageMs < 3600000 ? Math.floor(ageMs / 60000) + "m ago" : ageMs < 86400000 ? Math.floor(ageMs / 3600000) + "h ago" : Math.floor(ageMs / 86400000) + "d ago";
                return (
                  <div key={sig.id} className="mb-2 rounded-xl border p-2.5" style={{ borderColor: dirColor + "44", background: dirColor + "08" }}>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: dirColor }}>{sig.direction}</span>
                        <span className="font-semibold text-[var(--text)]">{sig.symbol}</span>
                      </div>
                      <span className="text-[9px]" style={{ color: "var(--muted)" }}>{ageStr}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mb-1.5">
                      <div className="text-center rounded py-1" style={{ background: "var(--soft)" }}>
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Entry</div>
                        <div className="text-[10px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{Number(sig.entryPrice).toFixed(5)}</div>
                      </div>
                      <div className="text-center rounded py-1" style={{ background: "var(--soft)" }}>
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>SL</div>
                        <div className="text-[10px] font-bold tabular-nums" style={{ color: Number(sig.sl) > 0 ? SELL : "var(--muted)" }}>{Number(sig.sl) > 0 ? Number(sig.sl).toFixed(5) : "—"}</div>
                      </div>
                      <div className="text-center rounded py-1" style={{ background: "var(--soft)" }}>
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>TP</div>
                        <div className="text-[10px] font-bold tabular-nums" style={{ color: Number(sig.tp) > 0 ? BUY : "var(--muted)" }}>{Number(sig.tp) > 0 ? Number(sig.tp).toFixed(5) : "—"}</div>
                      </div>
                    </div>
                    {sig.rationale && <div className="mb-1.5 text-[10px] italic" style={{ color: "var(--muted)" }}>{sig.rationale}</div>}
                    <button
                      onClick={() => {
                        setSelSym(sig.symbol);
                        setSl(Number(sig.sl) > 0 ? String(Number(sig.sl).toFixed(5)) : "");
                        setTp(Number(sig.tp) > 0 ? String(Number(sig.tp).toFixed(5)) : "");
                        setRightTab("TRADE");
                      }}
                      className="w-full rounded-lg py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: dirColor }}
                    >
                      <i className={`fa-solid fa-arrow-trend-${isBuy ? "up" : "down"} mr-1`} />Trade This Signal
                    </button>
                  </div>
                );
              })}
              {signalsLoaded && signals.length > 0 && (
                <button onClick={() => { setSignalsLoaded(false); }} className="mt-1 w-full rounded border border-[var(--border)] py-1 text-[9px]" style={{ color: "var(--muted)" }}>
                  <i className="fa-solid fa-rotate-right mr-1" />Refresh
                </button>
              )}
            </div>
          ) : rightTab === "NEWS" ? (
            <div className="p-2 text-[11px]">
              {!newsLoaded ? (
                <div className="p-6 text-center text-[var(--muted)]"><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading news…</div>
              ) : news.length === 0 ? (
                <div className="p-6 text-center text-[var(--muted)]">No news available.</div>
              ) : news.map((n: any) => (
                <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block border-b border-[var(--border)] px-1 py-2 hover:bg-[var(--soft)]">
                  <div className="font-medium text-[var(--text)]">{n.headline}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{(() => { const ms = Date.now() - n.datetime * 1000; const m = Math.floor(ms / 60000); if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return Math.floor(h / 24) + "d ago"; })()}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : rightTab === "CALENDAR" ? (
            <div className="text-[11px]">
              {/* Impact filter */}
              <div className="sticky top-0 z-10 flex gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
                {(["all","high","medium","low"] as const).map((imp) => (
                  <button key={imp} onClick={() => setCalImpact(imp)} className="rounded px-2 py-0.5 text-[9px] font-semibold capitalize transition-colors" style={calImpact === imp ? { background: imp === "high" ? "#ef444420" : imp === "medium" ? "#f9731620" : imp === "low" ? "#22c55e20" : "#2f81f720", color: imp === "high" ? "#ef4444" : imp === "medium" ? "#f97316" : imp === "low" ? "#22c55e" : "#2f81f7", border: `1px solid ${imp === "high" ? "#ef4444" : imp === "medium" ? "#f97316" : imp === "low" ? "#22c55e" : "#2f81f7"}` } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{imp}</button>
                ))}
              </div>
              {!calendarLoaded ? (
                <div className="p-6 text-center text-[var(--muted)]"><i className="fa-solid fa-circle-notch fa-spin mr-1" />Loading calendar…</div>
              ) : (() => {
                const filtered = calendar.filter((ev) => calImpact === "all" || ev.impact === calImpact);
                if (!filtered.length) return <div className="p-6 text-center text-[var(--muted)]">No events for this week.</div>;
                let lastDate = "";
                return filtered.map((ev, i) => {
                  const dt = ev.time ? new Date(ev.time.replace(" ", "T") + "Z") : null;
                  const dateStr = dt ? dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
                  const timeStr = dt ? dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
                  const impColor = ev.impact === "high" ? "#ef4444" : ev.impact === "medium" ? "#f97316" : ev.impact === "low" ? "#22c55e" : "var(--muted)";
                  const showDate = dateStr !== lastDate; lastDate = dateStr;
                  const isToday = dt ? dt.toDateString() === new Date().toDateString() : false;
                  const nowMs = Date.now(); void calTick; // calTick forces re-render each second
                  const isFuture = dt ? dt.getTime() > nowMs : false;
                  const secsUntil = dt && isFuture ? Math.floor((dt.getTime() - nowMs) / 1000) : null;
                  const timeUntil = secsUntil != null ? (
                    secsUntil < 60 ? secsUntil + "s" :
                    secsUntil < 3600 ? Math.floor(secsUntil / 60) + "m " + (secsUntil % 60) + "s" :
                    Math.floor(secsUntil / 3600) + "h " + Math.floor((secsUntil % 3600) / 60) + "m " + (secsUntil % 60) + "s"
                  ) : null;
                  return (
                    <div key={i}>
                      {showDate && <div className="border-b border-[var(--border)] px-2 py-1 text-[9px] font-bold uppercase tracking-wide" style={{ background: isToday ? "rgba(22,199,154,0.1)" : "var(--soft)", color: isToday ? "var(--accent)" : "var(--muted)", borderLeft: isToday ? "3px solid var(--accent)" : undefined }}>{isToday ? "▸ TODAY — " : ""}{dateStr}</div>}
                      <div className="flex items-start gap-2 border-b border-[var(--border)] px-2 py-1.5" style={{ background: isToday && isFuture ? "rgba(22,199,154,0.04)" : undefined }}>
                        <div className="mt-0.5 w-3 shrink-0 h-3 rounded-full" style={{ background: impColor }} title={ev.impact} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--text)]">{ev.event}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[9px] text-[var(--muted)]">
                            <span className="rounded bg-[var(--soft)] px-1 py-0.5 font-bold">{ev.country}</span>
                            <span>{timeStr}</span>
                            {timeUntil && <span className="rounded px-1 py-0.5 font-semibold" style={{ background: "rgba(22,199,154,0.12)", color: "var(--accent)" }}>in {timeUntil}</span>}
                            {ev.actual != null && <span style={{ color: "#22c55e" }}>A: {ev.actual}{ev.unit}</span>}
                            {ev.estimate != null && <span>F: {ev.estimate}{ev.unit}</span>}
                            {ev.prev != null && <span>P: {ev.prev}{ev.unit}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : rightTab === "ANALYTICS" ? (() => {
            const day = 86400000;
            const now = Date.now();
            const cutoff = analyticsRange === "today" ? now - day : analyticsRange === "week" ? now - 7 * day : analyticsRange === "month" ? now - 30 * day : 0;
            const rows = history.filter((h: any) => {
              if (h.kind === "FIN") return false;
              const t = new Date(h.closedAt || h.closeTime || h.closeDate || 0).getTime();
              return t >= cutoff;
            });
            const tabs = (
              <div className="sticky top-0 z-10 flex gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
                {(["today", "week", "month", "all"] as const).map((r) => (
                  <button key={r} onClick={() => setAnalyticsRange(r)} className="flex-1 rounded py-0.5 text-[9px] font-semibold capitalize" style={{ background: analyticsRange === r ? "var(--accent)" : "transparent", color: analyticsRange === r ? "#fff" : "var(--muted)", border: "1px solid " + (analyticsRange === r ? "transparent" : "var(--border)") }}>{r === "today" ? "Today" : r === "week" ? "7D" : r === "month" ? "30D" : "All"}</button>
                ))}
              </div>
            );
            if (!rows.length) return (
              <div className="text-[11px]">
                {tabs}
                <div className="flex h-32 items-center justify-center italic" style={{ color: "var(--muted)" }}>No closed trades{analyticsRange !== "all" ? " in this period" : ""}.</div>
              </div>
            );
            const wins = rows.filter((h: any) => Number(h.pnl) > 0).length;
            const losses = rows.filter((h: any) => Number(h.pnl) < 0).length;
            const totalPL = rows.reduce((s: number, h: any) => s + Number(h.pnl || 0), 0);
            const avgPL = totalPL / rows.length;
            const best = rows.reduce((b: any, h: any) => Number(h.pnl) > Number(b.pnl) ? h : b, rows[0]);
            const worst = rows.reduce((b: any, h: any) => Number(h.pnl) < Number(b.pnl) ? h : b, rows[0]);
            const avgHold = rows.reduce((s: number, h: any) => {
              const o = new Date(h.openedAt || 0).getTime(), c = new Date(h.closedAt || h.closeTime || 0).getTime();
              return s + (c > o ? c - o : 0);
            }, 0) / rows.length;
            const holdStr = (ms: number) => { if (!ms || ms < 0) return "—"; const m = Math.floor(ms / 60000); if (m < 60) return m + "m"; return Math.floor(m / 60) + "h " + (m % 60) + "m"; };
            const symMap: Record<string, number> = {};
            rows.forEach((h: any) => { symMap[h.symbol] = (symMap[h.symbol] || 0) + Number(h.pnl || 0); });
            const topSyms = Object.entries(symMap).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
            const stat = (label: string, val: string, color?: string) => (
              <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5">
                <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: color || "var(--text)" }}>{val}</span>
              </div>
            );
            return (
              <div className="text-[11px]">
                {tabs}
                {stat("Total Trades", String(rows.length))}
                {stat("Win Rate", rows.length ? (wins / rows.length * 100).toFixed(1) + "%" : "—", wins > losses ? BUY : SELL)}
                {stat("Wins / Losses", `${wins} / ${losses}`)}
                {stat("Total P/L", (totalPL >= 0 ? "+" : "") + fmt(totalPL), totalPL >= 0 ? BUY : SELL)}
                {stat("Avg P/L", (avgPL >= 0 ? "+" : "") + fmt(avgPL), avgPL >= 0 ? BUY : SELL)}
                {stat("Best Trade", "+" + fmt(Number(best.pnl)) + " " + best.symbol, BUY)}
                {stat("Worst Trade", fmt(Number(worst.pnl)) + " " + worst.symbol, SELL)}
                {stat("Avg Hold Time", holdStr(avgHold))}
                <div className="border-b border-[var(--border)] px-2 py-1.5">
                  <div className="mb-1 text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Top Symbols</div>
                  {topSyms.map(([sym, pl]) => (
                    <div key={sym} className="flex items-center justify-between py-0.5">
                      <span className="font-medium">{sym}</span>
                      <span className="tabular-nums font-bold" style={{ color: pl >= 0 ? BUY : SELL }}>{pl >= 0 ? "+" : ""}{fmt(pl)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })() : (
            <div className="flex flex-col gap-2 p-2">

              {/* Order type: MARKET | LIMIT | STOP | STOP_LIMIT */}
              <div>
                <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Order Type</div>
                <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
                  {(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] as const).map((t) => (
                    <button key={t} onClick={() => { setOrderType(t); if (t !== "MARKET" && !pendingPrice && price != null) setPendingPrice(price.toFixed(d)); }} className="flex-1 py-1.5 text-[9px] font-bold transition-colors" style={orderType === t ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{t.replace("_", " ")}</button>
                  ))}
                </div>
              </div>

              {/* Entry price — Limit / Stop / Stop Limit only */}
              {orderType !== "MARKET" && (
                <div className="flex flex-col gap-1.5">
                  <div>
                    <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{orderType === "STOP_LIMIT" ? "Stop Price (trigger)" : "Entry Price"}</div>
                    <input type="number" value={pendingPrice} onChange={(e) => setPendingPrice(e.target.value)} placeholder="Target Price" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[12px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                  {orderType === "STOP_LIMIT" && (
                    <div>
                      <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Limit Price (fill at)</div>
                      <input type="number" value={stopLimitEntry} onChange={(e) => setStopLimitEntry(e.target.value)} placeholder="Limit Price" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[12px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    </div>
                  )}
                  <div>
                    <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Expiry (GTD — leave blank for GTC)</div>
                    <input type="datetime-local" value={gtdExpiry} onChange={(e) => setGtdExpiry(e.target.value)} className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                </div>
              )}

              {/* Volume + quick-lot buttons in one bordered block */}
              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                <div className="border-b border-[var(--border)] px-2 py-1 flex items-center justify-between">
                  <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Volume (Lots)</span>
                  {price != null && <span className="text-[8px] tabular-nums" style={{ color: "var(--muted)" }}>{(vol * csz(selSym)).toLocaleString()} units</span>}
                </div>
                <div className="flex items-center gap-1 px-1.5 py-1.5">
                  <button onClick={() => setVol((v) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--soft)] hover:text-[var(--text)] active:scale-95">−</button>
                  <input ref={volInputRef} type="number" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1 text-center text-[14px] font-bold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  <button onClick={() => setVol((v) => +(v + 0.01).toFixed(2))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--soft)] hover:text-[var(--text)] active:scale-95">+</button>
                </div>
                <div className="grid grid-cols-5 border-t border-[var(--border)]">
                  {LOTS.map((l) => <button key={l} onClick={() => setVol(l)} className="py-1 text-[9px] font-semibold transition-colors border-r border-[var(--border)] last:border-r-0" style={vol === l ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{l}</button>)}
                </div>
              </div>

              {/* Stop Loss — MT5 style: full-width, prominent red border */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#e0394a" }}><i className="fa-solid fa-shield-halved mr-1 text-[8px]" />Stop Loss</span>
                  {sl && <button onClick={() => setSl("")} className="text-[8px]" style={{ color: "var(--muted)" }}>Clear</button>}
                </div>
                <input type="number" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="0.00000" className="h-9 w-full rounded-lg border-2 bg-[var(--bg)] px-3 text-center text-[13px] font-bold tabular-nums text-[var(--text)] outline-none transition-colors" style={{ borderColor: sl ? "#e0394a" : "var(--border)" }} />
              </div>

              {/* Take Profit — MT5 style: full-width, prominent green border */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#10b981" }}><i className="fa-solid fa-flag-checkered mr-1 text-[8px]" />Take Profit</span>
                  {tp && <button onClick={() => setTp("")} className="text-[8px]" style={{ color: "var(--muted)" }}>Clear</button>}
                </div>
                <input type="number" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="0.00000" className="h-9 w-full rounded-lg border-2 bg-[var(--bg)] px-3 text-center text-[13px] font-bold tabular-nums text-[var(--text)] outline-none transition-colors" style={{ borderColor: tp ? "#10b981" : "var(--border)" }} />
              </div>

              {/* R/R + P&L estimate — only when both SL and TP are set */}
              {(() => {
                const ref = orderType === "MARKET" ? (price ?? 0) : (Number(pendingPrice) || (price ?? 0));
                const pipSz = pipOf(eDg(selSym));
                const tpPips = tp && ref ? Math.abs(Number(tp) - ref) / pipSz : 0;
                const slPips = sl && ref ? Math.abs(Number(sl) - ref) / pipSz : 0;
                if (!tpPips && !slPips) return null;
                const rr = slPips > 0 && tpPips > 0 ? tpPips / slPips : null;
                const estTP = tpPips > 0 ? tpPips * vol : null;
                const estSL = slPips > 0 ? slPips * vol : null;
                return (
                  <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[9px] font-semibold" style={{ background: "var(--soft)" }}>
                    {rr != null && <span className="rounded px-1.5 py-0.5 font-bold" style={{ background: rr >= 1 ? "#22c55e22" : "#f9731622", color: rr >= 1 ? "#22c55e" : "#f97316" }}>R:R {rr.toFixed(2)}</span>}
                    {estTP != null && <span style={{ color: "#10b981" }}>TP +{fmt(estTP)}</span>}
                    {estSL != null && <span style={{ color: "#e0394a" }}>SL -{fmt(estSL)}</span>}
                  </div>
                );
              })()}

              {/* Advanced settings (trailing stop + comment) — collapsed */}
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide select-none" style={{ color: "var(--muted)" }}>
                  <i className="fa-solid fa-chevron-right text-[7px] transition-transform group-open:rotate-90" />Advanced
                </summary>
                <div className="mt-1.5 space-y-1.5">
                  {orderType === "MARKET" && (
                    <div>
                      <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Trailing Stop (pips, 0 = off)</div>
                      <input type="number" min="0" step="1" value={trail} onChange={(e) => setTrail(e.target.value)} placeholder="0" className="h-7 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[10px] tabular-nums text-[var(--text)] outline-none text-center" />
                    </div>
                  )}
                  <div>
                    <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Comment (optional)</div>
                    <input type="text" maxLength={128} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="" className="h-7 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[10px] text-[var(--text)] outline-none" />
                  </div>
                </div>
              </details>

              {/* Compact 3-col info bar: Margin / Pip Value / Free Margin */}
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[var(--border)] text-[9px]" style={{ background: "var(--border)" }}>
                <div className="flex flex-col items-center py-1.5" style={{ background: "var(--soft)" }}>
                  <span style={{ color: "var(--muted)" }}>Margin</span>
                  <span className="mt-0.5 font-bold tabular-nums" style={{ color: "var(--text)" }}>{cSym}{margin ? fmt(margin) : "0.00"}</span>
                </div>
                <div className="flex flex-col items-center py-1.5" style={{ background: "var(--soft)" }}>
                  <span style={{ color: "var(--muted)" }}>Pip Val</span>
                  <span className="mt-0.5 font-bold tabular-nums" style={{ color: "var(--text)" }}>{cSym}{fmt(pipVal)}</span>
                </div>
                <div className="flex flex-col items-center py-1.5" style={{ background: "var(--soft)" }}>
                  <span style={{ color: "var(--muted)" }}>Free Mrg</span>
                  <span className="mt-0.5 font-bold tabular-nums" style={{ color: "#22c55e" }}>{account ? cSym + fmt(free) : "--"}</span>
                </div>
              </div>

              {!account && <div className="text-center text-[10px]" style={{ color: SELL }}>No account selected</div>}
              {err && <div className="text-center text-[10px]" style={{ color: SELL }}>{err}</div>}
            </div>
          )}
          </div>

          {/* SELL | SPRD | BUY — visible on TRADE and DOM tabs */}
          {(rightTab === "TRADE" || rightTab === "DOM") && (
            <div className="shrink-0 border-t border-[var(--border)] p-2">
              <div className="flex items-stretch gap-1">
                <button onClick={() => place("SELL")} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2.5 font-semibold text-white shadow-md transition-transform active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#ff6b78,#e0394a 70%,#b9293a)" }}>
                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-down text-[8px]" />Sell</span>
                  <span className="text-[14px] tabular-nums">{bid != null ? gnum(bid, d) : "…"}</span>
                </button>
                <div className="flex flex-col items-center justify-center gap-0.5 px-1.5 shrink-0">
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--muted)" }}>{_spreadPips(selSym) > 0 ? Math.round(_spreadPips(selSym)) : "—"}</span>
                  <span className="text-[7px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>pts</span>
                </div>
                <button onClick={() => place("BUY")} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2.5 font-semibold text-white shadow-md transition-transform active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#5aa0ff,#2f81f7 70%,#1e63cc)" }}>
                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-up text-[8px]" />Buy</span>
                  <span className="text-[14px] tabular-nums">{ask != null ? gnum(ask, d) : "…"}</span>
                </button>
              </div>
            </div>
          )}

        </aside>
      </div>

      {account && used > 0 && level > 0 && level < 150 && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold animate-pulse" style={{ background: level < 100 ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.13)", color: level < 100 ? "#ef4444" : "#f97316", borderBottom: `1px solid ${level < 100 ? "#ef444440" : "#f9731640"}` }}>
          <i className="fa-solid fa-triangle-exclamation" />
          {level < 100 ? `MARGIN CALL — Level ${level.toFixed(1)}%. Positions may be closed immediately.` : `Low margin warning — Level ${level.toFixed(1)}%. Reduce exposure or add funds.`}
        </div>
      )}
      {(() => {
        const mlColor = !account || !level ? "#4b5563" : level >= 200 ? "#22c55e" : level >= 150 ? "#facc15" : level >= 100 ? "#f97316" : "#ef4444";
        const mlPct   = Math.min((level / 500) * 100, 100); // bar fills at 500% level
        return (
          <div className="border-y border-[var(--border)] bg-[var(--panel)]" style={{ color: "#facc15" }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 text-[11px] font-bold">
              <span style={{ color: "var(--muted)" }}>Balance: <span className="font-mono font-bold text-[var(--text)]">{account ? cSym + fmt(balance) : "--"}</span></span>
              {account && Number(account.credit) > 0 && (
                <span style={{ color: "var(--muted)" }}>Credit: <span className="font-mono font-bold" style={{ color: "#f59e0b" }}>{cSym + fmt(Number(account.credit))}</span></span>
              )}
              <span style={{ color: "var(--muted)" }}>Equity: <span className="font-mono font-bold" style={{ color: !account ? "var(--text)" : equity >= balance ? BUY : SELL }}>{account ? cSym + fmt(equity) : "--"}</span></span>
              <span style={{ color: "var(--muted)" }}>Margin: <span className="font-mono font-bold text-[var(--text)]">{account ? cSym + fmt(used) : "--"}</span></span>
              <span style={{ color: "var(--muted)" }}>Free Margin: <span className="font-mono font-bold" style={{ color: account && free < 0 ? SELL : "#22c55e" }}>{account ? cSym + fmt(free) : "--"}</span></span>
              <span className="flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                Margin Level:
                <span className="font-mono font-bold" style={{ color: mlColor }}>{account && level ? level.toFixed(1) + "%" : "--"}</span>
                {account && used > 0 && (
                  <span className="inline-flex h-[6px] w-[64px] overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                    <span className="h-full rounded-full transition-all duration-500" style={{ width: mlPct + "%", background: mlColor }} />
                  </span>
                )}
              </span>
              <span style={{ color: "var(--muted)" }}>Profit: <span className="font-mono font-bold" style={{ color: floating >= 0 ? BUY : SELL }}>{account ? (floating >= 0 ? "+" : "-") + cSym + fmt(Math.abs(floating)) : "--"}</span></span>
            </div>
          </div>
        );
      })()}

      <div onMouseDown={dragY} className="h-1 cursor-row-resize bg-[var(--border)] hover:bg-[#3b82f6]" />

      <div className="flex shrink-0 flex-col bg-[var(--panel)]" style={{ height: tbH }}>
        <div className="flex items-center gap-1 border-b border-[var(--border)] px-2">
          <button onClick={() => setBotTab("positions")} className={tab(botTab === "positions")} style={botTab === "positions" ? { color: BUY } : undefined}>Positions {positions.length > 0 && <span className="ml-0.5 rounded px-1 text-[9px]" style={{ background: "rgba(38,166,154,0.15)", color: BUY }}>{positions.length}</span>}</button>
          <button onClick={() => setBotTab("pending")} className={tab(botTab === "pending")} style={botTab === "pending" ? { color: "#5aa9ff" } : undefined}>Pending {pending.length > 0 && <span className="ml-0.5 rounded px-1 text-[9px]" style={{ background: "rgba(90,169,255,0.15)", color: "#5aa9ff" }}>{pending.length}</span>}</button>
          <button onClick={() => setBotTab("history")} className={tab(botTab === "history")} style={botTab === "history" ? { color: BUY } : undefined}>History</button>
          <button onClick={() => setBotTab("summary")} className={tab(botTab === "summary")} style={botTab === "summary" ? { color: BUY } : undefined}>Summary</button>
          <button onClick={() => setBotTab("requests")} className={tab(botTab === "requests")} style={botTab === "requests" ? { color: BUY } : undefined}>Requests</button>
          <div className="ml-auto flex items-center gap-1 pr-1">
            {botTab === "positions" && positions.length > 0 && (
              <button title="Export positions as CSV" onClick={() => exportCSV("positions")} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[9px] font-semibold" style={{ color: "var(--muted)" }}>
                <i className="fa-solid fa-download text-[8px]" />CSV
              </button>
            )}
            {botTab === "history" && history.length > 0 && (
              <button title="Export history as CSV" onClick={() => exportCSV("history")} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[9px] font-semibold" style={{ color: "var(--muted)" }}>
                <i className="fa-solid fa-download text-[8px]" />CSV
              </button>
            )}
          </div>
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
              <thead><tr className="text-left text-[var(--muted)]"><th className="px-2 py-1 font-normal">#Ticket</th><Sth tbl="pos" k="name" label="Name" /><Sth tbl="pos" k="date" label="Date" /><Sth tbl="pos" k="qty" label="Qty" align="right" /><Sth tbl="pos" k="open" label="Open" align="right" /><Sth tbl="pos" k="current" label="Current" align="right" /><Sth tbl="pos" k="tp" label="TP" align="right" /><Sth tbl="pos" k="sl" label="SL" align="right" /><th className="px-2 py-1 font-normal text-right" title="Trailing Stop (pips)">Trail</th>{swapEnabled && <><th className="px-2 py-1 font-normal text-right">Commission</th><th className="px-2 py-1 font-normal text-right">Swap</th><Sth tbl="pos" k="pnl" label="Gross P/L" align="right" /></>}<Sth tbl="pos" k="pnl" label={swapEnabled ? "Net P/L" : "P/L"} align="right" /><th className="px-2 py-1 font-normal text-right"></th></tr></thead>
              <tbody>
                {!dataReady ? <tr><td colSpan={14} className="px-2 py-3 text-center text-[var(--muted)]"><i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…</td></tr> : positions.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={14}>No open positions.</td></tr> : sortRows("pos", positions, { name: (p) => p.symbol, date: (p) => new Date(p.openedAt).getTime(), qty: (p) => Number(p.lots), open: (p) => Number(p.openPrice), current: (p) => Number(prices[p.symbol] ?? p.openPrice), tp: (p) => Number(p.tp) || null, sl: (p) => Number(p.sl) || null, pnl: (p) => pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)) }).map((p) => { const cur = prices[p.symbol] ?? p.openPrice; const pl = pnlOf(p, cur, csz(p.symbol)); const cdir = dirs[p.symbol] || 0; return (
                  <tr key={p.id} className="border-t border-[var(--border)] cursor-context-menu" title={p.comment || undefined} onContextMenu={(e) => { e.preventDefault(); setPosCtx({ x: e.clientX, y: e.clientY, pos: p }); }}>
                    <td className="px-2 py-1 text-[var(--muted)] tabular-nums">{p.ticket ? String(p.ticket) : "—"}</td>
                    <td className="px-2 py-1">{p.symbol} <span style={{ color: p.type === "BUY" ? BUY : SELL }}>{p.type === "BUY" ? "Buy" : "Sell"}</span>{p.masterTradeId && <span className="ml-1 rounded px-0.5 text-[8px] font-bold" style={{ background: "#7c3aed22", color: "#7c3aed" }}>COPY</span>}</td>
                    <td className="px-2 py-1 text-[var(--muted)]">{new Date(p.openedAt).toLocaleDateString()}</td>
                    <td className="px-2 py-1 text-right">{p.lots}</td><td className="px-2 py-1 text-right">{gnum(p.openPrice, dg(p.symbol))}</td>
                    <td className="px-2 py-1 text-right tabular-nums" style={{ color: cdir > 0 ? "#16c784" : cdir < 0 ? "#e05260" : "var(--text)", transition: "color 0.3s ease" }}>{gnum(cur, dg(p.symbol))}</td>
                    <td className="px-2 py-1 text-right" onClick={() => { if (!tpSlEdit) setTpSlEdit({ id: p.id, field: "tp", val: p.tp ? String(p.tp) : "" }); }} title="Click to edit TP" style={{ cursor: "pointer" }}>
                      {tpSlEdit !== null && tpSlEdit.id === p.id && tpSlEdit.field === "tp" ? (
                        <input type="text" inputMode="decimal" autoFocus value={tpSlEdit.val} onChange={(e) => setTpSlEdit({ id: p.id, field: "tp", val: e.target.value })} onBlur={saveTpSl} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTpSlEdit(null); }} className="w-20 rounded border px-1 py-0.5 text-right text-[10px]" style={{ background: "var(--soft)", borderColor: "#10b981", color: "#10b981" }} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span style={{ color: p.tp ? "#10b981" : "var(--muted)" }}>{p.tp ? gnum(p.tp, dg(p.symbol)) : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right" onClick={() => { if (!tpSlEdit) setTpSlEdit({ id: p.id, field: "sl", val: p.sl ? String(p.sl) : "" }); }} title={p.trailingStop > 0 ? "Trailing Stop active — SL auto-adjusts" : "Click to edit SL"} style={{ cursor: "pointer" }}>
                      {tpSlEdit !== null && tpSlEdit.id === p.id && tpSlEdit.field === "sl" ? (
                        <input type="text" inputMode="decimal" autoFocus value={tpSlEdit.val} onChange={(e) => setTpSlEdit({ id: p.id, field: "sl", val: e.target.value })} onBlur={saveTpSl} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTpSlEdit(null); }} className="w-20 rounded border px-1 py-0.5 text-right text-[10px]" style={{ background: "var(--soft)", borderColor: "#f43f5e", color: "#f43f5e" }} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span style={{ color: p.sl ? "#f43f5e" : "var(--muted)" }}>
                          {p.trailingStop > 0 && <span className="mr-0.5 rounded px-0.5 text-[8px] font-bold" style={{ background: "#f59e0b22", color: "#f59e0b" }}>TSL</span>}
                          {p.sl ? gnum(p.sl, dg(p.symbol)) : "—"}
                        </span>
                      )}
                    </td>
                    {/* Trailing stop inline edit */}
                    <td className="px-2 py-1 text-right" onClick={() => { if (!tpSlEdit) setTpSlEdit({ id: p.id, field: "trailingStop", val: p.trailingStop > 0 ? String(Math.round(p.trailingStop / pipOf(dg(p.symbol)))) : "" }); }} title="Trailing stop (pips). Click to edit. 0 = off." style={{ cursor: "pointer" }}>
                      {tpSlEdit !== null && tpSlEdit.id === p.id && tpSlEdit.field === "trailingStop" ? (
                        <input type="number" inputMode="decimal" autoFocus value={tpSlEdit.val} onChange={(e) => setTpSlEdit({ id: p.id, field: "trailingStop", val: e.target.value })} onBlur={saveTpSl} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTpSlEdit(null); }} className="w-16 rounded border px-1 py-0.5 text-right text-[10px]" style={{ background: "var(--soft)", borderColor: "#f59e0b", color: "#f59e0b" }} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span style={{ color: p.trailingStop > 0 ? "#f59e0b" : "var(--muted)" }}>{p.trailingStop > 0 ? Math.round(p.trailingStop / pipOf(dg(p.symbol))) + "p" : "—"}</span>
                      )}
                    </td>
                    {/* Commission, Swap and Gross P/L — shown only when swap enabled */}
                    {swapEnabled && <>
                      <td className="px-2 py-1 text-right" style={{ color: Number(p.commission) !== 0 ? SELL : "var(--muted)" }}>{Number(p.commission) !== 0 ? "-" + cSym + fmt(Math.abs(Number(p.commission))) : "0.00"}</td>
                      <td className="px-2 py-1 text-right" style={{ color: Number(p.swap) !== 0 ? SELL : "var(--muted)" }}>{Number(p.swap) !== 0 ? (Number(p.swap) >= 0 ? "+" : "-") + cSym + fmt(Math.abs(Number(p.swap))) : "0.00"}</td>
                      <td className="px-2 py-1 text-right" style={{ color: pl >= 0 ? BUY : SELL }}>{(pl >= 0 ? "+" : "-") + cSym + fmt(Math.abs(pl))}</td>
                    </>}
                    {/* Net P/L = gross + swap - commission (or just gross when swap disabled) */}
                    {(() => { const net = swapEnabled ? pl + Number(p.swap) - Number(p.commission) : pl; return <td className="px-1 py-0.5 text-right font-bold tabular-nums text-[11px]" style={{ color: net >= 0 ? BUY : SELL }}>{(net >= 0 ? "+" : "-") + cSym + fmt(Math.abs(net))}</td>; })()}
                    <td className="px-2 py-1 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {Number(p.lots) > 0.01 ? <button title="Partial close" style={{ color: "var(--muted)" }} onClick={() => setPartialClose({ id: p.id, sym: p.symbol, lots: Number(p.lots), closeLots: "" })} className="text-[9px] px-1">½</button> : <span title="Min lot — cannot partial close" className="text-[9px] px-1 opacity-20 cursor-not-allowed">½</span>}
                        <button style={{ color: SELL }} onClick={() => close(p.id)}>X</button>
                      </div>
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "pending" && pending.length === 0 && (
            <div className="flex h-full items-center justify-center py-8 text-[11px] italic" style={{ color: "var(--muted)" }}>No pending orders.</div>
          )}
          {botTab === "pending" && pending.length > 0 && (
            <table className="w-full text-[10px]">
              <thead>
                <tr><th colSpan={9} className="border-b px-2 pb-1 pt-2 text-left text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#5aa9ff", borderColor: "rgba(90,169,255,0.35)" }}><i className="fa-regular fa-clock mr-1" />Pending Orders ({pending.length}) — waiting to trigger</th></tr>
                <tr className="text-left text-[var(--muted)]"><th className="px-2 py-1 font-normal">Order</th><th className="px-2 py-1 font-normal">Type</th><th className="px-2 py-1 font-normal text-right">Lots</th><th className="px-2 py-1 font-normal text-right">Trigger</th><th className="px-2 py-1 font-normal text-right">Current</th><th className="px-2 py-1 font-normal text-right">Distance</th><th className="px-2 py-1 font-normal text-right">SL</th><th className="px-2 py-1 font-normal text-right">TP</th><th className="px-2 py-1 font-normal text-right"></th></tr>
              </thead>
              <tbody>
                {pending.map((o: any) => {
                  const d = dg(o.symbol); const trig = Number(o.price); const cur = prices[o.symbol]; const dist = cur != null ? Math.abs(trig - cur) : null;
                  const label = (o.side === "BUY" ? "Buy" : "Sell") + " " + (o.kind === "LIMIT" ? "Limit" : o.kind === "STOP_LIMIT" ? "Stop Limit" : "Stop"); const c = o.side === "BUY" ? "#5aa9ff" : SELL;
                  const isEditing = pendEdit?.id === o.id;
                  if (isEditing) return (
                  <tr key={o.id} className="border-t border-[var(--border)]" style={{ background: "rgba(90,169,255,0.13)" }}>
                    <td className="px-2 py-1" style={{ borderLeft: "3px solid #5aa9ff" }}><i className="fa-solid fa-pen mr-1" style={{ color: "#5aa9ff" }} />{o.symbol}</td>
                    <td className="px-2 py-1"><span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: c + "22", color: c }}>{label}</span></td>
                    <td className="px-2 py-1 text-right">{o.lots}</td>
                    <td className="px-2 py-1"><input type="number" step="any" value={pendEdit!.price} onChange={(e) => setPendEdit((p) => p && ({ ...p, price: e.target.value }))} className="w-20 rounded border border-[#5aa9ff] bg-[var(--soft)] px-1 text-right text-[10px] tabular-nums outline-none" /></td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{cur != null ? gnum(cur, d) : "…"}</td>
                    <td className="px-2 py-1"><input type="number" step="any" placeholder="SL" value={pendEdit!.sl} onChange={(e) => setPendEdit((p) => p && ({ ...p, sl: e.target.value }))} className="w-16 rounded border border-[var(--border)] bg-[var(--soft)] px-1 text-right text-[10px] tabular-nums outline-none" /></td>
                    <td className="px-2 py-1"><input type="number" step="any" placeholder="TP" value={pendEdit!.tp} onChange={(e) => setPendEdit((p) => p && ({ ...p, tp: e.target.value }))} className="w-16 rounded border border-[var(--border)] bg-[var(--soft)] px-1 text-right text-[10px] tabular-nums outline-none" /></td>
                    <td className="px-2 py-1 text-right flex items-center gap-1 justify-end">
                      <button title="Save" style={{ color: "#16c784" }} onClick={async () => { await editPending(o.id, Number(pendEdit!.price), Number(pendEdit!.sl) || 0, Number(pendEdit!.tp) || 0); setPendEdit(null); }}><i className="fa-solid fa-check" /></button>
                      <button title="Cancel edit" style={{ color: "var(--muted)" }} onClick={() => setPendEdit(null)}><i className="fa-solid fa-xmark" /></button>
                    </td>
                  </tr>);
                  return (
                  <tr key={o.id} className="border-t border-[var(--border)]" style={{ background: "rgba(90,169,255,0.07)" }}>
                    <td className="px-2 py-1" style={{ borderLeft: "3px dashed rgba(90,169,255,0.55)" }}><i className="fa-regular fa-clock mr-1" style={{ color: "#5aa9ff" }} />{o.symbol}</td>
                    <td className="px-2 py-1"><span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: c + "22", color: c }}>{label}</span></td>
                    <td className="px-2 py-1 text-right">{o.lots}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{gnum(trig, d)}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{cur != null ? gnum(cur, d) : "…"}</td>
                    <td className="px-2 py-1 text-right text-[var(--muted)]">{dist != null ? gnum(dist, d) : "—"}</td>
                    <td className="px-2 py-1 text-right" style={{ color: o.sl ? "#ef5350" : "var(--muted)" }}>{o.sl ? gnum(o.sl, d) : "—"}</td>
                    <td className="px-2 py-1 text-right" style={{ color: o.tp ? "#10b981" : "var(--muted)" }}>{o.tp ? gnum(o.tp, d) : "—"}</td>
                    <td className="px-2 py-1 text-right flex items-center gap-1.5 justify-end">
                      <button title="Edit order" style={{ color: "#5aa9ff" }} onClick={() => setPendEdit({ id: o.id, price: String(trig), sl: o.sl ? String(Number(o.sl)) : "", tp: o.tp ? String(Number(o.tp)) : "" })}><i className="fa-solid fa-pen text-[9px]" /></button>
                      <button title="Cancel order" style={{ color: SELL }} onClick={() => cancelPending(o.id)}><i className="fa-solid fa-xmark" /></button>
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "history" && (
            <div className="flex items-center gap-1 px-2 py-1 text-[9px]">
              {(["all", "today", "week", "month"] as const).map((r) => <button key={r} onClick={() => setHistRange(r)} className="rounded px-2 py-0.5" style={histRange === r ? { background: BUY, color: "#04140e" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{r === "all" ? "All" : r === "today" ? "Today" : r === "week" ? "Week" : "Month"}</button>)}
              <a href={"/api/client/statement?accountId=" + accId} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 font-semibold text-white" style={{ background: "#ef4444", textDecoration: "none", fontSize: 9 }} title="Download PDF statement"><i className="fa-solid fa-file-pdf text-[8px]" /> PDF</a>
            </div>
          )}
          {botTab === "history" && (
            <table className="w-full text-[10px]">
              <thead><tr className="text-left text-[var(--muted)]"><th className="px-2 py-1 font-normal">#Ticket</th><Sth tbl="chist" k="name" label="Name" /><Sth tbl="chist" k="opened" label="Opened" /><Sth tbl="chist" k="closed" label="Closed" /><Sth tbl="chist" k="qty" label="Qty" align="right" /><Sth tbl="chist" k="open" label="Open" align="right" /><Sth tbl="chist" k="close" label="Close" align="right" /><Sth tbl="chist" k="sl" label="SL" align="right" /><Sth tbl="chist" k="tp" label="TP" align="right" /><Sth tbl="chist" k="reason" label="Reason" />{swapEnabled && <><Sth tbl="chist" k="swap" label="Swap" align="right" /><Sth tbl="chist" k="comm" label="Comm" align="right" /></>}<Sth tbl="chist" k="pnl" label={swapEnabled ? "Net P/L" : "P/L"} align="right" /></tr></thead>
              <tbody>
                {histShown.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={13}>No history.</td></tr> : sortRows("chist", histShown, { name: (h) => h.symbol, opened: (h) => h.openedAt ? new Date(h.openedAt).getTime() : null, closed: (h) => h.closedAt ? new Date(h.closedAt).getTime() : null, qty: (h) => Number(h.lots), open: (h) => Number(h.openPrice), close: (h) => Number(h.closePrice), sl: (h) => Number(h.sl), tp: (h) => Number(h.tp), reason: (h) => h.closeReason || "MANUAL", swap: (h) => Number(h.swap), comm: (h) => Number(h.commission), pnl: (h) => Number(h.pnl) + Number(h.swap) - Number(h.commission) }).map((h) => {
                  const r = h.closeReason || "MANUAL";
                  const rc = r === "TP" ? "#10b981" : r === "SL" ? "#f43f5e" : r === "MC" ? "#f59e0b" : "var(--muted)";
                  const net = swapEnabled ? Number(h.pnl) + Number(h.swap || 0) - Number(h.commission || 0) : Number(h.pnl);
                  return (
                  <tr key={h.id} className="border-t border-[var(--border)]" title={h.comment || undefined}>
                    <td className="px-2 py-1 text-[var(--muted)] tabular-nums">{h.ticket || "—"}</td>
                    <td className="px-2 py-1">{h.symbol} <span style={{ color: h.side === "BUY" ? BUY : SELL }}>{h.side}</span></td>
                    <td className="px-2 py-1 text-[var(--muted)]">{h.openedAt ? new Date(h.openedAt).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-[var(--muted)]">{h.closedAt ? new Date(h.closedAt).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{h.lots}</td>
                    <td className="px-2 py-1 text-right">{gnum(h.openPrice, dg(h.symbol))}</td>
                    <td className="px-2 py-1 text-right">{gnum(h.closePrice, dg(h.symbol))}</td>
                    <td className="px-2 py-1 text-right" style={{ color: h.sl ? "#f43f5e" : "var(--muted)" }}>{h.sl ? gnum(h.sl, dg(h.symbol)) : "—"}</td>
                    <td className="px-2 py-1 text-right" style={{ color: h.tp ? "#10b981" : "var(--muted)" }}>{h.tp ? gnum(h.tp, dg(h.symbol)) : "—"}</td>
                    <td className="px-2 py-1"><span style={{ color: rc, fontWeight: r !== "MANUAL" ? 600 : "normal" }}>{r === "MANUAL" ? "—" : r}</span></td>
                    {swapEnabled && <>
                      <td className="px-2 py-1 text-right" style={{ color: Number(h.swap) !== 0 ? (Number(h.swap) >= 0 ? BUY : SELL) : "var(--muted)" }}>{Number(h.swap) !== 0 ? (Number(h.swap) >= 0 ? "+" : "") + fmt(Number(h.swap)) : "—"}</td>
                      <td className="px-2 py-1 text-right" style={{ color: Number(h.commission) > 0 ? SELL : "var(--muted)" }}>{Number(h.commission) > 0 ? "-" + cSym + fmt(Number(h.commission)) : "—"}</td>
                    </>}
                    <td className="px-2 py-0.5 text-right"><span className="inline-block rounded px-2 py-0.5 font-bold tabular-nums text-[11px]" style={{ background: net >= 0 ? "rgba(38,166,154,0.13)" : "rgba(239,83,80,0.13)", color: net >= 0 ? BUY : SELL }}>{(net >= 0 ? "+" : "-") + cSym + fmt(Math.abs(net))}</span></td>
                  </tr>); })}
              </tbody>
            </table>
          )}
          {botTab === "summary" && (() => {
            // By direction
            const buys = positions.filter((p) => p.type === "BUY");
            const sells = positions.filter((p) => p.type === "SELL");
            const buyPnl = buys.reduce((a: number, p: any) => a + pnlOfAcc(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
            const sellPnl = sells.reduce((a: number, p: any) => a + pnlOfAcc(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
            const buyLots = buys.reduce((a: number, p: any) => a + Number(p.lots), 0);
            const sellLots = sells.reduce((a: number, p: any) => a + Number(p.lots), 0);
            // By symbol
            const symMap: Record<string, { buy: number; sell: number; lots: number; pnl: number }> = {};
            for (const p of positions) {
              const s = p.symbol; if (!symMap[s]) symMap[s] = { buy: 0, sell: 0, lots: 0, pnl: 0 };
              const pl = pnlOfAcc(p, prices[s] ?? p.openPrice, csz(s));
              symMap[s].lots += Number(p.lots); symMap[s].pnl += pl;
              if (p.type === "BUY") symMap[s].buy += Number(p.lots);
              else symMap[s].sell += Number(p.lots);
            }
            const symRows = Object.entries(symMap).sort((a, b) => Math.abs(b[1].pnl) - Math.abs(a[1].pnl));
            return (
              <div className="p-3 text-[10px]">
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([ ["BALANCE", cSym + fmt(balance), "var(--text)"], ["EQUITY", cSym + fmt(equity), "var(--text)"], ["FLOATING P/L", (floating >= 0 ? "+" : "-") + cSym + fmt(Math.abs(floating)), floating >= 0 ? BUY : SELL], ["CLOSED P/L", (Number(account?.pnl || 0) >= 0 ? "+" : "-") + cSym + fmt(Math.abs(Number(account?.pnl || 0))), Number(account?.pnl || 0) >= 0 ? BUY : SELL], ["DEPOSITS", cSym + fmt(Number(account?.deposit || 0)), BUY], ["WITHDRAWALS", "-" + cSym + fmt(Number(account?.withdrawal || 0)), SELL], ["CREDIT", cSym + fmt(Number(account?.credit || 0)), Number(account?.credit || 0) > 0 ? "#a855f7" : "var(--muted)"], ["BONUS", cSym + fmt(Number(account?.bonus || 0)), Number(account?.bonus || 0) > 0 ? GOLD : "var(--muted)"], ["INSURANCE", cSym + fmt(Number(account?.insurance || 0)), Number(account?.insurance || 0) > 0 ? "#06b6d4" : "var(--muted)"], ["FREE MARGIN", cSym + fmt(free), "var(--text)"], ["MARGIN LEVEL", level ? level.toFixed(1) + "%" : "—", GOLD] ] as [string, string, string][]).map(([k, v, c]) => (
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
                        <td className="py-1 text-right font-semibold" style={{ color: buyPnl >= 0 ? BUY : SELL }}>{(buyPnl >= 0 ? "+" : "-") + cSym + fmt(Math.abs(buyPnl))}</td>
                      </tr>
                      <tr className="border-t border-[var(--border)]">
                        <td className="py-1 pr-3 font-semibold" style={{ color: SELL }}>SELL</td>
                        <td className="py-1 pr-3 text-right">{sells.length}</td>
                        <td className="py-1 pr-3 text-right">{sellLots.toFixed(2)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: sellPnl >= 0 ? BUY : SELL }}>{(sellPnl >= 0 ? "+" : "-") + cSym + fmt(Math.abs(sellPnl))}</td>
                      </tr>
                      <tr className="border-t-2 border-[var(--border)]">
                        <td className="py-1 pr-3 font-semibold">Total</td>
                        <td className="py-1 pr-3 text-right">{positions.length}</td>
                        <td className="py-1 pr-3 text-right">{(buyLots + sellLots).toFixed(2)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: floating >= 0 ? BUY : SELL }}>{(floating >= 0 ? "+" : "-") + cSym + fmt(Math.abs(floating))}</td>
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
                            <td className="py-1 text-right font-semibold" style={{ color: v.pnl >= 0 ? BUY : SELL }}>{(v.pnl >= 0 ? "+" : "-") + cSym + fmt(Math.abs(v.pnl))}</td>
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
                          <td className="px-2 py-1 text-right font-semibold tabular-nums">{isAcc ? <span className="text-[var(--muted)]">1:{r.leverage}</span> : cSym + gmoney(r.amount)}</td>
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
      {instantCreditModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setInstantCreditModal(false)}>
          <div className="ui-pop w-full max-w-sm rounded-xl border p-5 shadow-2xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><i className="fa-solid fa-bolt-lightning" style={{ color: "#a855f7" }} /><span className="text-sm font-bold">Instant Credit</span></div>
              <button onClick={() => setInstantCreditModal(false)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            {creditRequest ? (
              <div className="space-y-3">
                <div className="rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: "rgba(240,180,41,0.4)", background: "rgba(240,180,41,0.08)", color: GOLD }}>
                  <i className="fa-solid fa-clock mr-1" /><b>Request Pending</b>
                  <div className="mt-1">You have a pending credit request for <b>${Number(creditRequest.amount).toFixed(2)}</b>. Please wait for admin approval.</div>
                </div>
              </div>
            ) : Number(account?.credit || 0) > 0 ? (
              <div className="space-y-3">
                <div className="rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: "rgba(239,83,80,0.4)", background: "rgba(239,83,80,0.08)", color: SELL }}>
                  <i className="fa-solid fa-lock mr-1" /><b>Outstanding Credit: ${Number(account.credit).toFixed(2)}</b>
                  <div className="mt-1">Please clear your existing credit balance before requesting a new one. Use Deposit → Clear Credit.</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[11px] text-[var(--muted)]">Request instant credit between <b>$250</b> and <b>$1,000</b>. The credit will be added to your equity upon admin approval.</div>
                {icErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{icErr}</div>}
                {icMsg && <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{icMsg}</div>}
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Amount (USD)</div>
                  <input type="number" min={250} max={1000} step={50} value={icAmount} onChange={(e) => setIcAmount(e.target.value)} className="ui-input w-full px-3 py-2 text-sm" placeholder="500" />
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Min $250 · Max $1,000</div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Note (optional)</div>
                  <input value={icNote} onChange={(e) => setIcNote(e.target.value)} className="ui-input w-full px-3 py-2 text-sm" placeholder="Reason for credit request…" />
                </div>
                <button disabled={icSending} onClick={submitInstantCredit} className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#a855f7" }}>
                  <i className="fa-solid fa-bolt-lightning mr-1" />{icSending ? "Submitting…" : "Request Instant Credit"}
                </button>
              </div>
            )}
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

      {/* Partial Close Modal */}
      {partialClose && (() => {
        const closeL = Number(partialClose.closeLots);
        const remainL = partialClose.closeLots ? parseFloat((partialClose.lots - closeL).toFixed(2)) : 0;
        const pcErr = partialClose.closeLots
          ? closeL <= 0 ? "Enter a valid lot amount"
          : closeL >= partialClose.lots ? `Must be less than ${partialClose.lots}`
          : remainL < 0.01 ? `Remaining (${remainL}) below min 0.01`
          : null : null;
        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setPartialClose(null)}>
            <div className="w-72 rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-[13px] font-bold">Partial Close — {partialClose.sym}</div>
              <div className="mb-3 text-[10px]" style={{ color: "var(--muted)" }}>Position: <strong>{partialClose.lots} lots</strong> · Enter lots to close</div>
              <input type="number" min="0.01" max={partialClose.lots - 0.01} step="0.01" value={partialClose.closeLots} onChange={(e) => setPartialClose((s) => s ? { ...s, closeLots: e.target.value } : s)} placeholder="e.g. 0.50" className="mb-1 h-9 w-full rounded-lg border bg-[var(--bg)] px-3 text-center text-[14px] font-bold tabular-nums outline-none" style={{ color: "var(--text)", borderColor: pcErr ? SELL : "var(--border)" }} autoFocus />
              {partialClose.closeLots && !pcErr && <div className="mb-2 text-center text-[10px]" style={{ color: "var(--muted)" }}>Closing <span style={{ color: SELL }}>{closeL}L</span> · Remaining <span style={{ color: BUY }}>{remainL}L</span></div>}
              {pcErr && <div className="mb-2 text-center text-[10px] font-semibold" style={{ color: SELL }}>{pcErr}</div>}
              <div className="flex gap-2">
                <button onClick={() => setPartialClose(null)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[11px]">Cancel</button>
                <button disabled={!!pcErr || !partialClose.closeLots} onClick={async () => { await close(partialClose.id, closeL); setPartialClose(null); }} className="flex-1 rounded-lg py-2 text-[11px] font-semibold text-white disabled:opacity-40" style={{ background: SELL }}>Close {partialClose.closeLots ? closeL + "L" : "—"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Price Alerts Modal */}
      {alertModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setAlertModal(false)}>
          <div className="w-80 rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-bold">Price Alerts</div>
              <button onClick={() => setAlertModal(false)} className="text-[var(--muted)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="mb-3 max-h-48 overflow-y-auto space-y-1">
              {alerts.length === 0 && <div className="text-[10px]" style={{ color: "var(--muted)" }}>No active alerts</div>}
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-1.5 text-[10px]">
                  <span className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="font-semibold text-[9px]" style={{ color: "var(--muted)" }}>{a.symbol}</span>
                    <span>{a.condition} {a.price}{a.note ? ` — ${a.note}` : ""}</span>
                    {a.triggered && <span className="rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: "#f59e0b22", color: "#f59e0b" }}>TRIGGERED</span>}
                  </span>
                  <span className="flex items-center gap-1 ml-2 shrink-0">
                    {a.triggered && (
                      <button title="Re-arm" onClick={async () => { await fetch("/api/client/alerts?id=" + a.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ triggered: false }) }); loadAlerts(); }} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-rotate-right text-[9px]" /></button>
                    )}
                    <button onClick={async () => { await fetch("/api/client/alerts?id=" + a.id, { method: "DELETE" }); loadAlerts(); }} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-trash-can text-[9px]" /></button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Add Alert — {selSym}</div>
            <div className="flex gap-2 mb-2">
              {["ABOVE", "BELOW"].map((c) => (
                <button key={c} onClick={() => setAlertForm((f) => ({ ...f, condition: c }))} className="flex-1 rounded py-1 text-[10px] font-semibold border" style={{ background: alertForm.condition === c ? "var(--accent)" : "transparent", color: alertForm.condition === c ? "#fff" : "var(--muted)", borderColor: "var(--border)" }}>{c}</button>
              ))}
            </div>
            <input type="number" value={alertForm.price} onChange={(e) => setAlertForm((f) => ({ ...f, price: e.target.value }))} placeholder="Price" className="mb-2 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[11px] text-[var(--text)] outline-none text-center" />
            <input type="text" maxLength={80} value={alertForm.note} onChange={(e) => setAlertForm((f) => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className="mb-3 h-7 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[10px] text-[var(--text)] outline-none" />
            <button onClick={async () => { if (!alertForm.price) return; const r = await fetch("/api/client/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, condition: alertForm.condition, price: Number(alertForm.price), note: alertForm.note || undefined, accountId: accIdRef.current }) }); const d = await r.json(); if (d.ok) { setAlertForm({ condition: "ABOVE", price: "", note: "" }); loadAlerts(); } }} className="w-full rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Set Alert</button>
          </div>
        </div>
      )}
    </div>
  );
}
