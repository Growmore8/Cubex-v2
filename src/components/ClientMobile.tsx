"use client";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import dynamic from "next/dynamic";
import WalletPanel from "@/components/WalletPanel";
import WorldMapBg from "@/components/ui/WorldMapBg";
import { titleCaseName, gnum } from "@/lib/format";
import { SymIcon } from "@/lib/symIcon";
import { iconForNotification } from "@/lib/notif";
import { COUNTRIES } from "@/config/countries";

const TVMobileChart = dynamic(() => import("@/components/TVChart"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-[var(--muted)] text-xs">Loading chart…</div> });
const LWMobileChart = dynamic(() => import("@/components/LWChart"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-[var(--muted)] text-xs">Loading chart…</div> });

const INDS: [string, string][] = [["RSI", "RSI@tv-basicstudies"], ["MACD", "MACD@tv-basicstudies"], ["Stoch", "Stochastic@tv-basicstudies"], ["BBands", "BB@tv-basicstudies"], ["MA", "MASimple@tv-basicstudies"], ["ROC", "ROC@tv-basicstudies"]];

// ADSS palette (matches admin desk + client desktop) — fixed, not tenant colour.
const DARK: any = { "--bg": "#0a0d12", "--panel": "#11151d", "--card": "#141a24", "--border": "#1c2330", "--text": "#e7ecf3", "--muted": "#8a93a6", "--soft": "#151b25", "--accent": "#16c79a" };
const LIGHT: any = { "--bg": "#f3f5f9", "--panel": "#ffffff", "--card": "#ffffff", "--border": "#e6eaf0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f6", "--accent": "#0f9d77" };
// Fixed ADSS accent pair for in-app highlights (NOT the tenant brand colour).
const A1 = "#16c79a", A2 = "#0ea5e9";
const BUY = "#16a34a", SELL = "#dc2626", GOLD = "#e3a855", BLUE = "#2563eb";
// ADSS buy/sell BUTTON colours (blue buy / red sell).
const BUYBTN = "#2f81f7", SELLBTN = "#f6465d";
const LOTS = [0.01, 0.05, 0.1, 0.5, 1];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

// Keep a heavy tab mounted after first open (so re-entry is instant — no remount of
// the chart / quotes list). `display:contents` means the active layout is identical
// to rendering the children directly; hidden = display:none (stays mounted).
function KeepAlive({ active, children }: { active: boolean; children: React.ReactNode }) {
  const seen = useRef(false);
  if (active) seen.current = true;
  if (!seen.current) return null;
  return <div style={{ display: active ? "contents" : "none" }}>{children}</div>;
}
const acctBal = (a: any) => Number(a?.deposit || 0) - Number(a?.withdrawal || 0) + Number(a?.credit || 0) + Number(a?.bonus || 0) + Number(a?.pnl || 0);

const ORDER_KINDS: [string, string, string][] = [
  ["MARKET", "BUY", "Market"],
  ["LIMIT", "BUY", "Buy Limit"], ["LIMIT", "SELL", "Sell Limit"],
  ["STOP", "BUY", "Buy Stop"], ["STOP", "SELL", "Sell Stop"],
];

function LotStepper({ vol, setVol, small }: { vol: number; setVol: (v: number) => void; small?: boolean }) {
  const [inp, setInp] = useState(vol.toFixed(2));
  useEffect(() => { setInp(vol.toFixed(2)); }, [vol]);
  const commit = (raw: string) => { const v = parseFloat(raw); const n = isNaN(v) || v < 0.01 ? 0.01 : +v.toFixed(2); setVol(n); };
  const stepDown = () => { const n = Math.max(0.01, +(parseFloat(inp || "0") - 0.01).toFixed(2)); setVol(n); setInp(n.toFixed(2)); };
  const stepUp = () => { const n = +(parseFloat(inp || "0") + 0.01).toFixed(2); setVol(n); setInp(n.toFixed(2)); };
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5">
        <button onPointerDown={(e) => { e.preventDefault(); stepDown(); }} className="flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--soft)] text-base font-semibold" style={{ width: small ? 30 : 34, height: small ? 30 : 34, touchAction: "manipulation" }}>−</button>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={inp}
          onChange={e => setInp(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
          className="rounded-lg border border-[var(--border)] bg-[var(--soft)] text-center font-semibold tabular-nums text-[var(--text)]"
          style={{ width: small ? 54 : 62, height: small ? 30 : 34, fontSize: small ? 12 : 13 }}
        />
        <button onPointerDown={(e) => { e.preventDefault(); stepUp(); }} className="flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--soft)] text-base font-semibold" style={{ width: small ? 30 : 34, height: small ? 30 : 34, touchAction: "manipulation" }}>+</button>
      </div>
      <span className="mt-0.5 text-[9px] text-[var(--muted)]">Lots</span>
    </div>
  );
}

// Mini line chart (sparkline) — builds from a rolling price history; falls back
// to a gentle directional slope until enough points have streamed in.
function Sparkline({ data, up, w = 50, h = 20 }: { data?: number[]; up: boolean; w?: number; h?: number }) {
  const col = up ? "#2dd4a7" : "#ff5b6b";
  let pairs: [number, number][];
  if (data && data.length >= 2) {
    const min = Math.min(...data), max = Math.max(...data), rng = (max - min) || 1;
    pairs = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - min) / rng) * (h - 4)]);
  } else {
    pairs = up ? [[0, h - 3], [w * 0.35, h * 0.55], [w * 0.62, h * 0.6], [w, 3]] : [[0, 3], [w * 0.4, h * 0.5], [w * 0.66, h * 0.46], [w, h - 3]];
  }
  const pts = pairs.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={col} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ClientMobile({ t }: { t: any }) {
  const [noOpen, setNoOpen] = useState(false);
  const [noForm, setNoForm] = useState<any>({ idx: 0, lots: 0.01, trigger: "", sl: "", tp: "" });
  const [balOpen, setBalOpen] = useState(false);

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpModal, setTotpModal] = useState<"setup" | "disable" | null>(null);
  const [totpQr, setTotpQr] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpErr, setTotpErr] = useState("");
  const [totpMsg, setTotpMsg] = useState("");
  const {
    theme, brand, account, accts, accId, pnlOnly, swapEnabled, readOnly, isTrial, needKyc, positions, pending, history, financials, notis, symbols, prices, dirs,
    selSym, vol, sl, tp, err,
    balance, equity, floating, free, used, level, price, bid, ask, tf, TFS,
    setSelSym, setVol, setSl, setTp, setTf,
    place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr,
    toggleTheme, enablePush, disablePush, addPasskey, openPin, favs, toggleFav, avatarUrl, avatarUploading, uploadAvatar,
    fmt, csz, pnlOf, cSym, fxRate, dg, markAllNotifsRead, logout, pin,
    acctReqModal, setAcctReqModal,
  } = t;
  const _cSym: string = cSym ?? "$";
  const _fxRate: number = fxRate ?? 1;

  const _mobSymSpreads = (): Record<string, { min: number; max: number; type: string }> => (t as any).symbolSpreads || {};
  const _mobGrpSpread = (): number => (t as any).groupSpread || 0;
  const _mobAccMarkup = (): number => (t as any).accountSpreadMarkup || 0;
  const _mobSpreadPips = (sym: string) => {
    const s = _mobSymSpreads()[sym];
    const grpAcc = _mobGrpSpread() + _mobAccMarkup();
    if (!s) return grpAcc;
    if (s.type === "FIXED") return (s.min || 0) + grpAcc;
    // FLOATING: use real spread from exchange tick (raw ask − raw bid)
    const liveSp = t.liveSpreadPips[sym];
    if (liveSp != null && liveSp > 0) return liveSp + grpAcc;
    return grpAcc; // no live data yet — don't use stale smoothed-price vs real-bid
  };

  const [tab, setTab] = useState<"dashboard" | "quotes" | "chart" | "trades" | "account">("dashboard");
  const [tradeView, setTradeView] = useState<"positions" | "history">("positions");
  const [mobNews, setMobNews] = useState<any[]>([]);
  const [mobNewsLoading, setMobNewsLoading] = useState(false);
  const [mobSignals, setMobSignals] = useState<any[]>([]);
  const [mobSignalsLoaded, setMobSignalsLoaded] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
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
  }
  // Sync html/body with app theme so iOS keyboard and viewport edges match
  useEffect(() => {
    const isDark = theme === "dark";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    document.body.style.background = isDark ? "#0a0d12" : "#dfe5ee";
    document.body.style.colorScheme = isDark ? "dark" : "light";
  }, [theme]);

  useEffect(() => {
    if (account && !profilePrompted && (!account.phone || !account.country)) {
      setProfilePrompted(true);
      setProfileForm({ name: account?.ownerName || account?.name || "", phone: account?.phone || "", country: account?.country || "" });
      setProfileErr("");
      setProfileModal(true);
    }
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mInd, setMInd] = useState<string[]>([]);
  const [orderSheet, setOrderSheet] = useState(false);
  const [mobOrderType, setMobOrderType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">("MARKET");
  const [mobPendingPrice, setMobPendingPrice] = useState("");
  const [mobStopLimitEntry, setMobStopLimitEntry] = useState("");
  const [mobTrail, setMobTrail] = useState("");
  const [mobComment, setMobComment] = useState("");
  const [chartVol, setChartVol] = useState(0.01);  // isolated lot for chart tab
  const [noOpenVol, setNoOpenVol] = useState(0.01); // isolated lot for New Order modal
  const [mobTpEnabled, setMobTpEnabled] = useState(false);
  const [mobSlEnabled, setMobSlEnabled] = useState(false);
  const [histTab, setHistTab] = useState<"trades" | "financial">("trades");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState<Record<string, number>>({});
  const swipeStart = useRef<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [qcat, setQcat] = useState<string>("Crypto"); // quotes open on Crypto by default
  const [symPickerOpen, setSymPickerOpen] = useState(false);
  const [symSearch, setSymSearch] = useState("");
  const [walletTab, setWalletTab] = useState<null | "deposit" | "withdraw" | "kyc">(null);
  const [modifyId, setModifyId] = useState<string | null>(null);
  const [mSl, setMSl] = useState("");
  const [mTp, setMTp] = useState("");
  const [mTrail, setMTrail] = useState("");
  const [mobPartial, setMobPartial] = useState<{id: string; lots: number; sym: string} | null>(null);
  const [mobPartialLots, setMobPartialLots] = useState("");
  const [mobAlertOpen, setMobAlertOpen] = useState(false);
  const [mobAlerts, setMobAlerts] = useState<any[]>([]);
  const [mobAlertForm, setMobAlertForm] = useState({ symbol: "", condition: "ABOVE", price: "", note: "" });
  const [mobAlertErr, setMobAlertErr] = useState("");
  const [notisOpen, setNotisOpen] = useState(false);
  const [reqsOpen, setReqsOpen] = useState(false);
  const [cfgSheet, setCfgSheet] = useState(false);
  const [tfPickerOpen, setTfPickerOpen] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [isTV, setIsTV] = useState(false);
  const [fsMode, setFsMode] = useState(false);
  useEffect(() => { setIsTV(window.location.hostname === "trade.growthcapitalltd.com"); }, []);
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    const TF_SEC: Record<string, number> = { "1M": 60, "5M": 300, "15M": 900, "30M": 1800, "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800 };
    const tick = () => {
      const s = TF_SEC[tf] ?? 60;
      const rem = s - (Math.floor(Date.now() / 1000) % s);
      if (s >= 3600) {
        const h = Math.floor(rem / 3600), m = Math.floor((rem % 3600) / 60), sc = rem % 60;
        setCountdown(`${h}:${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")}`);
      } else {
        setCountdown(`${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, "0")}`);
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [tf]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
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
  useEffect(() => { if (tab === "account" && !myReqsLoaded) loadMyReqs(); }, [tab, myReqsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMobAlerts = () => { if (!accId) return; fetch(`/api/client/alerts?accountId=${accId}`).then((r) => r.json()).then((r) => { if (r.ok) setMobAlerts(r.alerts || []); }).catch(() => {}); };
  useEffect(() => { loadMobAlerts(); }, [accId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetch("/api/auth/totp/status").then((r) => r.json()).then((d) => { if (d.ok) setTotpEnabled(d.totpEnabled); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "dashboard" && mobNews.length === 0 && !mobNewsLoading) { setMobNewsLoading(true); fetch("/api/client/news?category=forex").then((r) => r.json()).then((d) => { if (d.ok) setMobNews(d.items || []); }).catch(() => {}).finally(() => setMobNewsLoading(false)); } }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "dashboard" && !mobSignalsLoaded) { fetch("/api/client/signals").then((r) => r.json()).then((d) => { if (d.ok) setMobSignals(d.signals || []); setMobSignalsLoaded(true); }).catch(() => { setMobSignalsLoaded(true); }); } }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openTotpSetup() {
    setTotpErr(""); setTotpMsg(""); setTotpCode(""); setTotpQr(""); setTotpSecret("");
    setTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/setup").then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed to start setup");
      setTotpQr(r.qrDataUrl);
      setTotpSecret(r.secret);
      setTotpModal("setup");
    } catch (e: any) { setTotpErr(e.message || "Failed"); }
    finally { setTotpBusy(false); }
  }

  async function confirmTotpEnable() {
    setTotpErr(""); setTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setTotpEnabled(true); setTotpModal(null); setTotpMsg("Two-factor authentication enabled.");
    } catch (e: any) { setTotpErr(e.message || "Invalid code"); }
    finally { setTotpBusy(false); }
  }

  async function confirmTotpDisable() {
    setTotpErr(""); setTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setTotpEnabled(false); setTotpModal(null); setTotpMsg("Two-factor authentication disabled.");
    } catch (e: any) { setTotpErr(e.message || "Invalid code"); }
    finally { setTotpBusy(false); }
  }

  const reqRow = (req: any) => {
    const isAcc = req.kind === "ACCOUNT";
    const ic = isAcc ? "fa-circle-plus" : req.kind === "DEPOSIT" ? "fa-arrow-down" : "fa-arrow-up";
    const col = isAcc ? BLUE : req.kind === "DEPOSIT" ? BUY : SELL;
    return (
      <div key={req.id} className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: col + "26" }}>
            <i className={"fa-solid text-sm " + ic} style={{ color: col }} />
          </div>
          <div>
            <div className="text-[12px] font-semibold">{isAcc ? <>New {req.type === "DEMO" ? "Demo" : "Live"} Account <span className="font-normal text-[var(--muted)]">{req.currency}</span></> : <>{req.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"} <span className="font-bold">{_cSym}{gnum(req.amount, 2)}</span></>}</div>
            <div className="text-[10px] text-[var(--muted)]">{isAcc ? `1:${req.leverage}` : (req.method || "—")} · {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}</div>
          </div>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: req.status === "APPROVED" ? "rgba(22,163,74,0.15)" : req.status === "REJECTED" ? "rgba(220,38,38,0.15)" : "rgba(227,168,85,0.18)", color: req.status === "APPROVED" ? BUY : req.status === "REJECTED" ? SELL : GOLD }}>{req.status}</span>
      </div>
    );
  };
  useEffect(() => { try { setBioOn(localStorage.getItem("cubex-bio") === "1"); } catch {} }, []);
  // Await the enable/disable, THEN read the real subscription state (the old inline
  // handler raced the check before subscribe() finished, so the toggle never flipped).
  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushEnabled) await disablePush?.();
      else await enablePush?.();
    } catch {}
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setPushEnabled(!!sub);
    } catch { setPushEnabled(false); }
    setPushBusy(false);
  }
  async function toggleBio() {
    if (bioOn) { try { localStorage.removeItem("cubex-bio"); } catch {} setBioOn(false); return; }
    try { await addPasskey?.(); localStorage.setItem("cubex-bio", "1"); setBioOn(true); } catch { /* user cancelled */ }
  }
  // Statement export/email range picker
  const [stmtOpen, setStmtOpen] = useState(false);
  const [stmtPreset, setStmtPreset] = useState("month");
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");
  const [stmtSending, setStmtSending] = useState(false);
  function stmtRange(): { from?: string; to?: string } {
    const now = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (stmtPreset === "all") return {};
    if (stmtPreset === "custom") return { from: stmtFrom || undefined, to: stmtTo || undefined };
    const f = new Date(now);
    if (stmtPreset === "week") f.setDate(now.getDate() - 7);
    else if (stmtPreset === "month") f.setMonth(now.getMonth() - 1);
    else if (stmtPreset === "year") f.setFullYear(now.getFullYear() - 1);
    return { from: iso(f), to: iso(now) };
  }
  function stmtDownload() {
    const q = new URLSearchParams({ accountId: accId || "" });
    const { from, to } = stmtRange(); if (from) q.set("from", from); if (to) q.set("to", to);
    try { window.open("/api/client/statement?" + q.toString(), "_blank"); } catch { window.print(); }
    setStmtOpen(false);
  }
  async function stmtEmail() {
    setStmtSending(true);
    const { from, to } = stmtRange();
    pushToast?.({ id: "stmt-" + Date.now(), title: "Sending statement…", st: "funds" });
    const r = await fetch("/api/client/statement/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: accId, from, to }) }).then((x: any) => x.json()).catch(() => ({ ok: false }));
    setStmtSending(false); setStmtOpen(false);
    pushToast?.({ id: "stmt-" + Date.now(), title: r.ok ? "Statement emailed to " + r.to : (r.error || "Failed to send"), st: "funds" });
  }
  const { cToasts = [], pushToast, dismissToasts } = t;
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription().then((sub) => setPushEnabled(!!sub))).catch(() => {});
  }, []);
  const avatarRef = useRef<HTMLInputElement>(null);
  const baselineRef = useRef<Record<string, number>>({});
  const haptic = (pattern: number | number[] = 40) => { try { navigator.vibrate(pattern); } catch {} };

  // capture a session baseline price for % change movers
  useEffect(() => {
    const b = baselineRef.current;
    Object.keys(prices || {}).forEach((s) => { if (b[s] == null && prices[s] != null) b[s] = prices[s]; });
  }, [prices]);

  const unread = (notis || []).filter((n: any) => !n.read).length;
  const initial = (account?.ownerName || account?.name || "U").charAt(0).toUpperCase();

  // categories — ordered Crypto, Forex, Indices, then the rest
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const cats = useMemo(() => {
    const cs: string[] = [];
    (symbols || []).forEach((s: any) => { const c = cap(s.category || "Other"); if (!cs.includes(c)) cs.push(c); });
    cs.sort((a, b) => { const ia = CAT_ORDER.indexOf(a.toLowerCase()); const ib = CAT_ORDER.indexOf(b.toLowerCase()); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
    return cs;
  }, [symbols]);

  const quoteList = useMemo(() => (symbols || []).filter((s: any) => {
    if (search) {
      const q = search.toLowerCase().replace(/\//g, "");
      const sym = s.symbol.toLowerCase();
      const disp = (s.display || "").toLowerCase().replace(/\//g, "");
      if (!sym.includes(q) && !disp.includes(q)) return false;
    }
    if (qcat === "favs") return (favs || []).includes(s.symbol);
    return cap(s.category || "Other") === qcat;
  }), [symbols, search, qcat, favs]);

  const pctOf = (sym: string) => {
    const b = baselineRef.current[sym]; const p = prices[sym];
    if (b == null || p == null || !b) return 0;
    return ((p - b) / b) * 100;
  };

  // movers — snapshotted every 3s (not every ~80ms tick) so the list & numbers
  // stay calm instead of flickering. Ranked by cumulative % change.
  const pricesRef = useRef(prices); pricesRef.current = prices;
  const sparkRef = useRef<Record<string, number[]>>({}); // rolling price history for sparklines
  const [movers, setMovers] = useState<{ gainers: any[]; losers: any[]; any: boolean }>({ gainers: [], losers: [], any: false });
  useEffect(() => {
    const compute = () => {
      const pr = pricesRef.current; const b = baselineRef.current;
      // append one history point per symbol (cap 24) — ~every 3s
      for (const s of (symbols || [])) { const p = pr[s.symbol]; if (p == null) continue; const h = sparkRef.current[s.symbol] || (sparkRef.current[s.symbol] = []); h.push(p); if (h.length > 24) h.shift(); }
      const list = (symbols || []).filter((s: any) => pr[s.symbol] != null).map((s: any) => {
        const base = b[s.symbol]; const p = pr[s.symbol];
        return { symbol: s.symbol, display: s.display, price: p, pct: (base && p) ? ((p - base) / base) * 100 : 0 };
      });
      list.sort((a: any, b2: any) => b2.pct - a.pct);
      setMovers({ gainers: list.filter((x: any) => x.pct > 0).slice(0, 3), losers: list.filter((x: any) => x.pct < 0).slice(-3).reverse(), any: list.length > 0 });
    };
    compute();
    const t = setInterval(compute, 3000);
    return () => clearInterval(t);
  }, [symbols]);

  const Avatar = ({ size }: { size: number }) => (
    <div className="overflow-hidden rounded-full" style={{ width: size, height: size, background: avatarUrl ? undefined : "linear-gradient(135deg,#2563eb,#16a34a)" }}>
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> :
        <span className="flex h-full w-full items-center justify-center font-bold text-white" style={{ fontSize: size * 0.42 }}>{initial}</span>}
    </div>
  );

  // Until the live account is KYC-verified, the client is restricted to the profile
  // area only (demo accounts are exempt — switching to one lifts the restriction).
  const navItems: [string, string, string][] = needKyc
    ? [["account", "fa-user", "Account"]]
    : [
        ["dashboard", "fa-house", "Home"], ["quotes", "fa-chart-simple", "Quotes"], ["chart", "fa-chart-line", "Chart"],
        ["trades", "fa-right-left", "Trade"], ["account", "fa-user", "Account"],
      ];
  useEffect(() => { if (needKyc) setTab("account"); }, [needKyc]);
  // If a tenant has no Crypto category, fall back to the first available tab.
  const catsKey = cats.join(",");
  const didCatInit = useRef(false);
  useEffect(() => {
    if (didCatInit.current || !cats.length) return;
    didCatInit.current = true;
    if (qcat !== "favs" && !cats.includes(qcat)) setQcat(cats[0]);
  }, [catsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtLogin = (l: any) => String(l || "").split("").join(" ");

  const liveAccts = (accts || []).filter((a: any) => a.type === "LIVE");
  const demoAccts = (accts || []).filter((a: any) => a.type === "DEMO");
  const totalBal = (accts || []).reduce((s: number, a: any) => s + acctBal(a), 0);

  const buyPos = (positions || []).filter((p: any) => p.type === "BUY");
  const sellPos = (positions || []).filter((p: any) => p.type === "SELL");
  const sumLots = (arr: any[]) => arr.reduce((s, p) => s + Number(p.lots || 0), 0);
  const sumPL = (arr: any[]) => arr.reduce((s, p) => s + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);

  // group by symbol
  const bySym: Record<string, any[]> = {};
  (positions || []).forEach((p: any) => { (bySym[p.symbol] || (bySym[p.symbol] = [])).push(p); });

  const saveModify = async (id: string) => {
    try {
      const body: any = { sl: mSl, tp: mTp };
      if (mTrail !== "") {
        const pips = Number(mTrail) || 0;
        if (pips > 0) {
          const pos = (positions || []).find((p: any) => p.id === id);
          const pip = Math.pow(10, -(dg(pos?.symbol ?? "") - 1));
          body.trailingStop = pips * pip;
        } else {
          body.trailingStop = 0;
        }
      }
      await fetch("/api/client/orders/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { }
    setModifyId(null); setExpanded(null);
  };

  // Account-card palette — FIXED premium dark gradients from the reference cards
  // (NOT the tenant theme). The card stays dark in light mode too. LIVE = deep
  // blue, DEMO = purple/magenta. Front + back share the gradient.
  const cIsLive = account?.type === "LIVE";
  const cardDark = theme === "dark"; // (kept for button styling elsewhere)
  const cardC1 = cIsLive ? "#2547d6" : "#7c2d92";
  const cardC2 = cIsLive ? "#4f74ff" : "#a83bbf";
  const cardGlow = cIsLive ? "rgba(79,116,255,.55)" : "rgba(168,59,191,.55)";
  // Reference-style dark gradient (constant across light/dark): rich colour top-left,
  // deepening to near-black bottom-right. World-map shade + chip sit on top.
  const cardFrontBg = `linear-gradient(145deg, ${cardC1} 0%, ${cardC2} 42%, #1a1430 78%, #0b0a16 100%)`;

  return (
    <>
    {/* Dark backdrop behind the phone-width app column (fills desktop sides). */}
    <div style={{ position: "fixed", inset: 0, zIndex: 0, background: theme === "dark" ? "#06080f" : "#dfe5ee" }} />
    <div style={{ ...(theme === "dark" ? DARK : LIGHT), colorScheme: theme === "dark" ? "dark" : "light", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", position: "fixed", top: 0, bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 540, zIndex: 1, paddingTop: "env(safe-area-inset-top)", touchAction: tab === "chart" ? "none" : "manipulation", boxShadow: "0 0 60px rgba(0,0,0,0.45)",
      background: "radial-gradient(680px 420px at 50% -6%, rgba(22,199,154,0.08), transparent 60%), var(--bg)" }} className="flex flex-col overflow-hidden text-[var(--text)]">
      <input type="file" accept="image/*" style={{ display: "none" }} ref={avatarRef} onChange={uploadAvatar} />

      {/* TOP HEADER — premium glass */}
      {(() => {
        const hPrimary = A1;
        const hAccent = A2;
        const live = account?.type === "LIVE";
        return (
        <div className="sticky top-0 z-20 flex items-center justify-between px-3.5 py-2.5" style={{ background: "transparent" }}>
          <div className="flex items-center gap-2.5">
            {/* avatar with brand gradient ring + presence dot */}
            <span className="relative inline-flex shrink-0">
              <span className="rounded-full p-[2px]" style={{ background: `linear-gradient(135deg, ${hPrimary}, ${hAccent})`, boxShadow: `0 4px 12px -4px ${hPrimary}66` }}>
                <span className="block rounded-full p-[1.5px]" style={{ background: "var(--bg)" }}><Avatar size={34} /></span>
              </span>
            </span>
            <div className="leading-tight">
              <div className="text-[10px] font-medium text-[var(--muted)]">Welcome back</div>
              <div className="text-[14px] font-extrabold tracking-tight">{titleCaseName(account?.ownerName || account?.name) || "Trader"}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-semibold" style={{ color: "var(--muted)" }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: live ? "#22c55e" : GOLD }} />
                <span className="uppercase tracking-wide" style={{ color: live ? "#22c55e" : GOLD }}>{live ? "Live" : "Demo"}</span>
                <span className="text-[var(--muted)]">#{account?.login} · 1:{account?.leverage}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Theme toggle */}
            <button onClick={() => { haptic(30); toggleTheme && toggleTheme(); }} className="flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-90" style={{ background: "var(--soft)", border: "1px solid var(--border)" }} title={theme === "dark" ? "Light mode" : "Dark mode"}>
              <i className={"fa-solid text-[12px] " + (theme === "dark" ? "fa-sun" : "fa-moon")} style={{ color: "var(--muted)" }} />
            </button>
            {/* Price alerts button */}
            <button onClick={() => { haptic(30); loadMobAlerts(); setMobAlertOpen(true); }} className="relative flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-90" style={{ background: "var(--soft)", border: "1px solid var(--border)" }} title="Price Alerts">
              <i className="fa-solid fa-bullseye text-[13px]" style={{ color: mobAlerts.length > 0 ? GOLD : "var(--muted)" }} />
              {mobAlerts.filter((a) => a.triggered).length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white" style={{ background: SELL, border: "1.5px solid var(--bg)" }}>{mobAlerts.filter((a) => a.triggered).length}</span>}
            </button>
            <button onClick={() => { setNotisOpen((o) => !o); if (!notisOpen && unread > 0) fetch("/api/client/notifications", { method: "POST" }).then(() => {}).catch(() => {}); }} className="relative flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-90" style={{ background: "var(--soft)", border: "1px solid var(--border)" }}>
              <i className="fa-solid fa-bell text-[13px]" style={{ color: unread > 0 ? GOLD : "var(--muted)" }} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white" style={{ background: SELL, border: "1.5px solid var(--bg)", boxShadow: `0 0 8px ${SELL}99` }}>{unread > 9 ? "9+" : unread}</span>}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Read-only banner */}
      {t.readOnly && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(220,38,38,0.16)", color: SELL }}>
          <i className="fa-solid fa-lock" /> READ ONLY ACCESS — all actions disabled
        </div>
      )}

      {/* Notification panel — full-screen overlay */}
      {notisOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease" }} onClick={() => setNotisOpen(false)} />
          {/* Bottom sheet */}
          <div className="fixed inset-x-0 bottom-0 z-[80] flex flex-col rounded-t-3xl shadow-2xl" style={{ background: "var(--panel)", maxHeight: "78vh", animation: "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: GOLD + "20" }}>
                  <i className="fa-solid fa-bell text-sm" style={{ color: GOLD }} />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-[var(--text)]">Notifications</div>
                  {unread > 0 && <div className="text-[10px]" style={{ color: GOLD }}>{unread} unread</div>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(notis || []).length > 0 && (
                  <button onClick={() => markAllNotifsRead && markAllNotifsRead()} className="rounded-full px-3 py-1 text-[11px] font-medium transition-opacity active:opacity-60" style={{ background: GOLD + "20", color: GOLD }}>
                    Mark all read
                  </button>
                )}
                <button onClick={() => setNotisOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-base transition-opacity active:opacity-60" style={{ background: "var(--soft)", color: "var(--muted)" }}>
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            {/* Divider */}
            <div className="mx-5 mb-2 h-px" style={{ background: "var(--border)" }} />
            {/* Notification list */}
            <div className="overflow-auto pb-4">
              {(notis || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--soft)" }}>
                    <i className="fa-solid fa-bell-slash text-2xl" style={{ color: "var(--muted)" }} />
                  </div>
                  <div className="text-[14px] font-semibold text-[var(--text)]">All caught up</div>
                  <div className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>No notifications yet</div>
                </div>
              ) : (notis || []).map((n: any, i: number) => {
                const ic = iconForNotification(n);
                const iconName = ic.icon, iconColor = ic.color;
                return (
                  <div key={i} className="mx-3 mb-2 overflow-hidden rounded-2xl" style={{ background: !n.read ? "color-mix(in srgb, var(--soft) 80%, transparent)" : "var(--soft)" }}>
                    <div className="flex gap-3 px-4 py-3.5">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: iconColor + "18" }}>
                        <i className={"fa-solid " + iconName + " text-sm"} style={{ color: iconColor }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[13px] font-semibold leading-tight text-[var(--text)]">{n.title}</div>
                          {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: GOLD }} />}
                        </div>
                        {n.body && <div className="mt-0.5 whitespace-pre-line text-[12px] leading-snug" style={{ color: "var(--muted)" }}>{n.body}</div>}
                        <div className="mt-1.5 text-[10px]" style={{ color: "var(--muted)" }}>{new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* MY REQUESTS — full list bottom sheet (View all) */}
      {reqsOpen && (
        <>
          <div className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease" }} onClick={() => setReqsOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[80] flex flex-col rounded-t-3xl shadow-2xl" style={{ background: "var(--panel)", maxHeight: "82vh", animation: "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} /></div>
            <div className="flex items-center justify-between px-5 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: GOLD + "20" }}><i className="fa-solid fa-clock-rotate-left text-sm" style={{ color: GOLD }} /></div>
                <div><div className="text-[15px] font-bold text-[var(--text)]">My Requests</div><div className="text-[10px]" style={{ color: "var(--muted)" }}>{myReqs.length} total</div></div>
              </div>
              <button onClick={() => setReqsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-base transition-opacity active:opacity-60" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="mx-5 mb-2 h-px" style={{ background: "var(--border)" }} />
            <div className="space-y-2 overflow-auto px-3 pb-4">{myReqs.map(reqRow)}</div>
          </div>
        </>
      )}

      {/* Toast overlay — bottom of screen, auto-dismiss */}
      {cToasts.length > 0 && (
        <div className="absolute inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4" onClick={() => dismissToasts?.()}>
          {cToasts.map((toast: any) => (
            <div key={toast.id} className="flex w-full max-w-sm cursor-pointer items-center gap-2.5 rounded-xl px-4 py-3 shadow-2xl" style={{ background: "var(--panel)", border: `1px solid var(--border)`, borderLeft: `4px solid ${toast.st === "trade" ? "#2f81f7" : toast.st === "funds" ? GOLD : toast.st === "login" ? "#a78bfa" : BUY}` }}>
              <i className={"fa-solid text-sm " + (toast.st === "trade" ? "fa-chart-line" : toast.st === "funds" ? "fa-money-bill" : "fa-bell")} style={{ color: toast.st === "trade" ? "#2f81f7" : toast.st === "funds" ? GOLD : BUY }} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-[var(--text)]">{toast.title}</div>
                {toast.body && <div className="text-[10px] text-[var(--muted)]">{toast.body}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CONTENT */}
      {/* overflow-hidden when chart is active — overflow-auto creates a scroll
          context on iOS/Android that intercepts touch before klinecharts sees it */}
      <div className="min-h-0 flex-1" style={{ overflowY: tab === "chart" ? "hidden" : "auto", touchAction: tab === "chart" ? "none" : "auto" }}>

        {/* ───────── DASHBOARD ───────── */}
        <KeepAlive active={tab === "dashboard"}>{(
          <div className="space-y-4 p-3">
            {/* premium world-map account card — swipe left/right to switch accounts */}
            <div style={{ touchAction: "pan-y" }}
              onTouchStart={(e) => { (e.currentTarget as any)._sx = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const sx = (e.currentTarget as any)._sx;
                if (sx == null) return;
                const dx = e.changedTouches[0].clientX - sx;
                if (Math.abs(dx) < 40) return; // ignore taps
                const ids = (accts || []).map((a: any) => a.id);
                const cur = ids.indexOf(accId);
                if (dx < 0 && cur < ids.length - 1) switchAcc(ids[cur + 1]);
                else if (dx > 0 && cur > 0) switchAcc(ids[cur - 1]);
              }}>
              <div className="relative overflow-hidden rounded-[20px] p-5 text-white" style={{
                background: cardFrontBg,
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 26px 50px -22px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}>
                <WorldMapBg opacity={0.16} />
                <div className="card-sheen pointer-events-none absolute inset-0" />
                <div className="pointer-events-none absolute -right-16 -top-24 h-60 w-60 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%)" }} />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${cardC1}, ${cardC2}, ${cardC1})`, boxShadow: `0 0 16px 1px ${cardGlow}` }} />
                <div className="relative flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-bold tracking-[0.2em] text-white/90">{(brand?.name || "").toUpperCase() || "TRADING"}</div>
                    <span className="rounded-full px-2 py-0.5 text-[8px] font-bold" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>{account?.type}</span>
                  </div>
                  <div className="h-7 w-9 rounded-[6px]" style={{ background: "linear-gradient(135deg,#f4e3a1,#caa54e 45%,#9c7c2e 70%,#e9d27f)", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(0,0,0,0.35)" }} />
                </div>
                <div className="relative mt-5">
                  <div className="text-[9px] font-semibold tracking-[0.18em] text-white/55">TOTAL BALANCE</div>
                  <div className="mt-1 text-[32px] font-extrabold leading-none tracking-tight text-white" style={{ textShadow: "0 2px 14px rgba(0,0,0,0.5)" }}>{_cSym}{fmt(balance)}</div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-white/75">
                    <span className="font-mono tracking-[0.2em]">{account?.login}</span>
                    <span className="text-white/40">·</span>
                    <span className="uppercase tracking-wide">{titleCaseName(account?.ownerName || account?.name)}</span>
                  </div>
                </div>
                <div className="relative my-3 h-px" style={{ background: "rgba(255,255,255,0.18)" }} />
                <div className="relative grid grid-cols-2 gap-2 text-white">
                  <div><div className="text-[8px] tracking-[0.12em] text-white/50">EQUITY</div><div className="text-[13px] font-bold tabular-nums">{_cSym}{fmt(equity)}</div></div>
                  <div><div className="text-[8px] tracking-[0.12em] text-white/50">FREE MARGIN</div><div className="text-[13px] font-bold tabular-nums">{_cSym}{fmt(free)}</div></div>
                </div>
              </div>
            </div>
            {/* dots */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1.5">
                {(accts || []).map((a: any) => (
                  <button key={a.id} onClick={() => switchAcc(a.id)} className="h-2 rounded-full transition-all" style={{ width: a.id === accId ? 18 : 8, background: a.id === accId ? BLUE : "var(--border)" }} />
                ))}
              </div>
              <div className="text-[9px] text-[var(--muted)]">← swipe to switch account →</div>
            </div>

            {/* action buttons — LIVE: deposit/withdraw/transfer · DEMO: top-up only */}
            {account?.type === "LIVE" ? (
              <div className="grid grid-cols-3 gap-2">
                {([
                  { label: "Deposit", icon: "fa-circle-dollar-to-slot", col: BUY, on: () => setWalletTab("deposit") },
                  { label: "Withdraw", icon: "fa-hand-holding-dollar", col: SELL, on: () => setWalletTab("withdraw") },
                  { label: "Transfer", icon: "fa-money-bill-transfer", col: BLUE, on: () => { setXfer({ ...(xfer || {}), fromId: accId }); setXferModal(true); } },
                ]).map((b) => (
                  <button key={b.label} onClick={b.on} className="gbtn flex flex-col items-center gap-2 rounded-2xl py-3.5 font-semibold" style={{ color: "var(--text)", background: cardDark ? "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))" : "linear-gradient(160deg, var(--card), var(--soft))", border: "1px solid var(--border)", boxShadow: cardDark ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "0 1px 2px rgba(0,0,0,0.05)" }}>
                    {/* metallic chrome icon chip (reference look) */}
                    <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "linear-gradient(145deg,#f7f9fc,#cfd6e2 42%,#9aa3b4 72%,#eef1f6)", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -2px 3px rgba(0,0,0,0.25), 0 2px 5px rgba(0,0,0,0.28)" }}>
                      <i className={"fa-solid " + b.icon} style={{ color: b.col, fontSize: 15, filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.6))" }} />
                    </span>
                    <span className="text-[11px]">{b.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">Top up your demo balance</div>
                <div className="grid grid-cols-3 gap-2">
                  {[1000, 5000, 10000].map((amt) => (
                    <button key={amt} onClick={() => doTopUp(amt)} className="gbtn flex flex-col items-center gap-2 rounded-2xl py-3.5 font-semibold" style={{ color: "var(--text)", background: cardDark ? "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))" : "linear-gradient(160deg, var(--card), var(--soft))", border: "1px solid var(--border)" }}>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "linear-gradient(145deg,#fde7b8,#e0b94e 45%,#b8860b 72%,#fbe9b0)", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -2px 3px rgba(0,0,0,0.25), 0 2px 5px rgba(0,0,0,0.28)" }}><i className="fa-solid fa-coins" style={{ color: "#7a5b07", fontSize: 15 }} /></span>
                      <span className="text-[12px]">{_cSym}{amt.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Statement download */}
            {accId && (
              <div className="flex items-center justify-end gap-2">
                <a href={"/api/client/statement?accountId=" + accId} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444433" }}>
                  <i className="fa-solid fa-file-pdf text-[10px]" /> Download Statement
                </a>
              </div>
            )}

            {/* Equity curve — cumulative trade P/L */}
            {(() => {
              const tradePL = (history || []).filter((h: any) => h.kind === "TRADE" || !h.kind);
              if (tradePL.length < 2) return null;
              const sorted = [...tradePL].sort((a: any, b: any) => {
                const da = new Date(a.closeTime || a.closedAt || a.closeDate || a.createdAt || 0).getTime();
                const db = new Date(b.closeTime || b.closedAt || b.closeDate || b.createdAt || 0).getTime();
                return da - db;
              });
              let running = 0;
              const pts: { v: number }[] = [{ v: 0 }];
              sorted.forEach((h: any) => { running += Number(h.pnl || 0); pts.push({ v: running }); });
              const vals = pts.map((p) => p.v);
              const minV = Math.min(...vals, 0), maxV = Math.max(...vals, 0);
              const range = maxV - minV || 1;
              const W = 320, H = 64;
              const px = (i: number) => ((i / (pts.length - 1)) * W).toFixed(1);
              const py = (v: number) => (H - ((v - minV) / range) * H).toFixed(1);
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(p.v)}`).join(" ");
              const fillPath = linePath + ` L${px(pts.length - 1)},${H} L0,${H}Z`;
              const lastV = running;
              const col = lastV >= 0 ? BUY : SELL;
              const first = sorted[0]; const last = sorted[sorted.length - 1];
              const fmtDate = (h: any) => { const d = h.closeTime || h.closedAt || h.closeDate || h.createdAt; return d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
              return (
                <div className="glass-card p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-bold tracking-wide"><i className="fa-solid fa-chart-area mr-1.5" style={{ color: col }} />EQUITY CURVE</div>
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: col }}>{lastV >= 0 ? "+" : ""}{fmt(lastV)}</span>
                  </div>
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 56, display: "block" }}>
                    <line x1="0" y1={py(0)} x2={W} y2={py(0)} stroke="var(--border)" strokeWidth="0.8" strokeDasharray="4,4" />
                    <path d={linePath} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={px(pts.length - 1)} cy={py(lastV)} r="3" fill={col} />
                  </svg>
                  <div className="mt-1.5 flex items-center justify-between text-[9px]" style={{ color: "var(--muted)" }}>
                    <span>{fmtDate(first)}</span>
                    <span>{sorted.length} trades</span>
                    <span>{fmtDate(last)}</span>
                  </div>
                </div>
              );
            })()}

            {/* market movers */}
            <div className="glass-card overflow-hidden p-0">
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <div className="text-[11px] font-bold tracking-wide"><i className="fa-solid fa-arrow-trend-up mr-1.5" style={{ color: BUY }} />MARKET MOVERS</div>
                <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: "rgba(38,166,154,0.12)", color: BUY }}>LIVE</span>
              </div>
              {!movers.any ? <div className="px-3 pb-4 text-center text-[11px] text-[var(--muted)]">Waiting for live prices…</div> : (
                <div>
                  {/* Gainers */}
                  <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <i className="fa-solid fa-arrow-up text-[8px]" style={{ color: BUY }} />
                      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: BUY }}>Top Gainers</span>
                    </div>
                    {movers.gainers.length === 0
                      ? <div className="py-2 text-center text-[10px] text-[var(--muted)]">No gainers yet</div>
                      : movers.gainers.map((s: any) => {
                        const p = s.pct;
                        return (
                          <button key={"g" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 mb-1 transition-colors active:bg-[var(--soft)]">
                            <SymIcon symbol={s.symbol} size={28} />
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-[12px] font-bold">{s.display || s.symbol}</div>
                              <div className="text-[10px] tabular-nums" style={{ color: "var(--muted)" }}>{s.price != null ? gnum(s.price, dg(s.symbol)) : "…"}</div>
                            </div>
                            <div className="flex flex-1 justify-center"><Sparkline data={sparkRef.current[s.symbol]} up={true} /></div>
                            <span className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold tabular-nums" style={{ color: BUY }}>+{p.toFixed(2)}%</span>
                          </button>
                        );
                      })}
                  </div>
                  {/* Losers */}
                  <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <i className="fa-solid fa-arrow-down text-[8px]" style={{ color: SELL }} />
                      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: SELL }}>Top Losers</span>
                    </div>
                    {movers.losers.length === 0
                      ? <div className="py-2 text-center text-[10px] text-[var(--muted)]">No losers yet</div>
                      : movers.losers.map((s: any) => {
                        const p = s.pct;
                        return (
                          <button key={"l" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 mb-1 transition-colors active:bg-[var(--soft)]">
                            <SymIcon symbol={s.symbol} size={28} />
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-[12px] font-bold">{s.display || s.symbol}</div>
                              <div className="text-[10px] tabular-nums" style={{ color: "var(--muted)" }}>{s.price != null ? gnum(s.price, dg(s.symbol)) : "…"}</div>
                            </div>
                            <div className="flex flex-1 justify-center"><Sparkline data={sparkRef.current[s.symbol]} up={false} /></div>
                            <span className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold tabular-nums" style={{ color: SELL }}>{p.toFixed(2)}%</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* signals above news */}
            {mobSignalsLoaded && mobSignals.length > 0 && (
              <div className="glass-card p-3">
                <div className="mb-2 text-[11px] font-bold tracking-wide"><i className="fa-solid fa-signal mr-1.5" style={{ color: "#2f81f7" }} />ANALYST SIGNALS <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "#2f81f722", color: "#2f81f7" }}>{mobSignals.length}</span></div>
                <div className="space-y-2">
                  {mobSignals.slice(0, 3).map((sig: any) => {
                    const isBuy = sig.direction === "BUY";
                    const dc = isBuy ? "#26a69a" : "#ef5350";
                    return (
                      <div key={sig.id} className="rounded-xl border p-2.5" style={{ borderColor: dc + "44", background: dc + "08" }}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: dc }}>{sig.direction}</span>
                            <span className="text-[13px] font-bold text-[var(--text)]">{sig.symbol}</span>
                          </div>
                          <span className="text-[10px] tabular-nums font-semibold" style={{ color: dc }}>@ {Number(sig.entryPrice).toFixed(5)}</span>
                        </div>
                        <div className="flex gap-2 mb-2 text-[10px]" style={{ color: "var(--muted)" }}>
                          {Number(sig.sl) > 0 && <span>SL <span className="font-semibold" style={{ color: "#ef5350" }}>{Number(sig.sl).toFixed(5)}</span></span>}
                          {Number(sig.tp) > 0 && <span>TP <span className="font-semibold" style={{ color: "#26a69a" }}>{Number(sig.tp).toFixed(5)}</span></span>}
                        </div>
                        {sig.rationale && <div className="mb-2 text-[10px] italic leading-snug" style={{ color: "var(--muted)" }}>{sig.rationale}</div>}
                        <button
                          onClick={() => { setSelSym(sig.symbol); setTab("chart"); }}
                          className="w-full rounded-lg py-1.5 text-[11px] font-semibold text-white"
                          style={{ background: dc }}
                        >
                          <i className={`fa-solid fa-arrow-trend-${isBuy ? "up" : "down"} mr-1`} />Trade This Signal
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* news below market movers */}
            <div className="glass-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide"><i className="fa-solid fa-newspaper mr-1.5" style={{ color: "var(--accent)" }} />LATEST NEWS</div>
                {mobNewsLoading && <i className="fa-solid fa-circle-notch fa-spin text-[10px] text-[var(--muted)]" />}
              </div>
              {!mobNewsLoading && mobNews.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-[var(--muted)]">No news available</div>
              ) : (
                <div className="space-y-3">
                  {mobNews.slice(0, 5).map((n: any) => (
                    <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block rounded-xl active:opacity-70">
                      <div className="text-[12px] font-semibold leading-snug text-[var(--text)] line-clamp-2">{n.headline}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                        <span>{n.source}</span><span>·</span>
                        <span>{n.datetime ? (() => { const ms = Date.now() - n.datetime * 1000; const m = Math.floor(ms / 60000); if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return new Date(n.datetime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }); })() : ""}</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}</KeepAlive>

        {/* ───────── QUOTES ───────── */}
        <KeepAlive active={tab === "quotes"}>{(
          <div className="p-3">
            <div className="relative mb-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbols" className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm text-[var(--text)]" />
            </div>
            <div className="mb-3 flex gap-4 overflow-x-auto pb-1 text-[12px]" style={{ scrollbarWidth: "none" }}>
              <button onPointerDown={() => startTransition(() => setQcat("favs"))} className="whitespace-nowrap pb-1 font-semibold" style={{ color: qcat === "favs" ? BLUE : "var(--muted)", borderBottom: qcat === "favs" ? `2px solid ${BLUE}` : "2px solid transparent", touchAction: "manipulation" }}><i className="fa-solid fa-star mr-1" />Favourites</button>
              {cats.map((c) => (
                <button key={c} onPointerDown={() => startTransition(() => setQcat(c))} className="whitespace-nowrap pb-1 font-semibold" style={{ color: qcat === c ? BLUE : "var(--muted)", borderBottom: qcat === c ? `2px solid ${BLUE}` : "2px solid transparent", touchAction: "manipulation" }}>{c}</button>
              ))}
            </div>
            <div className="space-y-2.5">
              {quoteList.length === 0 ? <div className="py-6 text-center text-[12px] text-[var(--muted)]">No symbols.</div> : quoteList.map((s: any) => {
                const dd = dg(s.symbol); const p = prices[s.symbol]; const isFav = (favs || []).includes(s.symbol);
                const spPips = _mobSpreadPips(s.symbol);
                const spPx = spPips * Math.pow(10, -(dd - 1));
                const sAsk = p; const sBid = p != null ? p - spPx : null;
                const spread = spPips;
                const dr = dirs?.[s.symbol] || 0;
                const hist = sparkRef.current[s.symbol];
                const upTrend = hist && hist.length >= 2 ? hist[hist.length - 1] >= hist[0] : dr >= 0;
                return (
                  <div key={s.symbol} className="rounded-xl border bg-[var(--card)] p-3" style={{ borderColor: dr > 0 ? BUY : dr < 0 ? SELL : "var(--border)", transition: "border-color 0.4s ease" }}>
                    {/* Double-tap the info row to open this symbol's chart */}
                    {(() => { const pct = pctOf(s.symbol); return (
                    <div className="mb-2 flex select-none items-center justify-between" onDoubleClick={() => { setSelSym(s.symbol); setTab("chart"); }}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleFav(s.symbol)} style={{ color: isFav ? GOLD : "var(--muted)" }}><i className={isFav ? "fa-solid fa-star" : "fa-regular fa-star"} /></button>
                        <SymIcon symbol={s.symbol} size={20} />
                        <div>
                          <button onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="text-sm font-bold underline-offset-2 active:underline">{s.display || s.symbol}</button>
                          <div className="text-[9px] font-semibold" style={{ color: pct > 0 ? BUY : pct < 0 ? SELL : "var(--muted)" }}>{pct !== 0 ? (pct >= 0 ? "▲" : "▼") + " " + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%" : "—"}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Sparkline data={hist} up={upTrend} />
                        <span className="text-[9px] text-[var(--muted)]">Sprd: {Math.round(spread)}</span>
                      </div>
                    </div>
                    ); })()}
                    <div className="grid grid-cols-3 items-center gap-2">
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "SELL"); }} className="rounded-lg py-2 text-center text-white" style={{ background: SELLBTN }}>
                        <div className="text-[10px] opacity-80">SELL</div><div className="text-sm font-bold tabular-nums">{sBid != null ? gnum(sBid, dd) : "…"}</div>
                      </button>
                      <LotStepper vol={vol} setVol={setVol} small />
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "BUY"); }} className="rounded-lg py-2 text-center text-white" style={{ background: BUYBTN }}>
                        <div className="text-[10px] opacity-80">BUY</div><div className="text-sm font-bold tabular-nums">{sAsk != null ? gnum(sAsk, dd) : "…"}</div>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}</KeepAlive>

        {/* ───────── CHART ───────── */}
        <KeepAlive active={tab === "chart"}>{(
          <div ref={chartWrapRef} className={fsMode ? "" : "flex h-full flex-col"} style={fsMode ? { position: "fixed", inset: 0, zIndex: 999, display: "flex", flexDirection: "column", background: "var(--bg)" } : undefined}>
            {/* MT5-style slim toolbar — symbol / TF / fullscreen for both LW and TV */}
            <div className="relative flex h-11 shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel)] px-1">
              {/* Symbol picker */}
              <button onPointerDown={(e) => { e.preventDefault(); setSymSearch(""); setSymPickerOpen(true); setTfPickerOpen(false); }} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ touchAction: "manipulation" }}>
                <SymIcon symbol={selSym} size={18} />
                <span className="text-[13px] font-bold text-[var(--text)]">{selSym || "Symbol"}</span>
                <i className="fa-solid fa-chevron-down text-[8px] opacity-40" />
              </button>
              <div className="flex-1" />
              {/* TF pill button */}
              <button onClick={() => setTfPickerOpen((o) => !o)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-bold" style={{ background: "rgba(41,98,255,0.12)", borderColor: "rgba(41,98,255,0.28)", color: "#4a7fff", touchAction: "manipulation" }}>
                {tf} <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
              </button>
              <div style={{ width: 2 }} />
              {/* Indicators */}
              <button onClick={() => { setCfgSheet(true); setTfPickerOpen(false); }} className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: "var(--muted)", touchAction: "manipulation" }} title="Indicators">
                <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.75">
                  <line x1="0" y1="4" x2="16" y2="4" /><line x1="0" y1="10" x2="16" y2="10" />
                  <circle cx="4" cy="4" r="2.2" fill="var(--panel)" /><circle cx="11" cy="10" r="2.2" fill="var(--panel)" />
                </svg>
              </button>
              {/* Fullscreen — CSS-based, works on iOS */}
              <button onClick={() => { setTfPickerOpen(false); setFsMode((f) => !f); }} className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: "var(--muted)", touchAction: "manipulation" }} title={fsMode ? "Exit fullscreen" : "Fullscreen"}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.75">
                  {fsMode ? <path d="M5 1v4H1M13 5h-4V1M9 13v-4h4M1 9h4v4" /> : <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />}
                </svg>
              </button>
              {/* TF picker dropdown */}
              {tfPickerOpen && (
                <div className="absolute left-0 right-0 top-full z-50 flex items-center gap-1 border-b border-[var(--border)] px-2 py-2" style={{ background: "var(--panel)" }}>
                  {(TFS || ["1M","5M","15M","30M","1H","4H","1D","1W"]).map((t: string) => (
                    <button key={t} onClick={() => { setTf(t); setTfPickerOpen(false); }} className="flex-1 rounded py-1.5 text-[11px] font-bold" style={t === tf ? { background: "rgba(41,98,255,0.18)", color: "#4a7fff", border: "1px solid rgba(41,98,255,0.28)" } : { color: "var(--muted)", border: "1px solid transparent" }}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Indicator settings bottom sheet (periods) — opened from full-screen */}
            {cfgSheet && (
              <>
                <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setCfgSheet(false)} />
                <div className="fixed inset-x-0 bottom-0 z-[90] rounded-t-3xl p-4" style={{ background: "var(--panel)", paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)" }}>
                  <div className="mb-3 flex items-center justify-between"><div className="text-sm font-bold text-[var(--text)]">Indicator Settings</div><button onClick={() => setCfgSheet(false)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark" /></button></div>
                  {([["ma", "MA period"], ["rsi", "RSI period"], ["bb", "Bollinger period"], ["macdF", "MACD fast"], ["macdS", "MACD slow"], ["macdSig", "MACD signal"]] as const).map(([k, lbl]) => (
                    <div key={k} className="mb-2.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-[var(--muted)]">{lbl}</span>
                      <input type="number" inputMode="numeric" min={1} value={t.chartCfg?.[k] ?? ""} onChange={(e) => t.setChartCfg && t.setChartCfg((c: any) => ({ ...c, [k]: Math.max(1, Number(e.target.value) || 1) }))} className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-right text-[15px] text-[var(--text)]" />
                    </div>
                  ))}
                  <button onClick={() => t.setChartCfg && t.setChartCfg({ ma: 20, rsi: 14, bb: 20, macdF: 12, macdS: 26, macdSig: 9 })} className="mt-1 w-full rounded-xl border border-[var(--border)] py-2.5 text-[12px] text-[var(--muted)]">Reset to defaults</button>
                </div>
              </>
            )}
            {/* Chart canvas */}
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg)]">
              {(() => {
                const pos = [
                  ...(positions || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, ticket: o.ticket, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                  ...(t.pending || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                ];
                return isTV
                  ? <TVMobileChart symbol={selSym} tf={tf} theme={theme as "dark" | "light"} digits={dg(selSym)} bare={true} showDrawingTools={true} symbols={symbols || []} spreadPips={_mobSpreadPips(selSym)} positions={pos} onSymbolChange={(sym) => setSelSym(sym)} />
                  : <LWMobileChart symbol={selSym} tf={tf} theme={theme as "dark" | "light"} digits={dg(selSym)} showTools={false} spreadPips={_mobSpreadPips(selSym)} positions={pos} />;
              })()}
              {/* Candle countdown — all charts, near price axis */}
              {countdown && <div className="pointer-events-none absolute bottom-8 right-[68px] font-mono text-[10px] tabular-nums select-none" style={{ color: "rgba(138,147,166,0.75)" }}>{countdown}</div>}
            </div>
            {/* Quick trade bar */}
            <div className="border-t border-[var(--border)]" style={{ background: "var(--panel)" }}>
              {/* SELL | − lot + | BUY */}
              <div className="flex items-stretch gap-1 px-1.5 py-1.5 min-[380px]:gap-1.5 min-[380px]:px-2.5 min-[380px]:py-2">
                <button onPointerDown={(e) => { e.preventDefault(); quickTrade(selSym, "SELL", chartVol); }} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white shadow-md transition active:scale-[0.98] disabled:opacity-50" style={{ background: SELLBTN, touchAction: "manipulation" }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide opacity-85">Sell</div>
                  <div className="text-[12px] font-bold tabular-nums min-[380px]:text-[13px]">{bid != null ? gnum(bid, dg(selSym)) : "…"}</div>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => setChartVol((v) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex h-8 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-base text-[var(--muted)] active:scale-95 min-[380px]:h-9 min-[380px]:w-8" style={{ background: "var(--soft)", touchAction: "manipulation" }}>−</button>
                  <input type="number" inputMode="decimal" step="0.01" autoComplete="off" value={chartVol} onChange={(e) => setChartVol(Number(e.target.value))} className="h-8 w-12 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1 text-center text-[11px] font-bold tabular-nums text-[var(--text)] outline-none min-[380px]:h-9 min-[380px]:w-14 min-[380px]:text-[12px]" style={{ touchAction: "manipulation" }} />
                  <button onClick={() => setChartVol((v) => +(v + 0.01).toFixed(2))} className="flex h-8 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-base text-[var(--muted)] active:scale-95 min-[380px]:h-9 min-[380px]:w-8" style={{ background: "var(--soft)", touchAction: "manipulation" }}>+</button>
                </div>
                <button onPointerDown={(e) => { e.preventDefault(); quickTrade(selSym, "BUY", chartVol); }} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white shadow-md transition active:scale-[0.98] disabled:opacity-50" style={{ background: BUYBTN, touchAction: "manipulation" }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide opacity-85">Buy</div>
                  <div className="text-[12px] font-bold tabular-nums min-[380px]:text-[13px]">{ask != null ? gnum(ask, dg(selSym)) : "…"}</div>
                </button>
              </div>
            </div>
            {err && <div className="bg-[var(--panel)] pb-1 text-center text-[11px]" style={{ color: SELL }}>{err}</div>}

            {/* Full order sheet — slides up from bottom */}
            {orderSheet && (() => {
              const dd = dg(selSym); const sprd = _mobSpreadPips(selSym);
              const mobMg = (price != null ? ((chartVol * csz(selSym) * price) / (account?.leverage || 100)) / (/JPY$/i.test(selSym) ? 100 : 1) : 0) / _fxRate;
              const doPlace = async (side: "BUY" | "SELL") => {
                if (mobOrderType === "MARKET") {
                  const trailPips = Number(mobTrail) || 0;
                  const cmt = mobComment || undefined;
                  if (trailPips > 0 || cmt) {
                    // need trailing stop or comment — call API directly
                    await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side, lots: chartVol, sl: Number(sl)||0, tp: Number(tp)||0, trailingStop: trailPips, comment: cmt, accountId: accId }) }).then((r) => r.json());
                    (t as any).load?.();
                  } else { quickTrade(selSym, side, chartVol); }
                } else if (mobOrderType === "STOP_LIMIT") {
                  if (!mobPendingPrice || !mobStopLimitEntry) return;
                  await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side, kind: "STOP_LIMIT", lots: chartVol, price: Number(mobPendingPrice), stopLimit: Number(mobStopLimitEntry), sl: Number(sl)||0, tp: Number(tp)||0, comment: mobComment||undefined, accountId: accId }) });
                  (t as any).load?.();
                } else {
                  await fetch("/api/client/pending", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ symbol: selSym, side, kind: mobOrderType, lots: chartVol, price: Number(mobPendingPrice), sl: Number(sl)||0, tp: Number(tp)||0, comment: mobComment||undefined, accountId: accId }) });
                  (t as any).load?.();
                }
                setOrderSheet(false);
              };
              return (
              <>
                <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setOrderSheet(false)} />
                <div className="fixed inset-x-0 bottom-0 z-[90] rounded-t-[24px]" style={{ background: "var(--panel)", paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)", maxHeight: "90dvh", overflowY: "auto" }}>
                  <div className="flex justify-center pt-2.5 pb-0.5"><div className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} /></div>
                  <div className="flex items-center justify-between px-4 py-2">
                    <div>
                      <div className="text-[13px] font-bold">{selSym}</div>
                      <div className="text-[10px] tabular-nums" style={{ color: "var(--muted)" }}>{bid != null ? gnum(bid, dd) : "—"} / {ask != null ? gnum(ask, dd) : "—"}</div>
                    </div>
                    <button onClick={() => setOrderSheet(false)} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark text-[11px]" /></button>
                  </div>

                  <div className="flex flex-col gap-2.5 px-4 pb-3">
                    {/* Order type */}
                    <div className="flex overflow-hidden rounded-xl border border-[var(--border)]">
                      {(["MARKET","LIMIT","STOP","STOP_LIMIT"] as const).map((ot) => (
                        <button key={ot} onClick={() => { setMobOrderType(ot); if (ot !== "MARKET" && !mobPendingPrice && price != null) setMobPendingPrice(price.toFixed(dd)); }} className="flex-1 py-2 text-[10px] font-semibold transition-colors" style={mobOrderType === ot ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{ot.replace("_"," ")}</button>
                      ))}
                    </div>

                    {/* Entry price (LIMIT/STOP/STOP_LIMIT only) */}
                    {mobOrderType !== "MARKET" && (
                      <input type="number" inputMode="decimal" autoComplete="off" value={mobPendingPrice} onChange={(e) => setMobPendingPrice(e.target.value)} placeholder={mobOrderType === "STOP_LIMIT" ? "Stop Price (trigger)" : "Entry Price"} className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[14px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    )}
                    {mobOrderType === "STOP_LIMIT" && (
                      <input type="number" inputMode="decimal" autoComplete="off" value={mobStopLimitEntry} onChange={(e) => setMobStopLimitEntry(e.target.value)} placeholder="Limit Price (fill at)" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[14px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    )}

                    {/* Volume stepper + quick lots */}
                    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button onClick={() => setChartVol((v) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-base text-[var(--muted)] active:scale-95">−</button>
                        <input type="number" inputMode="decimal" autoComplete="off" step="0.01" value={chartVol} onChange={(e) => setChartVol(Number(e.target.value))} className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-1 text-center text-[16px] font-bold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                        <button onClick={() => setChartVol((v) => +(v + 0.01).toFixed(2))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-base text-[var(--muted)] active:scale-95">+</button>
                      </div>
                      <div className="grid grid-cols-5 border-t border-[var(--border)]">
                        {LOTS.map((l) => <button key={l} onClick={() => setChartVol(l)} className="py-1.5 text-[11px] font-semibold border-r border-[var(--border)] last:border-r-0 transition-colors" style={chartVol === l ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{l}</button>)}
                      </div>
                    </div>

                    {/* TP + SL always visible */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#10b981" }}>Take Profit</div>
                        <input type="number" inputMode="decimal" autoComplete="off" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="" className="h-9 w-full rounded-xl border px-2 text-center text-[12px] tabular-nums text-[var(--text)] outline-none bg-[var(--bg)]" style={{ borderColor: tp ? "#10b981" : "var(--border)" }} />
                      </div>
                      <div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#e0394a" }}>Stop Loss</div>
                        <input type="number" inputMode="decimal" autoComplete="off" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="" className="h-9 w-full rounded-xl border px-2 text-center text-[12px] tabular-nums text-[var(--text)] outline-none bg-[var(--bg)]" style={{ borderColor: sl ? "#e0394a" : "var(--border)" }} />
                      </div>
                    </div>

                    {/* Info strip */}
                    <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--border)] text-center text-[10px]">
                      <div className="border-r border-[var(--border)] py-1.5">
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Margin</div>
                        <div className="font-semibold tabular-nums">{_cSym}{fmt(mobMg)}</div>
                      </div>
                      <div className="border-r border-[var(--border)] py-1.5">
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Free Margin</div>
                        <div className="font-semibold tabular-nums" style={{ color: "#22c55e" }}>{_cSym}{fmt(free)}</div>
                      </div>
                      <div className="py-1.5">
                        <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Spread</div>
                        <div className="font-semibold tabular-nums">{Math.round(sprd * 10)}</div>
                      </div>
                    </div>

                    {/* Trailing stop (market only) */}
                    {mobOrderType === "MARKET" && (
                      <div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Trailing Stop (pips, 0=off)</div>
                        <input type="number" inputMode="decimal" autoComplete="off" min="0" step="1" value={mobTrail} onChange={(e) => setMobTrail(e.target.value)} placeholder="0" className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[12px] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                      </div>
                    )}
                    {/* Comment */}
                    <div>
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Comment (optional)</div>
                      <input type="text" maxLength={128} value={mobComment} onChange={(e) => setMobComment(e.target.value)} placeholder="" className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    </div>

                    {err && <div className="text-center text-[11px]" style={{ color: SELL }}>{err}</div>}

                    {/* SELL | Lot+Spread center | BUY */}
                    <div className="flex items-stretch gap-2">
                      <button onPointerDown={(e) => { e.preventDefault(); doPlace("SELL"); }} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white shadow-md active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#ff6b78,#e0394a 70%,#b9293a)", touchAction: "manipulation" }}>
                        <span className="text-[9px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-down mr-0.5 text-[8px]" />Sell</span>
                        <span className="text-[15px] tabular-nums">{bid != null ? gnum(bid, dd) : "…"}</span>
                      </button>
                      <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[var(--border)] px-3" style={{ background: "var(--soft)" }}>
                        <span className="text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{chartVol}</span>
                        <span className="text-[7px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>Lots</span>
                        <span className="text-[8px] font-semibold" style={{ color: "var(--muted)" }}>{Math.round(sprd * 10)}</span>
                      </div>
                      <button onPointerDown={(e) => { e.preventDefault(); doPlace("BUY"); }} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white shadow-md active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#5aa0ff,#2f81f7 70%,#1e63cc)", touchAction: "manipulation" }}>
                        <span className="text-[9px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-up mr-0.5 text-[8px]" />Buy</span>
                        <span className="text-[15px] tabular-nums">{ask != null ? gnum(ask, dd) : "…"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
              );
            })()}
          </div>
        )}</KeepAlive>


        {/* ───────── TRADES ───────── */}
        {tab === "trades" && (
          <div>
            {/* Binance-style toggle: Positions | History */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <div className="flex gap-4">
                <button onClick={() => setTradeView("positions")} className="pb-1 text-[13px] font-bold transition-colors" style={{ color: tradeView === "positions" ? "var(--text)" : "var(--muted)", borderBottom: tradeView === "positions" ? "2px solid var(--accent)" : "2px solid transparent" }}>
                  Positions {(positions || []).length > 0 ? <span className="ml-1 rounded-full px-1.5 py-0.5 text-[11px]" style={{ background: "var(--soft)", color: "var(--muted)" }}>{positions.length}</span> : null}
                </button>
                <button onClick={() => setTradeView("history")} className="pb-1 text-[13px] font-bold transition-colors" style={{ color: tradeView === "history" ? "var(--text)" : "var(--muted)", borderBottom: tradeView === "history" ? "2px solid var(--accent)" : "2px solid transparent" }}>
                  History
                </button>
              </div>
              <button onClick={() => { setNoForm({ idx: 0, lots: vol || 0.01, trigger: "", sl: "", tp: "" }); setNoOpen(true); }} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: BLUE }}><i className="fa-solid fa-plus text-[11px]" /> New</button>
            </div>

          {tradeView === "positions" && (
          <div className="space-y-3 p-3 pb-16">
            {(positions || []).length === 0 ? <div className="py-4 text-center text-[12px] text-[var(--muted)]">No open positions.</div> : (positions || []).map((p: any) => {
              const cur = prices[p.symbol] ?? p.openPrice; const plv = pnlOf(p, cur, csz(p.symbol)); const dd = dg(p.symbol);
              const open = expanded === p.id;
              return (
                <div key={p.id} className="relative overflow-hidden rounded-xl">
                  {/* Red stripe revealed on left-swipe */}
                  <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center" style={{ background: SELL }}>
                    <i className="fa-solid fa-xmark text-xl text-white" />
                  </div>
                  {/* Swipeable card */}
                  <div
                    className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]"
                    style={{
                      borderLeft: `4px solid ${p.type === "BUY" ? BLUE : SELL}`,
                      transform: `translateX(${-(swipeX[p.id] ?? 0)}px)`,
                      transition: (swipeX[p.id] ?? 0) > 0 ? "none" : "transform 0.2s ease",
                    }}
                    onTouchStart={(e) => { swipeStart.current[p.id] = e.touches[0].clientX; }}
                    onTouchMove={(e) => {
                      const dx = swipeStart.current[p.id] - e.touches[0].clientX;
                      setSwipeX((prev) => ({ ...prev, [p.id]: Math.max(0, Math.min(120, dx)) }));
                    }}
                    onTouchEnd={() => {
                      const dx = swipeX[p.id] ?? 0;
                      if (dx > 90) { haptic([60, 40, 80]); close(p.id); setSwipeX((prev) => { const n = { ...prev }; delete n[p.id]; return n; }); }
                      else setSwipeX((prev) => ({ ...prev, [p.id]: 0 }));
                    }}
                  >
                  {/* Tap the row to open/close trade details (no separate arrow) */}
                  <div onClick={() => setExpanded(open ? null : p.id)} className="flex cursor-pointer select-none items-center justify-between p-3 active:bg-[var(--soft)]">
                    <div>
                      <div className="text-sm font-bold">{p.symbol} <span className="text-[12px] font-semibold" style={{ color: p.type === "BUY" ? BLUE : SELL }}>{p.type} {p.lots}</span>{p.masterTradeId && <span className="ml-1 rounded px-0.5 text-[8px] font-bold" style={{ background: "#7c3aed22", color: "#7c3aed" }}>COPY</span>}</div>
                      <div className="text-[10px] text-[var(--muted)]">{gnum(Number(p.openPrice), dd)} → {gnum(cur, dd)}</div>
                      {(p.sl > 0 || p.tp > 0 || p.trailingStop > 0) && (
                        <div className="mt-0.5 flex gap-2 text-[9px] font-semibold tabular-nums">
                          {p.sl > 0 && <span style={{ color: "#f43f5e" }}>{p.trailingStop > 0 ? "TSL" : "SL"} {gnum(Number(p.sl), dd)}</span>}
                          {p.tp > 0 && <span style={{ color: "#10b981" }}>TP {gnum(Number(p.tp), dd)}</span>}
                          {p.trailingStop > 0 && !p.sl && <span style={{ color: "#f59e0b" }}>TSL active</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold tabular-nums" style={{ color: plv >= 0 ? BUY : SELL }}>{(plv >= 0 ? "+" : "") + _cSym + fmt(plv)}</span>
                      <button onClick={(e) => { e.stopPropagation(); close(p.id); }} className="flex h-7 w-7 items-center justify-center rounded-full border" style={{ borderColor: SELL, color: SELL }}><i className="fa-solid fa-xmark" /></button>
                    </div>
                  </div>
                  {open && (
                    <div className="border-t border-[var(--border)] p-3">
                      <div className="mb-2 text-[10px] text-[var(--muted)]">#{p.ticket} · opened {p.openedAt ? new Date(p.openedAt).toLocaleString() : "—"}</div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div><div className="text-[var(--muted)]">LOTS</div><div className="font-semibold">{p.lots}</div></div>
                        <div><div className="text-[var(--muted)]">OPEN</div><div className="font-semibold">{gnum(Number(p.openPrice), dd)}</div></div>
                        <div><div className="text-[var(--muted)]">CURRENT</div><div className="font-semibold">{gnum(cur, dd)}</div></div>
                        <div><div className="text-[var(--muted)]">S/L</div><div className="font-semibold">{p.sl ? gnum(Number(p.sl), dd) : "—"}</div></div>
                        <div><div className="text-[var(--muted)]">T/P</div><div className="font-semibold">{p.tp ? gnum(Number(p.tp), dd) : "—"}</div></div>
                        <div><div className="text-[var(--muted)]">TYPE</div><div className="font-semibold">{p.type}</div></div>
                        {Number(p.trailingStop ?? 0) > 0 && <div><div className="text-[var(--muted)]">TRAIL</div><div className="font-semibold" style={{ color: "#f59e0b" }}>{Math.round(Number(p.trailingStop) / Math.pow(10, -(dd - 1)))}p</div></div>}
                        {swapEnabled && Number(p.commission ?? 0) !== 0 && <div><div className="text-[var(--muted)]">COMM</div><div className="font-semibold" style={{ color: SELL }}>-{fmt(Math.abs(Number(p.commission)))}</div></div>}
                        {swapEnabled && Number(p.swap ?? 0) !== 0 && <div><div className="text-[var(--muted)]">SWAP</div><div className="font-semibold" style={{ color: Number(p.swap) >= 0 ? BUY : SELL }}>{Number(p.swap) >= 0 ? "+" : ""}{fmt(Number(p.swap))}</div></div>}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button onClick={() => { setModifyId(p.id); setMSl(p.sl ? String(p.sl) : ""); setMTp(p.tp ? String(p.tp) : ""); setMTrail(p.trailingStop > 0 ? String(Math.round(Number(p.trailingStop) / Math.pow(10, -(dd - 1)))) : ""); }} className="rounded-lg border border-[var(--border)] bg-[var(--soft)] py-2 text-[11px] font-semibold"><i className="fa-solid fa-pen mr-1" />Modify</button>
                        {Number(p.lots) > 0.01 ? (
                          <button onClick={() => { setMobPartial({id: p.id, lots: Number(p.lots), sym: p.symbol}); setMobPartialLots(""); }} className="rounded-lg border border-[var(--border)] bg-[var(--soft)] py-2 text-[11px] font-semibold"><i className="fa-solid fa-scissors mr-1" />Partial</button>
                        ) : (
                          <button disabled className="rounded-lg border border-[var(--border)] py-2 text-[11px] font-semibold opacity-30" title="Minimum lot size — cannot partially close"><i className="fa-solid fa-scissors mr-1" />Partial</button>
                        )}
                        <button onClick={() => close(p.id)} className="rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: SELL }}><i className="fa-solid fa-xmark mr-1" />Close</button>
                      </div>
                      {modifyId === p.id && (
                        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3">
                          <div className="mb-2 text-[11px] font-semibold">Modify SL / TP / Trail</div>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="number" inputMode="decimal" autoComplete="off" value={mSl} onChange={(e) => setMSl(e.target.value)} placeholder="Stop loss" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
                            <input type="number" inputMode="decimal" autoComplete="off" value={mTp} onChange={(e) => setMTp(e.target.value)} placeholder="Take profit" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
                            <input type="number" inputMode="decimal" min="0" value={mTrail} onChange={(e) => setMTrail(e.target.value)} placeholder="Trail pips (0=off)" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)] col-span-2" style={{ borderColor: mTrail ? "#f59e0b" : undefined }} />
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => setModifyId(null)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[12px]">Cancel</button>
                            <button onClick={() => saveModify(p.id)} className="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BLUE }}>Save</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  </div>{/* end swipeable card */}
                </div>
              );
            })}


            {(pending || []).length > 0 && (<>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: BLUE }}><i className="fa-regular fa-clock mr-1" />Pending Orders ({pending.length})</div>
            {(pending || []).map((o: any) => {
              const dd = dg(o.symbol); const trig = Number(o.price); const cur = prices[o.symbol]; const dist = cur != null ? Math.abs(trig - cur) : null;
              const c = o.side === "BUY" ? BLUE : SELL; const label = (o.side === "BUY" ? "Buy" : "Sell") + " " + (o.kind === "LIMIT" ? "Limit" : o.kind === "STOP_LIMIT" ? "Stop Limit" : "Stop");
              return (
                <div key={o.id} className="rounded-xl border bg-[var(--card)] p-3" style={{ borderStyle: "dashed", borderColor: c, borderLeftWidth: 4, borderLeftStyle: "solid" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <i className="fa-regular fa-clock text-[var(--muted)]" />
                      <div>
                        <div className="text-sm font-bold">{o.symbol} <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: c + "22", color: c }}>{label}</span></div>
                        <div className="text-[10px] text-[var(--muted)]">Waiting · {o.lots} lots</div>
                      </div>
                    </div>
                    <button onClick={() => cancelPending(o.id)} className="flex h-7 w-7 items-center justify-center rounded-full border" style={{ borderColor: SELL, color: SELL }}><i className="fa-solid fa-xmark" /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div><div className="text-[var(--muted)]">{o.kind === "STOP_LIMIT" ? "STOP" : "TRIGGER"}</div><div className="font-semibold">{gnum(trig, dd)}</div></div>
                    <div><div className="text-[var(--muted)]">CURRENT</div><div className="font-semibold">{cur != null ? gnum(cur, dd) : "…"}</div></div>
                    {o.kind === "STOP_LIMIT"
                      ? <div><div className="text-[var(--muted)]">LIMIT AT</div><div className="font-semibold">{o.stopLimit ? gnum(Number(o.stopLimit), dd) : "—"}</div></div>
                      : <div><div className="text-[var(--muted)]">DISTANCE</div><div className="font-semibold">{dist != null ? gnum(dist, dd) : "—"}</div></div>}
                    <div><div className="text-[var(--muted)]">S/L</div><div className="font-semibold">{o.sl ? gnum(Number(o.sl), dd) : "—"}</div></div>
                    <div><div className="text-[var(--muted)]">T/P</div><div className="font-semibold">{o.tp ? gnum(Number(o.tp), dd) : "—"}</div></div>
                    {o.comment && <div className="col-span-3 truncate"><div className="text-[var(--muted)]">NOTE</div><div className="font-semibold text-[10px] truncate">{o.comment}</div></div>}
                  </div>
                </div>
              );
            })}</>)}
          </div>
          )}


          {/* ── HISTORY view inside Trade tab ── */}
          {tradeView === "history" && (
          <div className="p-3">
            <div className="mb-3 flex gap-2">
              <button onClick={() => setHistTab("trades")} className="flex-1 rounded-lg py-2 text-[12px] font-semibold" style={{ background: histTab === "trades" ? BLUE : "var(--soft)", color: histTab === "trades" ? "#fff" : "var(--muted)" }}>Trades</button>
              <button onClick={() => setHistTab("financial")} className="flex-1 rounded-lg py-2 text-[12px] font-semibold" style={{ background: histTab === "financial" ? BLUE : "var(--soft)", color: histTab === "financial" ? "#fff" : "var(--muted)" }}>Financial</button>
            </div>
            {histTab === "trades" ? (
              <div className="space-y-2.5">
                {(history || []).length === 0 ? <div className="py-6 text-center text-[12px] text-[var(--muted)]">No closed trades.</div> : (history || []).map((h: any) => {
                  const dd = dg(h.symbol);
                  return (
                    <div key={h.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{h.symbol}</span>
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: h.side === "BUY" ? BUY : SELL }}>{h.side}</span>
                          <span className="text-[11px] text-[var(--muted)]">{h.lots}</span>
                          {h.closeReason && (() => {
                            const cr = String(h.closeReason).toUpperCase();
                            const isTP = cr === "TP" || cr.includes("TAKE");
                            const isSL = cr === "SL" || cr.includes("STOP LOSS");
                            const isMC = cr === "MC" || cr.includes("MARGIN") || cr.includes("STOP OUT") || cr.includes("LIQUID");
                            if (!isTP && !isSL && !isMC) return null;
                            const lbl = isTP ? "TP" : isSL ? "SL" : "MC";
                            const col = isTP ? BUY : SELL;
                            return <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: col, color: "#fff" }} title={"Closed: " + lbl}>{lbl}</span>;
                          })()}
                        </div>
                        <div>
                          <div className="text-[10px] text-right text-[var(--muted)]">Gross</div>
                          <div className="text-sm font-bold" style={{ color: Number(h.pnl) >= 0 ? BUY : SELL }}>{(Number(h.pnl) >= 0 ? "+" : "") + fmt(Number(h.pnl))}</div>
                        </div>
                      </div>
                      <div className="mt-1 flex gap-2 text-[10px] text-[var(--muted)]"><span className="tabular-nums">#{h.ticket || "—"}</span><span>{gnum(Number(h.openPrice), dd)} → {gnum(Number(h.closePrice), dd)}</span></div>
                      {swapEnabled && (Number(h.swap ?? 0) !== 0 || Number(h.commission ?? 0) !== 0) && (() => { const net = Number(h.pnl) + Number(h.swap ?? 0) - Number(h.commission ?? 0); return (
                        <div className="mt-1 flex gap-3 text-[9px]">
                          {Number(h.swap ?? 0) !== 0 && <span style={{ color: Number(h.swap) >= 0 ? BUY : SELL }}>Swap {Number(h.swap) >= 0 ? "+" : ""}{fmt(Number(h.swap))}</span>}
                          {Number(h.commission ?? 0) !== 0 && <span style={{ color: SELL }}>Comm -{fmt(Number(h.commission))}</span>}
                          <span className="ml-auto font-semibold" style={{ color: net >= 0 ? BUY : SELL }}>Net {net >= 0 ? "+" : ""}{fmt(net)}</span>
                        </div>
                      ); })()}
                      <div className="mt-1 flex gap-3 text-[9px] text-[var(--muted)]">
                        <span><i className="fa-solid fa-play mr-1" />{h.openedAt ? new Date(h.openedAt).toLocaleString() : "—"}</span>
                        <span><i className="fa-solid fa-stop mr-1" />{h.closedAt ? new Date(h.closedAt).toLocaleString() : "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2.5">
                {(financials || []).length === 0 ? (
                  <div className="py-10 text-center text-[12px] text-[var(--muted)]">No financial records.</div>
                ) : (financials || []).map((f: any) => {
                  const credit = ["DEPOSIT", "CREDIT_IN", "BONUS", "TRANSFER_IN", "INSURANCE"].includes(f.type) || (f.type === "PNL_ADJUST" && Number(f.amount) >= 0);
                  const typeMap: Record<string, { icon: string; label: string; color: string; bg: string }> = {
                    DEPOSIT:     { icon: "fa-download",           label: "Deposit",     color: "#16a34a", bg: "rgba(22,163,74,0.12)" },
                    WITHDRAWAL:  { icon: "fa-upload",             label: "Withdrawal",  color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
                    CREDIT_IN:   { icon: "fa-circle-plus",        label: "Credit In",   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
                    CREDIT_OUT:  { icon: "fa-circle-minus",       label: "Credit Out",  color: "#f97316", bg: "rgba(249,115,22,0.12)" },
                    BONUS:       { icon: "fa-gift",               label: "Bonus",       color: "#a855f7", bg: "rgba(168,85,247,0.12)" },
                    INSURANCE:   { icon: "fa-shield-halved",      label: "Insurance",   color: "#06b6d4", bg: "rgba(6,182,212,0.12)" },
                    TRANSFER_IN: { icon: "fa-right-to-bracket",   label: "Transfer In", color: "#16a34a", bg: "rgba(22,163,74,0.12)" },
                    TRANSFER_OUT:{ icon: "fa-right-from-bracket", label: "Transfer Out",color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
                    PNL_ADJUST:  { icon: "fa-chart-line",         label: "P&L Adjust",  color: credit ? "#16a34a" : "#ef4444", bg: credit ? "rgba(22,163,74,0.12)" : "rgba(239,68,68,0.12)" },
                  };
                  const meta = typeMap[f.type] || { icon: "fa-circle-dot", label: String(f.type).replace(/_/g, " "), color: "var(--muted)", bg: "var(--soft)" };
                  const amt = Math.abs(Number(f.amount));
                  const sign = credit ? "+" : "-";
                  return (
                    <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
                      {/* icon bubble */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: meta.bg }}>
                        <i className={`fa-solid ${meta.icon} text-[15px]`} style={{ color: meta.color }} />
                      </div>
                      {/* label + date */}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-[var(--text)]">{meta.label}</div>
                        {f.description && <div className="truncate text-[11px] text-[var(--muted)]">{f.description}</div>}
                        <div className="text-[10px] text-[var(--muted)]">{f.appliedAt ? new Date(f.appliedAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                      </div>
                      {/* amount */}
                      <div className="shrink-0 text-right">
                        <div className="text-[15px] font-bold tabular-nums" style={{ color: meta.color }}>{sign}{_cSym}{fmt(amt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
          </div>
        )}

        {/* ───────── ACCOUNT ───────── */}
        {tab === "account" && (
          <div>
            <div className="space-y-4 p-3">
            {needKyc && (
              <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(240,180,41,0.5)", background: "rgba(240,180,41,0.1)" }}>
                <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "#f0b829" }}><i className="fa-solid fa-id-card" /> Verify your identity</div>
                <p className="mt-1 text-[12px] text-[var(--muted)]">Upload your Identity Document and Address Proof to unlock trading on your live account. Demo accounts work without KYC — switch below to trade demo now.</p>
                <button onClick={() => setWalletTab("kyc")} className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{ background: "#f0b829" }}>Upload KYC</button>
                {demoAccts.length > 0 && <button onClick={() => { const d = demoAccts.find((a: any) => a.id !== accId) || demoAccts[0]; if (d) switchAcc(d.id); }} className="mt-2 w-full rounded-xl border py-2 text-[12px] font-semibold" style={{ borderColor: "var(--border)" }}>Switch to demo account</button>}
              </div>
            )}
            {/* header block */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar size={64} />
                  <button onClick={() => !avatarUploading && avatarRef.current?.click()} disabled={avatarUploading} className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: BUY, border: "2px solid var(--card)", opacity: avatarUploading ? 0.7 : 1 }}><i className={avatarUploading ? "fa-solid fa-spinner fa-spin text-[10px]" : "fa-solid fa-pencil text-[10px]"} /></button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-base font-bold">{account?.ownerName || account?.name} <i className="fa-solid fa-circle-check text-[13px]" style={{ color: BLUE }} /></div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]"><i className="fa-solid fa-envelope mr-1.5" />{account?.email || "—"}</div>
                  <div className="text-[11px] text-[var(--muted)]"><i className="fa-solid fa-phone mr-1.5" />{account?.phone || <span style={{ color: SELL }}>Not set</span>}</div>
                  <div className="text-[11px] text-[var(--muted)]"><i className="fa-solid fa-globe mr-1.5" />{account?.country || <span style={{ color: SELL }}>Not set</span>}</div>
                </div>
                {(!account?.phone || !account?.country) && (
                  <button onClick={openProfileEdit} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "rgba(239,83,80,0.15)", color: SELL }}><i className="fa-solid fa-circle-exclamation text-[13px]" /></button>
                )}
              </div>
            </div>

            {/* balance summary */}
            <div className="glass-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide">BALANCE SUMMARY</div>
                <select value={accId} onChange={(e) => switchAcc(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)]">
                  {(accts || []).map((a: any) => <option key={a.id} value={a.id}>{a.id === accId ? `Active (${a.login})` : a.login}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between py-1 text-[12px]">
                <span>{account?.login} {account?.type} <i className="fa-solid fa-circle text-[7px] align-middle" style={{ color: BUY }} /></span>
                <span className="font-bold" style={{ color: BUY }}>{_cSym}{fmt(balance)}</span>
              </div>
              <div className="my-2 border-t border-[var(--border)]" />
              <div className="flex items-center justify-between py-1 text-[12px] font-bold"><span>Total Balance</span><span>{_cSym}{fmt(totalBal)}</span></div>
              <div className="mt-2 text-[10px] font-semibold text-[var(--muted)]">ACCOUNT DETAILS</div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Deposit</span><span>{_cSym}{fmt(Number(account?.deposit || 0))}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Withdrawal</span><span>{_cSym}{fmt(Number(account?.withdrawal || 0))}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Profit</span><span style={{ color: Number(account?.pnl || 0) >= 0 ? BUY : SELL }}>{_cSym}{fmt(Number(account?.pnl || 0))}</span></div>
            </div>

            {/* running trade summary */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">RUNNING TRADE SUMMARY</div>
              <div className="mb-2 text-[10px] text-[var(--muted)]">Showing: {account?.login} · {account?.type} · {(positions || []).length} open</div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Equity</span><span style={{ color: equity >= balance ? BUY : SELL }}>{_cSym}{fmt(equity)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Margin</span><span>{_cSym}{fmt(used)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Free Margin</span><span>{_cSym}{fmt(free)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Margin Level</span><span>{level ? level.toFixed(2) : "0.00"}%</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Profit</span><span style={{ color: floating >= 0 ? BUY : SELL }}>{_cSym}{fmt(floating)}</span></div>
            </div>

            {/* by direction */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">BY DIRECTION</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: "rgba(22,163,74,.1)" }}>
                  <div className="text-[11px] font-bold" style={{ color: BUY }}>BUY</div>
                  <div className="mt-1 text-sm font-bold">{sumLots(buyPos).toFixed(2)} lots</div>
                  <div className="text-[10px] text-[var(--muted)]">{buyPos.length} trades</div>
                  <div className="mt-1 text-[12px] font-semibold" style={{ color: sumPL(buyPos) >= 0 ? BUY : SELL }}>{_cSym}{fmt(sumPL(buyPos))}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: "rgba(220,38,38,.1)" }}>
                  <div className="text-[11px] font-bold" style={{ color: SELL }}>SELL</div>
                  <div className="mt-1 text-sm font-bold">{sumLots(sellPos).toFixed(2)} lots</div>
                  <div className="text-[10px] text-[var(--muted)]">{sellPos.length} trades</div>
                  <div className="mt-1 text-[12px] font-semibold" style={{ color: sumPL(sellPos) >= 0 ? BUY : SELL }}>{_cSym}{fmt(sumPL(sellPos))}</div>
                </div>
              </div>
            </div>

            {/* by symbol */}
            {Object.keys(bySym).length > 0 && (
              <div className="glass-card p-4">
                <div className="mb-2 text-[11px] font-bold tracking-wide">BY SYMBOL</div>
                {Object.entries(bySym).map(([sym, arr]) => {
                  const buyL = sumLots(arr.filter((p: any) => p.type === "BUY")); const sellL = sumLots(arr.filter((p: any) => p.type === "SELL"));
                  const pl = sumPL(arr);
                  return (
                    <div key={sym} className="flex items-center justify-between py-1.5">
                      <div>
                        <div className="text-[12px] font-semibold">{sym}</div>
                        <div className="text-[10px] text-[var(--muted)]">{arr.length} trades · {sumLots(arr).toFixed(2)}L · B:{buyL.toFixed(2)} S:{sellL.toFixed(2)}</div>
                      </div>
                      <div className="text-[12px] font-bold" style={{ color: pl >= 0 ? BUY : SELL }}>{_cSym}{fmt(pl)}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* live accounts */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide"><i className="fa-solid fa-bolt mr-1.5" style={{ color: GOLD }} />LIVE ACCOUNTS {liveAccts.length}</div>
              {liveAccts.map((a: any) => (
                <button key={a.id} onClick={() => a.id !== accId && switchAcc(a.id)} className="flex w-full items-center gap-2 py-2 text-left">
                  <i className="fa-solid fa-bolt" style={{ color: GOLD }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold">{a.login}
                      <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--soft)", color: a.id === accId ? BUY : "var(--muted)" }}>{a.id === accId ? "ACTIVE" : "TAP TO SWITCH"}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">{_cSym}{fmt(acctBal(a))} · 1:{a.leverage}</div>
                  </div>
                  {a.id === accId && <i className="fa-solid fa-circle-check" style={{ color: BUY }} />}
                </button>
              ))}
              {!isTrial && <button onClick={async () => { const r = await openAccount("LIVE"); if (r?.pending) { setMyReqsLoaded(false); loadMyReqs(); } }} className="mt-2 w-full rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BUY }}><i className="fa-solid fa-plus mr-1" /> Create New Live Account</button>}
            </div>

            {/* demo accounts */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide"><i className="fa-solid fa-vial mr-1.5" style={{ color: GOLD }} />DEMO ACCOUNTS {demoAccts.length}</div>
              {demoAccts.map((a: any) => (
                <button key={a.id} onClick={() => a.id !== accId && switchAcc(a.id)} className="flex w-full items-center gap-2 py-2 text-left">
                  <i className="fa-solid fa-flask" style={{ color: GOLD }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold">{a.login}
                      <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--soft)", color: a.id === accId ? BUY : "var(--muted)" }}>{a.id === accId ? "ACTIVE" : "TAP TO SWITCH"}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">{_cSym}{fmt(acctBal(a))} · 1:{a.leverage}</div>
                  </div>
                  {a.id === accId && <i className="fa-solid fa-circle-check" style={{ color: BUY }} />}
                </button>
              ))}
              {/* One demo per client: hide "Create" once a demo exists. Top-up lives on
                  the dashboard (demo account), not here. */}
              {!isTrial && demoAccts.length === 0 && (
                <button onClick={() => openAccount("DEMO")} className="mt-2 w-full rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BLUE }}><i className="fa-solid fa-plus mr-1" /> Create Demo Account</button>
              )}
            </div>

            {/* security */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">SECURITY & SIGN-IN</div>
              {/* PIN — toggle (on = set, off = remove) */}
              <button onClick={() => { if (pin?.pinHasPin) pin?.disablePin?.(); else openPin?.(); }} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className="fa-solid fa-shield-halved" style={{ color: pin?.pinHasPin ? BUY : "var(--muted)" }} />
                <div className="flex-1"><div className="text-[12px] font-semibold">PIN Access</div><div className="text-[10px] text-[var(--muted)]">{pin?.pinHasPin ? "Enabled — tap to disable" : "Tap to set a PIN"}</div></div>
                <div className="flex h-6 w-11 items-center rounded-full px-0.5 transition-colors duration-200" style={{ background: pin?.pinHasPin ? BUY : "var(--border)" }}>
                  <div className="h-5 w-5 rounded-full bg-white shadow transition-transform duration-200" style={{ transform: pin?.pinHasPin ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </button>
              {pin?.pinHasPin && (
                <button onClick={openPin} className="flex w-full items-center gap-3 py-1 pl-7 text-left text-[10px] text-[var(--muted)]"><i className="fa-solid fa-pen text-[9px]" /> Change PIN</button>
              )}
              {/* Biometric — toggle */}
              <button onClick={toggleBio} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className="fa-solid fa-fingerprint" style={{ color: bioOn ? BUY : "var(--muted)" }} />
                <div className="flex-1"><div className="text-[12px] font-semibold">Face ID / Fingerprint</div><div className="text-[10px] text-[var(--muted)]">{bioOn ? "Enabled — tap to disable" : "Tap to enable a passkey"}</div></div>
                <div className="flex h-6 w-11 items-center rounded-full px-0.5 transition-colors duration-200" style={{ background: bioOn ? BUY : "var(--border)" }}>
                  <div className="h-5 w-5 rounded-full bg-white shadow transition-transform duration-200" style={{ transform: bioOn ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </button>
              <button onClick={togglePush} disabled={pushBusy} className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-70">
                <i className={"fa-solid " + (pushBusy ? "fa-circle-notch fa-spin" : "fa-bell")} style={{ color: pushEnabled ? BUY : "var(--muted)" }} />
                <div className="flex-1">
                  <div className="text-[12px] font-semibold">Push Notifications</div>
                  <div className="text-[10px] text-[var(--muted)]">{pushBusy ? "Working…" : pushEnabled ? "Enabled — tap to disable" : "Tap to enable alerts"}</div>
                </div>
                <div className="flex h-6 w-11 items-center rounded-full px-0.5 transition-colors duration-200" style={{ background: pushEnabled ? BUY : "var(--border)" }}>
                  <div className="h-5 w-5 rounded-full bg-white shadow transition-transform duration-200" style={{ transform: pushEnabled ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </button>
              {/* 2FA */}
              <button onClick={() => { setTotpErr(""); setTotpMsg(""); setTotpCode(""); if (totpEnabled) setTotpModal("disable"); else openTotpSetup(); }} disabled={totpBusy} className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-60">
                <i className="fa-solid fa-lock" style={{ color: totpEnabled ? BUY : "var(--muted)" }} />
                <div className="flex-1">
                  <div className="text-[12px] font-semibold">Authenticator App (2FA)</div>
                  <div className="text-[10px] text-[var(--muted)]">{totpBusy ? "Loading…" : totpEnabled ? "Enabled — tap to disable" : "Tap to set up Google Authenticator"}</div>
                </div>
                <div className="flex h-6 w-11 items-center rounded-full px-0.5 transition-colors duration-200" style={{ background: totpEnabled ? BUY : "var(--border)" }}>
                  <div className="h-5 w-5 rounded-full bg-white shadow transition-transform duration-200" style={{ transform: totpEnabled ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </button>
              {totpMsg && <div className="pl-7 text-[10px]" style={{ color: BUY }}>{totpMsg}</div>}
              <button onClick={toggleTheme} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className={`fa-solid fa-${theme === "dark" ? "sun" : "moon"} text-[var(--muted)]`} />
                <div className="flex-1"><div className="text-[12px] font-semibold">{theme === "dark" ? "Light mode" : "Dark mode"}</div></div>
                <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
              </button>
            </div>

            {/* my requests */}
            <div className="glass-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide"><i className="fa-solid fa-clock-rotate-left mr-1.5" style={{ color: GOLD }} />MY REQUESTS</div>
                <span className="text-[9px] text-[var(--muted)]">{myReqs.length} total</span>
              </div>
              {!myReqsLoaded ? (
                <div className="py-3 text-center text-[11px] text-[var(--muted)]">Loading…</div>
              ) : myReqs.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-[var(--muted)]">No requests yet.</div>
              ) : (<>
                <div className="space-y-2">{myReqs.slice(0, 5).map(reqRow)}</div>
                {myReqs.length > 5 && (
                  <button onClick={() => setReqsOpen(true)} className="mt-2.5 w-full rounded-xl py-2 text-[12px] font-semibold" style={{ background: "var(--soft)", color: BLUE }}>View all ({myReqs.length})</button>
                )}
              </>)}
            </div>

            {/* export */}
            <button onClick={() => { setStmtPreset("month"); setStmtFrom(""); setStmtTo(""); setStmtOpen(true); }} className="flex w-full items-center gap-3 glass-card p-4 text-left">
              <i className="fa-solid fa-file-pdf" style={{ color: SELL }} />
              <div className="flex-1"><div className="text-[12px] font-semibold">Export PDF Statement</div><div className="text-[10px] text-[var(--muted)]">Choose a period — download or email</div></div>
              <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
            </button>

            {/* logout */}
            <button onClick={logout} className="w-full rounded-xl py-3 text-sm font-semibold text-white" style={{ background: SELL }}><i className="fa-solid fa-right-from-bracket mr-1.5" /> Logout</button>
          </div>
          </div>
        )}
      </div>

      {/* ACCOUNT-REQUEST SUBMITTED — centered confirmation */}
      {acctReqModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setAcctReqModal && setAcctReqModal(false)}>
          <div className="glass-card w-full max-w-[320px] p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: BLUE + "22" }}>
              <i className="fa-solid fa-paper-plane text-xl" style={{ color: BLUE }} />
            </div>
            <div className="text-[15px] font-bold">Request Sent</div>
            <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">Your new live account request has been sent for approval. You'll be notified once it's reviewed. Track its status under <span className="font-semibold text-[var(--text)]">Profile → My Requests</span>.</div>
            <button onClick={() => { setAcctReqModal && setAcctReqModal(false); setTab("account"); }} className="mt-4 w-full rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: BLUE }}>View My Requests</button>
            <button onClick={() => setAcctReqModal && setAcctReqModal(false)} className="mt-2 w-full rounded-xl py-2 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Close</button>
          </div>
        </div>
      )}

      {/* NEW ORDER / PENDING MODAL */}
      {noOpen && (() => {
        const dd = dg(selSym);
        const doPlace = async (side: "BUY" | "SELL") => {
          const kind = mobOrderType;
          let ok: boolean;
          if (kind === "MARKET") {
            const trailPips = Number(mobTrail) || 0;
            const cmt = mobComment || undefined;
            if (trailPips > 0 || cmt) {
              const r = await fetch("/api/client/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side, lots: Number(noOpenVol), sl: Number(sl)||0, tp: Number(tp)||0, trailingStop: trailPips, comment: cmt, accountId: accId }) }).then((x) => x.json()).catch(() => ({ ok: false }));
              ok = r.ok;
              if (ok) (t as any).load?.();
            } else { ok = !!(await quickTrade(selSym, side, Number(noOpenVol))); }
          } else if (kind === "STOP_LIMIT") {
            if (!mobPendingPrice || !mobStopLimitEntry) return;
            const r = await fetch("/api/client/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selSym, side, kind: "STOP_LIMIT", lots: Number(noOpenVol), price: Number(mobPendingPrice), stopLimit: Number(mobStopLimitEntry), sl: Number(sl)||0, tp: Number(tp)||0, comment: mobComment||undefined, accountId: accId }) }).then((x) => x.json()).catch(() => ({ ok: false }));
            ok = r.ok; if (ok) (t as any).load?.();
          } else {
            const rp = await fetch("/api/client/pending", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ symbol: selSym, side, kind, lots: Number(noOpenVol), price: Number(mobPendingPrice), sl: Number(sl)||0, tp: Number(tp)||0, comment: mobComment||undefined, accountId: accId }) }).then((x) => x.json()).catch(() => ({ok:false}));
            ok = rp.ok; if (ok) (t as any).load?.();
          }
          if (ok) { haptic([40, 30, 60]); setNoOpen(false); setMobTpEnabled(false); setMobSlEnabled(false); }
          else { haptic([80, 40, 80]); }
        };
        const sprd = _mobSpreadPips(selSym);
        return (
          <div className="fixed inset-0 z-[95] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setNoOpen(false)}>
            <div className="glass glass-edge w-full rounded-t-[26px]" style={{ background: theme === "dark" ? "rgba(18,22,32,0.97)" : "var(--panel)", borderTop: "1px solid var(--border)", maxHeight: "92dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              {/* handle */}
              <div className="flex justify-center pt-2.5 pb-1"><div className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} /></div>
              {/* header */}
              <div className="flex items-center justify-between px-4 pb-2">
                <div className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{selSym} — New Order</div>
                <button onClick={() => setNoOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark text-[11px]" /></button>
              </div>

              <div className="flex flex-col gap-3 px-4 pb-5">
                {/* Order type */}
                <div className="flex overflow-hidden rounded-xl border border-[var(--border)]">
                  {(["MARKET","LIMIT","STOP","STOP_LIMIT"] as const).map((ot) => (
                    <button key={ot} onClick={() => { setMobOrderType(ot); if (ot !== "MARKET" && !mobPendingPrice && price != null) setMobPendingPrice(price.toFixed(dd)); }} className="flex-1 py-2.5 text-[10px] font-semibold transition-colors" style={mobOrderType === ot ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{ot.replace("_"," ")}</button>
                  ))}
                </div>

                {/* Entry price (LIMIT / STOP / STOP_LIMIT only) */}
                {mobOrderType !== "MARKET" && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{mobOrderType === "STOP_LIMIT" ? "Stop Price (trigger)" : "Entry Price"}</div>
                    <input type="number" inputMode="decimal" autoComplete="off" value={mobPendingPrice} onChange={(e) => setMobPendingPrice(e.target.value)} placeholder="Target Price" className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[15px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                )}
                {mobOrderType === "STOP_LIMIT" && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Limit Price (fill at)</div>
                    <input type="number" inputMode="decimal" autoComplete="off" value={mobStopLimitEntry} onChange={(e) => setMobStopLimitEntry(e.target.value)} placeholder="Limit Price" className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[15px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                )}

                {/* Volume + lot buttons */}
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <div className="border-b border-[var(--border)] px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Volume (Lots)</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => setNoOpenVol((v) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-lg text-[var(--muted)] active:scale-95">−</button>
                    <input type="number" inputMode="decimal" autoComplete="off" step="0.01" value={noOpenVol} onChange={(e) => setNoOpenVol(Number(e.target.value))} className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-1 text-center text-[18px] font-bold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    <button onClick={() => setNoOpenVol((v) => +(v + 0.01).toFixed(2))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-lg text-[var(--muted)] active:scale-95">+</button>
                  </div>
                  <div className="grid grid-cols-5 border-t border-[var(--border)]">
                    {LOTS.map((l) => <button key={l} onClick={() => setNoOpenVol(l)} className="py-2 text-[11px] font-semibold border-r border-[var(--border)] last:border-r-0 transition-colors" style={noOpenVol === l ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}>{l}</button>)}
                  </div>
                </div>

                {/* TP + SL always visible */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#10b981" }}>Take Profit</div>
                    <input type="number" inputMode="decimal" autoComplete="off" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="" className="h-9 w-full rounded-xl border px-2 text-center text-[12px] tabular-nums text-[var(--text)] outline-none bg-[var(--bg)]" style={{ borderColor: tp ? "#10b981" : "var(--border)" }} />
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#e0394a" }}>Stop Loss</div>
                    <input type="number" inputMode="decimal" autoComplete="off" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="" className="h-9 w-full rounded-xl border px-2 text-center text-[12px] tabular-nums text-[var(--text)] outline-none bg-[var(--bg)]" style={{ borderColor: sl ? "#e0394a" : "var(--border)" }} />
                  </div>
                </div>

                {/* Info strip */}
                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--border)] text-center text-[10px]">
                  <div className="border-r border-[var(--border)] py-1.5">
                    <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Margin</div>
                    <div className="font-semibold tabular-nums">{account ? (() => { const mg = (price != null ? ((noOpenVol * csz(selSym) * price) / (account?.leverage || 100)) / (/JPY$/i.test(selSym) ? 100 : 1) : 0) / _fxRate; return _cSym + fmt(mg); })() : _cSym + "0"}</div>
                  </div>
                  <div className="border-r border-[var(--border)] py-1.5">
                    <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Free Margin</div>
                    <div className="font-semibold tabular-nums" style={{ color: "#22c55e" }}>{account ? _cSym + fmt(free) : "--"}</div>
                  </div>
                  <div className="py-1.5">
                    <div className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Spread</div>
                    <div className="font-semibold tabular-nums">{Math.round(sprd * 10)}</div>
                  </div>
                </div>

                {/* Trailing stop (market only) + comment */}
                {mobOrderType === "MARKET" && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Trailing Stop (pips, 0=off)</div>
                    <input type="number" inputMode="decimal" autoComplete="off" min="0" step="1" value={mobTrail} onChange={(e) => setMobTrail(e.target.value)} placeholder="0" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center text-[13px] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                )}
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Comment (optional)</div>
                  <input type="text" maxLength={128} value={mobComment} onChange={(e) => setMobComment(e.target.value)} placeholder="" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                </div>

                {err && <div className="text-center text-[11px]" style={{ color: SELL }}>{err}</div>}

                {/* SELL | Lot+Spread center | BUY */}
                <div className="flex items-stretch gap-2">
                  <button onClick={() => doPlace("SELL")} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white shadow-md active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#ff6b78,#e0394a 70%,#b9293a)" }}>
                    <span className="text-[10px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-down mr-1 text-[9px]" />Sell</span>
                    <span className="text-[16px] tabular-nums">{bid != null ? gnum(bid, dd) : "…"}</span>
                  </button>
                  <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[var(--border)] px-3" style={{ background: "var(--soft)" }}>
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{noOpenVol}</span>
                    <span className="text-[7px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>Lots</span>
                    <span className="text-[8px] font-semibold" style={{ color: "var(--muted)" }}>{Math.round(sprd * 10)}</span>
                  </div>
                  <button onClick={() => doPlace("BUY")} disabled={!account || account?.locked} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white shadow-md active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(160deg,#5aa0ff,#2f81f7 70%,#1e63cc)" }}>
                    <span className="text-[10px] uppercase tracking-wide opacity-90"><i className="fa-solid fa-arrow-trend-up mr-1 text-[9px]" />Buy</span>
                    <span className="text-[16px] tabular-nums">{ask != null ? gnum(ask, dd) : "…"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PERSISTENT BALANCE BAR */}
      <button onClick={() => setBalOpen((v: boolean) => !v)} className="glass flex w-full items-center justify-between border-t px-4 py-1.5" style={{ borderColor: "var(--border)", background: theme === "dark" ? "rgba(20,24,34,0.55)" : "var(--panel)" }}>
        <span className="text-[11px] text-[var(--muted)]"><i className="fa-solid fa-briefcase mr-1.5" />Balance <i className={"fa-solid ml-0.5 " + (balOpen ? "fa-chevron-down" : "fa-chevron-up")} /></span>
        <span className="text-base font-bold tabular-nums" style={{ color: balance >= 0 ? BUY : SELL }}>{_cSym}{fmt(balance)}</span>
      </button>
      {balOpen && (
        <div className="border-t border-[var(--border)] px-4 py-3" style={{ background: "var(--card)" }}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Balance</span><span className="font-semibold tabular-nums">{_cSym}{fmt(balance)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Equity</span><span className="font-semibold tabular-nums">{_cSym}{fmt(equity)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Floating P/L</span><span className="font-semibold tabular-nums" style={{ color: floating >= 0 ? BUY : SELL }}>{_cSym}{fmt(floating)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Used Margin</span><span className="font-semibold tabular-nums">{_cSym}{fmt(used)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Free Margin</span><span className="font-semibold tabular-nums">{_cSym}{fmt(free)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Margin Level</span><span className="font-semibold tabular-nums">{used > 0 ? level.toFixed(1) + "%" : "—"}</span></div>
          </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <div style={{ background: "var(--panel)", borderTop: "1px solid var(--border)", paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }} className="px-2 pt-1.5">
        <div className="flex items-stretch justify-around">
          {navItems.map(([k, icon, label]) => {
            const active = tab === k;
            const col = active ? A1 : "var(--muted)";
            const badge = k === "trades" && (positions || []).length > 0 ? (positions || []).length : k === "account" && needKyc ? "!" : null;
            return (
              <button key={k} onClick={() => startTransition(() => setTab(k as any))} aria-label={label}
                className="relative flex flex-1 flex-col items-center gap-0.5 py-1 active:opacity-70">
                {/* pill background on active */}
                <span className="absolute inset-x-1 top-0.5 bottom-0.5 rounded-2xl transition-all duration-300" style={{ background: active ? `${A1}18` : "transparent" }} />
                <span className="relative flex items-center justify-center">
                  <i className={`fa-solid ${icon}`} style={{ fontSize: 18, color: col, transition: "color .2s, transform .25s cubic-bezier(.34,1.56,.64,1)", transform: active ? "scale(1.12)" : "scale(1)" }} />
                  {badge && <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white" style={{ background: badge === "!" ? "#f59e0b" : A1, border: "1.5px solid var(--panel)" }}>{badge}</span>}
                </span>
                <span className="relative text-[9px] font-bold tracking-wide" style={{ color: col, transition: "color .2s" }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TRANSFER MODAL */}
      {xferModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="glass glass-edge w-full max-w-[340px] rounded-[22px] border p-4" style={{ background: theme === "dark" ? "rgba(28,30,38,0.85)" : "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-bold">Transfer Funds</div>
            <label className="text-[10px] text-[var(--muted)]">From</label>
            <select value={xfer?.fromId || ""} onChange={(e) => setXfer({ ...(xfer || {}), fromId: e.target.value })} className="mb-2 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]">
              {(accts || []).map((a: any) => <option key={a.id} value={a.id}>{a.login} ({a.type})</option>)}
            </select>
            <label className="text-[10px] text-[var(--muted)]">To</label>
            <select value={xfer?.toId || ""} onChange={(e) => setXfer({ ...(xfer || {}), toId: e.target.value })} className="mb-2 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]">
              <option value="">Select account</option>
              {(accts || []).filter((a: any) => a.id !== xfer?.fromId).map((a: any) => <option key={a.id} value={a.id}>{a.login} ({a.type})</option>)}
            </select>
            {(() => { const xf = (accts || []).find((a: any) => a.id === (xfer?.fromId || accId)); const av = xf ? (pnlOnly ? Math.max(0, Number(xf.pnl || 0)) : acctBal(xf)) : 0; return (
              <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-[var(--muted)]">Available {pnlOnly ? "(profit only)" : "balance"}</span><button type="button" onClick={() => setXfer({ ...(xfer || {}), amount: String(av.toFixed(2)) })} className="font-semibold" style={{ color: "#22d3ee" }}>{_cSym}{fmt(av)} · Use max</button></div>
            ); })()}
            <label className="text-[10px] text-[var(--muted)]">Amount</label>
            <input type="number" inputMode="decimal" value={xfer?.amount || ""} onChange={(e) => setXfer({ ...(xfer || {}), amount: e.target.value })} placeholder="0.00" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
            {xferErr && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{xferErr}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setXferModal(false)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[12px]">Cancel</button>
              <button onClick={doTransfer} className="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BLUE }}>Transfer</button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA setup / disable modal */}
      {totpModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => { setTotpModal(null); setTotpErr(""); setTotpCode(""); }}>
          <div className="w-full max-w-sm rounded-2xl p-5 shadow-2xl" style={{ background: "var(--panel)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            {totpModal === "setup" ? (<>
              <div className="mb-3 text-base font-bold">Set up Two-Factor Authentication</div>
              <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>Scan this QR code with Google Authenticator, Authy, or any TOTP app. Then enter the 6-digit code to confirm.</p>
              {totpQr && <img src={totpQr} alt="QR code" className="mx-auto mb-2 rounded-lg" style={{ width: 160, height: 160 }} />}
              <div className="mb-3 rounded-lg px-3 py-2 text-center text-[10px] font-mono break-all" style={{ background: "var(--soft)", color: "var(--muted)" }}>{totpSecret}</div>
              {totpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{totpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter 6-digit code" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setTotpModal(null); setTotpCode(""); setTotpErr(""); }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: "var(--soft)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={confirmTotpEnable} disabled={totpBusy || totpCode.length < 6}
                  className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${BUY}, #15803d)` }}>
                  {totpBusy ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Enable 2FA"}
                </button>
              </div>
            </>) : (<>
              <div className="mb-2 text-base font-bold">Disable Two-Factor Authentication</div>
              <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>Enter the 6-digit code from your authenticator app to confirm.</p>
              {totpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{totpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter 6-digit code" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setTotpModal(null); setTotpCode(""); setTotpErr(""); }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: "var(--soft)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={confirmTotpDisable} disabled={totpBusy || totpCode.length < 6}
                  className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${SELL}, #b91c1c)` }}>
                  {totpBusy ? <i className="fa-solid fa-circle-notch fa-spin" /> : "Disable 2FA"}
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* PIN change modal */}
      {/* WALLET (Deposit / Withdraw / KYC) — opens IN-APP, not a separate page */}
      {walletTab && (
        <div className="fixed inset-0 z-[125] flex items-start justify-center overflow-auto p-3" style={{ background: "rgba(0,0,0,0.55)", paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div className="w-full max-w-md rounded-2xl bg-[var(--panel)] text-[var(--text)] p-4 shadow-2xl" style={{ ["--foreground" as any]: "var(--text)", "--card": "var(--soft)", "--card-foreground": "var(--text)", "--background": "var(--bg)", "--secondary": "var(--soft)", "--secondary-foreground": "var(--text)", "--muted-foreground": "var(--muted)" } as any} onClick={(e) => e.stopPropagation()}>
            <WalletPanel key={walletTab} accountId={accId} initialTab={walletTab} tabs={walletTab === "kyc" ? ["kyc"] : ["deposit", "withdraw"]} onClose={() => setWalletTab(null)} />
          </div>
        </div>
      )}

      {/* SYMBOL SEARCH PICKER (chart) */}
      {symPickerOpen && (
        <div className="fixed inset-0 z-[115] flex flex-col" style={{ background: "var(--bg)", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input autoFocus value={symSearch} onChange={(e) => setSymSearch(e.target.value)} placeholder="Search symbols" className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm text-[var(--text)]" />
            </div>
            <button onClick={() => setSymPickerOpen(false)} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)]"><i className="fa-solid fa-xmark text-lg" /></button>
          </div>
          <div className="flex-1 overflow-auto">
            {(symbols || []).filter((x: any) => { const q = symSearch.trim().toLowerCase(); if (!q) return true; return `${x.display || x.symbol}`.toLowerCase().includes(q) || `${x.symbol}`.toLowerCase().includes(q); }).map((x: any) => {
              const pr = prices[x.symbol];
              return (
                <button key={x.symbol} onClick={() => { setSelSym(x.symbol); setSymPickerOpen(false); }} className="flex w-full items-center justify-between border-b border-[var(--border)] px-4 py-3 text-left active:bg-[var(--soft)]" style={x.symbol === selSym ? { background: "var(--soft)" } : undefined}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{x.display || x.symbol}</div>
                    <div className="text-[10px] uppercase text-[var(--muted)]">{x.category || "other"}</div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-2">
                    <span className="text-[12px] font-semibold tabular-nums text-[var(--muted)]">{pr != null ? gnum(pr, dg(x.symbol)) : "…"}</span>
                    {x.symbol === selSym && <i className="fa-solid fa-check" style={{ color: BUY }} />}
                  </div>
                </button>
              );
            })}
            <div className="h-16" />
          </div>
        </div>
      )}

      {/* Statement range picker */}
      {stmtOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setStmtOpen(false)}>
          <div className="w-full max-w-[400px] rounded-t-[22px] border p-4 sm:rounded-[22px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Statement Period</div>
              <button onClick={() => setStmtOpen(false)} aria-label="Close" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {([["week", "This Week"], ["month", "This Month"], ["year", "This Year"], ["all", "All Time"], ["custom", "Custom"]] as [string, string][]).map(([k, lbl]) => (
                <button key={k} onClick={() => setStmtPreset(k)} className="rounded-lg py-2 text-[11px] font-medium transition-colors" style={stmtPreset === k ? { background: BLUE, color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{lbl}</button>
              ))}
            </div>
            {stmtPreset === "custom" && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div><div className="text-[10px] text-[var(--muted)]">From</div><input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" /></div>
                <div><div className="text-[10px] text-[var(--muted)]">To</div><input type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" /></div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={stmtDownload} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white" style={{ background: SELL }}><i className="fa-solid fa-file-pdf" /> Download</button>
              <button disabled={stmtSending} onClick={stmtEmail} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: BLUE }}><i className="fa-solid fa-envelope" /> {stmtSending ? "Sending…" : "Email"}</button>
            </div>
          </div>
        </div>
      )}

      {pin?.pinModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="glass glass-edge w-full max-w-[320px] rounded-[22px] border p-4" style={{ background: theme === "dark" ? "rgba(28,30,38,0.85)" : "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{pin.pinHasPin ? "Change PIN" : "Set PIN"}</div>
              <button onClick={() => pin.setPinModal(false)} aria-label="Close" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            {pin.pinHasPin && (<><div className="text-[10px] text-[var(--muted)]">Current PIN</div><input type="password" inputMode="numeric" value={pin.pinForm.current || ""} onChange={(e) => pin.setPinForm({ ...pin.pinForm, current: e.target.value })} className="mb-2 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center text-[var(--text)]" /></>)}
            <div className="text-[10px] text-[var(--muted)]">New PIN (4-6 digits)</div>
            <input type="password" inputMode="numeric" value={pin.pinForm.pin || ""} onChange={(e) => pin.setPinForm({ ...pin.pinForm, pin: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center text-[var(--text)]" />
            {pin.pinErr && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{pin.pinErr}</div>}
            <button onClick={pin.savePin} className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white" style={{ background: BUY }}>Save PIN</button>
          </div>
        </div>
      )}

      {profileModal && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center p-0" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full rounded-t-3xl border-t p-5 pb-8" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            <div className="mb-1 text-base font-bold">Complete Your Profile</div>
            <p className="mb-4 text-[11px] text-[var(--muted)]">Required for withdrawals and KYC. This information cannot be changed after submission.</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Full Name <span style={{ color: SELL }}>*</span></label>
                <input value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[14px] text-[var(--text)] outline-none" placeholder="As it appears on your ID" />
                <p className="mt-1 text-[10px] text-[var(--muted)]">Must match your government-issued ID exactly.</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Phone Number <span style={{ color: SELL }}>*</span></label>
                <input value={profileForm.phone} onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[14px] text-[var(--text)] outline-none" placeholder="+1 234 567 8900" type="tel" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Country <span style={{ color: SELL }}>*</span></label>
                <select value={profileForm.country} onChange={(e) => setProfileForm((f) => ({ ...f, country: e.target.value }))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[14px] text-[var(--text)] outline-none">
                  <option value="">Select country…</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              {profileErr && <div className="text-[12px]" style={{ color: SELL }}>{profileErr}</div>}
              <button onClick={saveProfile} disabled={profileSaving} className="w-full rounded-2xl py-3 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: BUY }}>
                {profileSaving ? "Saving…" : "Submit & Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PARTIAL CLOSE MODAL */}
      {mobPartial && (() => {
        const closeL = Number(mobPartialLots);
        const remainL = mobPartialLots ? parseFloat((mobPartial.lots - closeL).toFixed(2)) : 0;
        const partialErr = mobPartialLots
          ? closeL <= 0 ? "Enter a valid lot amount"
          : closeL >= mobPartial.lots ? `Must be less than ${mobPartial.lots} lots`
          : remainL < 0.01 ? `Remaining lots (${remainL}) would be below minimum 0.01`
          : null
          : null;
        return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setMobPartial(null)}>
          <div className="glass-card w-full max-w-[320px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[14px] font-bold">Partial Close — {mobPartial.sym}</div>
            <div className="mb-3 text-[10px] text-[var(--muted)]">Position size: <span className="font-semibold text-[var(--text)]">{mobPartial.lots} lots</span> · Enter how many lots to close</div>
            <input type="number" inputMode="decimal" step="0.01" min="0.01" max={mobPartial.lots - 0.01} value={mobPartialLots} onChange={(e) => setMobPartialLots(e.target.value)} placeholder="e.g. 0.50" className="h-11 w-full rounded-xl border bg-[var(--bg)] px-3 text-center text-[15px] font-semibold tabular-nums text-[var(--text)] outline-none" style={{ borderColor: partialErr ? SELL : "var(--border)" }} autoFocus />
            {mobPartialLots && !partialErr && (
              <div className="mt-1.5 text-center text-[10px]" style={{ color: "var(--muted)" }}>
                Closing <span className="font-semibold" style={{ color: SELL }}>{closeL} lots</span> · Remaining <span className="font-semibold" style={{ color: BUY }}>{remainL} lots</span>
              </div>
            )}
            {partialErr && <div className="mt-1.5 text-center text-[10px] font-semibold" style={{ color: SELL }}>{partialErr}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMobPartial(null)} className="flex-1 rounded-xl border border-[var(--border)] py-2.5 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Cancel</button>
              <button disabled={!!partialErr || !mobPartialLots} onClick={async () => {
                const r = await fetch(`/api/client/orders/${mobPartial.id}/close`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ lots: closeL, accountId: accId }) }).then((x) => x.json()).catch(() => ({ok:false}));
                if (r.ok) { setMobPartial(null); (t as any).load?.(); }
              }} className="flex-1 rounded-xl py-2.5 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: SELL }}>Close {mobPartialLots ? closeL + " lots" : "—"}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* PRICE ALERTS MODAL */}
      {mobAlertOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setMobAlertOpen(false)}>
          <div className="glass w-full rounded-t-[26px] p-5" style={{ background: "var(--panel)", maxHeight: "80dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[14px] font-bold">Price Alerts</div>
              <button onClick={() => setMobAlertOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark text-[11px]" /></button>
            </div>
            {/* New alert form */}
            <div className="mb-3 space-y-2 rounded-xl border border-[var(--border)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>New Alert</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[9px] text-[var(--muted)]">Symbol</div>
                  <select value={mobAlertForm.symbol} onChange={(e) => setMobAlertForm((f) => ({...f, symbol: e.target.value}))} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text)]">
                    {(symbols || []).map((s: any) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-[9px] text-[var(--muted)]">Condition</div>
                  <select value={mobAlertForm.condition} onChange={(e) => setMobAlertForm((f) => ({...f, condition: e.target.value}))} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text)]">
                    <option value="ABOVE">Price Above</option>
                    <option value="BELOW">Price Below</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[9px] text-[var(--muted)]">Target Price</div>
                <input type="number" inputMode="decimal" value={mobAlertForm.price} onChange={(e) => setMobAlertForm((f) => ({...f, price: e.target.value}))} placeholder="0.00000" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <div className="mb-1 text-[9px] text-[var(--muted)]">Note (optional)</div>
                <input type="text" value={mobAlertForm.note} onChange={(e) => setMobAlertForm((f) => ({...f, note: e.target.value}))} placeholder="" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
              </div>
              {mobAlertErr && <div className="text-[10px]" style={{ color: SELL }}>{mobAlertErr}</div>}
              <button onClick={async () => {
                if (!mobAlertForm.symbol || !mobAlertForm.price) { setMobAlertErr("Symbol and price are required"); return; }
                const r = await fetch("/api/client/alerts", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ...mobAlertForm, price: Number(mobAlertForm.price), accountId: accId }) }).then((x) => x.json()).catch(() => ({ok:false}));
                if (r.ok) { loadMobAlerts(); setMobAlertForm({ symbol: mobAlertForm.symbol, condition: "ABOVE", price: "", note: "" }); setMobAlertErr(""); } else setMobAlertErr(r.error || "Failed");
              }} className="w-full rounded-xl py-2 text-[12px] font-semibold text-white" style={{ background: "var(--accent)" }}>Set Alert</button>
            </div>
            {/* Active alerts list */}
            {mobAlerts.length === 0 ? <div className="py-4 text-center text-[11px] text-[var(--muted)]">No active alerts.</div> : mobAlerts.map((al) => (
              <div key={al.id} className="mb-2 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2" style={{ opacity: al.triggered ? 0.6 : 1 }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold">{al.symbol} <span style={{ color: "var(--accent)" }}>{al.condition === "ABOVE" ? "↑" : "↓"}</span> {al.price}</span>
                    {al.triggered && <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>FIRED</span>}
                  </div>
                  {al.note && <div className="text-[10px] text-[var(--muted)]">{al.note}</div>}
                </div>
                <div className="flex items-center gap-1 ml-2">
                  {al.triggered && <button onClick={async () => { await fetch(`/api/client/alerts?id=${al.id}`, { method: "PATCH" }); loadMobAlerts(); }} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "rgba(47,129,247,0.15)", color: "#2f81f7" }} title="Re-arm alert"><i className="fa-solid fa-rotate-right text-[10px]" /></button>}
                  <button onClick={async () => { await fetch(`/api/client/alerts?id=${al.id}`, { method: "DELETE" }); loadMobAlerts(); }} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "rgba(224,82,96,0.15)", color: SELL }}><i className="fa-solid fa-xmark text-[10px]" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PIN lock overlay */}
      {pin?.pinLock && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6" style={{ background: "rgba(5,9,16,0.96)" }}>
          <div className="w-full max-w-[320px] rounded-2xl border p-5 text-center" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            <div className="mb-1 text-sm font-semibold">Enter your PIN</div>
            <div className="mb-3 text-[10px] text-[var(--muted)]">This terminal is locked.</div>
            <input type="password" inputMode="numeric" autoFocus value={pin.pinInput} onChange={(e) => pin.setPinInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") pin.unlock(); }} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center text-lg tracking-widest text-[var(--text)]" />
            {pin.pinErr && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{pin.pinErr}</div>}
            <button onClick={pin.unlock} className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white" style={{ background: BUY }}>Unlock</button>
            <button onClick={pin.unlockPasskey} className="mt-2 w-full rounded-lg border border-[var(--border)] py-2 text-xs">Unlock with passkey</button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
