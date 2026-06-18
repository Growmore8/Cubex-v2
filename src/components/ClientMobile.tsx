"use client";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import dynamic from "next/dynamic";
import WalletPanel from "@/components/WalletPanel";
import WorldMapBg from "@/components/ui/WorldMapBg";
import { titleCaseName, gnum } from "@/lib/format";
import { iconForNotification } from "@/lib/notif";

// Lazy-load the chart lib — it's ~350 kB and only needed on the Chart tab.
// Loads on first tab open; subsequent visits are instant (module cached).
const KLineProChart = dynamic(() => import("@/components/KLineProChart"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-[var(--muted)] text-xs">Loading chart…</div> });

const INDS: [string, string][] = [["RSI", "RSI@tv-basicstudies"], ["MACD", "MACD@tv-basicstudies"], ["Stoch", "Stochastic@tv-basicstudies"], ["BBands", "BB@tv-basicstudies"], ["MA", "MASimple@tv-basicstudies"], ["ROC", "ROC@tv-basicstudies"]];

const DARK: any = { "--bg": "#0b0e14", "--panel": "#131722", "--card": "#1a1f2b", "--border": "#242a38", "--text": "#e8eaed", "--muted": "#8a93a6", "--soft": "#1e2433" };
const LIGHT: any = { "--bg": "#f1f5f9", "--panel": "#ffffff", "--card": "#ffffff", "--border": "#e2e8f0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f7" };
const BUY = "#16a34a", SELL = "#dc2626", GOLD = "#e3a855", BLUE = "#2563eb";
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
          type="text"
          inputMode="decimal"
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
  const {
    theme, brand, account, accts, accId, pnlOnly, needKyc, positions, pending, history, financials, notis, symbols, prices, dirs,
    selSym, vol, sl, tp, err,
    balance, equity, floating, free, used, level, price, bid, ask, tf, TFS,
    setSelSym, setVol, setSl, setTp, setTf,
    place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr,
    toggleTheme, enablePush, disablePush, addPasskey, openPin, favs, toggleFav, avatarUrl, uploadAvatar,
    fmt, csz, pnlOf, dg, markAllNotifsRead, logout, pin,
    acctReqModal, setAcctReqModal,
  } = t;

  const [tab, setTab] = useState<"dashboard" | "quotes" | "chart" | "trades" | "history" | "profile">("dashboard");
  const [mInd, setMInd] = useState<string[]>([]);
  const [histTab, setHistTab] = useState<"trades" | "financial">("trades");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [qcat, setQcat] = useState<string>("Crypto"); // quotes open on Crypto by default
  const [symPickerOpen, setSymPickerOpen] = useState(false);
  const [symSearch, setSymSearch] = useState("");
  const [walletTab, setWalletTab] = useState<null | "deposit" | "withdraw" | "kyc">(null);
  const [modifyId, setModifyId] = useState<string | null>(null);
  const [mSl, setMSl] = useState("");
  const [mTp, setMTp] = useState("");
  const [notisOpen, setNotisOpen] = useState(false);
  const [reqsOpen, setReqsOpen] = useState(false);
  const [cfgSheet, setCfgSheet] = useState(false);
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
  useEffect(() => { if (tab === "profile" && !myReqsLoaded) loadMyReqs(); }, [tab, myReqsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <div className="text-[12px] font-semibold">{isAcc ? <>New {req.type === "DEMO" ? "Demo" : "Live"} Account <span className="font-normal text-[var(--muted)]">{req.currency}</span></> : <>{req.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"} <span className="font-bold">${gnum(req.amount, 2)}</span></>}</div>
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
  const [chartFull, setChartFull] = useState(false);

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
    if (search && !(`${s.display || s.symbol}`.toLowerCase().includes(search.toLowerCase()))) return false;
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
    ? [["profile", "fa-user", "Profile"]]
    : [
        ["dashboard", "fa-house", "Dashboard"], ["quotes", "fa-chart-simple", "Quotes"], ["chart", "fa-chart-line", "Chart"],
        ["trades", "fa-right-left", "Trades"], ["history", "fa-clock-rotate-left", "History"], ["profile", "fa-user", "Profile"],
      ];
  useEffect(() => { if (needKyc) setTab("profile"); }, [needKyc]);
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
      await fetch("/api/client/orders/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sl: mSl, tp: mTp }) });
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
    <div style={{ ...(theme === "dark" ? DARK : LIGHT), fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", position: "fixed", top: 0, bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 540, zIndex: 1, paddingTop: "env(safe-area-inset-top)", touchAction: "manipulation", boxShadow: "0 0 60px rgba(0,0,0,0.45)",
      // Frosted-glass design: faint brand-tinted glows behind the content so the
      // .glass-card surfaces have colour to blur (design "A").
      background: `radial-gradient(620px 380px at -5% -2%, color-mix(in srgb, ${brand?.primaryColor || "#7c3aed"} 34%, transparent), transparent 60%), radial-gradient(620px 380px at 105% 8%, color-mix(in srgb, ${brand?.accentColor || "#2563eb"} 30%, transparent), transparent 58%), radial-gradient(520px 320px at 50% 112%, rgba(16,199,132,0.13), transparent 60%), var(--bg)` }} className="flex flex-col overflow-hidden text-[var(--text)]">
      <input type="file" accept="image/*" style={{ display: "none" }} ref={avatarRef} onChange={uploadAvatar} />

      {/* TOP HEADER — iOS glass */}
      <div className="glass sticky top-0 z-20 flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: "var(--border)", background: theme === "dark" ? "rgba(20,24,34,0.6)" : "rgba(255,255,255,0.6)" }}>
        <div className="flex items-center gap-2.5">
          <Avatar size={38} />
          <div className="leading-tight">
            <div className="text-sm font-bold uppercase">{titleCaseName(account?.ownerName || account?.name) || "Trader"}</div>
            <div className="text-[10px] text-[var(--muted)]">{account?.type === "LIVE" ? "Live" : "Demo"} #{account?.login} · 1:{account?.leverage}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: "var(--soft)", color: GOLD }}>{brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="h-3.5 w-3.5 rounded object-contain" /> : <i className="fa-solid fa-cube" />} {brand?.name || ""}</span>
          <button onClick={() => { setNotisOpen((o) => !o); if (!notisOpen && unread > 0) fetch("/api/client/notifications", { method: "POST" }).then(() => {}).catch(() => {}); }} className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[var(--soft)]">
            <i className="fa-solid fa-bell" style={{ color: unread > 0 ? GOLD : "var(--muted)" }} />
            {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white" style={{ background: SELL }}>{unread > 9 ? "9+" : unread}</span>}
          </button>
        </div>
      </div>

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
      <div className="min-h-0 flex-1 overflow-auto">

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
                  <div className="mt-1 text-[32px] font-extrabold leading-none tracking-tight text-white" style={{ textShadow: "0 2px 14px rgba(0,0,0,0.5)" }}>${fmt(balance)}</div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-white/75">
                    <span className="font-mono tracking-[0.2em]">{account?.login}</span>
                    <span className="text-white/40">·</span>
                    <span className="uppercase tracking-wide">{titleCaseName(account?.ownerName || account?.name)}</span>
                  </div>
                </div>
                <div className="relative my-3 h-px" style={{ background: "rgba(255,255,255,0.18)" }} />
                <div className="relative grid grid-cols-3 gap-2 text-white">
                  <div><div className="text-[8px] tracking-[0.12em] text-white/50">EQUITY</div><div className="text-[13px] font-bold tabular-nums">${fmt(equity)}</div></div>
                  <div><div className="text-[8px] tracking-[0.12em] text-white/50">FREE</div><div className="text-[13px] font-bold tabular-nums">${fmt(free)}</div></div>
                  <div><div className="text-[8px] tracking-[0.12em] text-white/50">FLT P/L</div><div className="text-[13px] font-bold tabular-nums" style={{ color: floating >= 0 ? "#5ef2b3" : "#ff9a9a" }}>{floating >= 0 ? "+" : ""}{fmt(floating)}</div></div>
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
                  <button key={b.label} onClick={b.on} className="gbtn flex flex-col items-center gap-2 rounded-2xl py-3.5 font-semibold" style={{ color: "var(--text)", background: cardDark ? "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))" : "linear-gradient(160deg, #ffffff, #eef1f6)", border: "1px solid var(--border)", boxShadow: cardDark ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "0 1px 2px rgba(0,0,0,0.05)" }}>
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
                    <button key={amt} onClick={() => doTopUp(amt)} className="gbtn flex flex-col items-center gap-2 rounded-2xl py-3.5 font-semibold" style={{ color: "var(--text)", background: cardDark ? "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))" : "linear-gradient(160deg, #ffffff, #eef1f6)", border: "1px solid var(--border)" }}>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "linear-gradient(145deg,#fde7b8,#e0b94e 45%,#b8860b 72%,#fbe9b0)", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -2px 3px rgba(0,0,0,0.25), 0 2px 5px rgba(0,0,0,0.28)" }}><i className="fa-solid fa-coins" style={{ color: "#7a5b07", fontSize: 15 }} /></span>
                      <span className="text-[12px]">${amt.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* market movers */}
            <div className="glass-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide"><i className="fa-solid fa-arrow-trend-up mr-1.5" style={{ color: BUY }} />MARKET MOVERS</div>
                <span className="text-[9px] text-[var(--muted)]">LIVE</span>
              </div>
              {!movers.any ? <div className="py-4 text-center text-[11px] text-[var(--muted)]">Waiting for live prices…</div> : (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[9px] font-semibold text-[var(--muted)]">TOP GAINERS</div>
                    {movers.gainers.map((s: any) => {
                      const p = s.pct;
                      return (
                        <button key={"g" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 transition-colors active:bg-[var(--soft)]">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] text-white" style={{ background: BUY }}><i className="fa-solid fa-arrow-up" /></span>
                          <div className="w-24 shrink-0 text-left"><div className="truncate text-[12px] font-semibold">{s.display || s.symbol}</div><div className="text-[10px] tabular-nums text-[var(--muted)]">{s.price != null ? gnum(s.price, dg(s.symbol)) : "…"}</div></div>
                          <div className="flex flex-1 justify-center"><Sparkline data={sparkRef.current[s.symbol]} up={true} /></div>
                          <span className="w-[52px] shrink-0 text-right text-[12px] font-semibold tabular-nums" style={{ color: BUY }}>{(p >= 0 ? "+" : "") + p.toFixed(2)}%</span>
                        </button>
                      );
                    })}
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] font-semibold text-[var(--muted)]">TOP LOSERS</div>
                    {movers.losers.map((s: any) => {
                      const p = s.pct;
                      return (
                        <button key={"l" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 transition-colors active:bg-[var(--soft)]">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] text-white" style={{ background: SELL }}><i className="fa-solid fa-arrow-down" /></span>
                          <div className="w-24 shrink-0 text-left"><div className="truncate text-[12px] font-semibold">{s.display || s.symbol}</div><div className="text-[10px] tabular-nums text-[var(--muted)]">{s.price != null ? gnum(s.price, dg(s.symbol)) : "…"}</div></div>
                          <div className="flex flex-1 justify-center"><Sparkline data={sparkRef.current[s.symbol]} up={false} /></div>
                          <span className="w-[52px] shrink-0 text-right text-[12px] font-semibold tabular-nums" style={{ color: SELL }}>{p.toFixed(2)}%</span>
                        </button>
                      );
                    })}
                  </div>
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
                const sBid = p != null ? p * 0.9999 : null; const sAsk = p;
                const spread = p != null ? Math.max(1, Math.round((p - sBid!) / Math.pow(10, -dd))) : 0;
                const dr = dirs?.[s.symbol] || 0;
                const hist = sparkRef.current[s.symbol];
                const upTrend = hist && hist.length >= 2 ? hist[hist.length - 1] >= hist[0] : dr >= 0;
                return (
                  <div key={s.symbol} className="rounded-xl border bg-[var(--card)] p-3" style={{ borderColor: dr > 0 ? BUY : dr < 0 ? SELL : "var(--border)", transition: "border-color 0.4s ease" }}>
                    {/* Double-tap the info row to open this symbol's chart */}
                    <div className="mb-2 flex select-none items-center justify-between" onDoubleClick={() => { setSelSym(s.symbol); setTab("chart"); }}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleFav(s.symbol)} style={{ color: isFav ? GOLD : "var(--muted)" }}><i className={isFav ? "fa-solid fa-star" : "fa-regular fa-star"} /></button>
                        <button onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="text-sm font-bold underline-offset-2 active:underline">{s.display || s.symbol}</button>
                        {dr !== 0 && <i className={"fa-solid " + (dr > 0 ? "fa-caret-up" : "fa-caret-down")} style={{ fontSize: 11, color: dr > 0 ? BUY : SELL }} />}
                      </div>
                      <div className="flex items-center gap-2">
                        <Sparkline data={hist} up={upTrend} />
                        <span className="text-[10px] text-[var(--muted)]">Sprd {spread}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 items-center gap-2">
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "SELL"); }} className="rounded-lg py-2 text-center text-white" style={{ background: SELL }}>
                        <div className="text-[10px] opacity-80">SELL</div><div className="text-sm font-bold tabular-nums">{sBid != null ? gnum(sBid, dd) : "…"}</div>
                      </button>
                      <LotStepper vol={vol} setVol={setVol} small />
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "BUY"); }} className="rounded-lg py-2 text-center text-white" style={{ background: BUY }}>
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
          <div className="flex h-full flex-col">
            {/* Chart header — big price block (symbol + name · large price + change) */}
            {(() => {
              const disp = (symbols || []).find((x: any) => x.symbol === selSym)?.display;
              const base = baselineRef.current[selSym]; const chg = (base != null && price != null) ? price - base : 0; const pct = pctOf(selSym); const upC = chg >= 0;
              return (
                <div className="border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button onPointerDown={(e) => { e.preventDefault(); setSymSearch(""); setSymPickerOpen(true); }} className="flex items-center gap-1.5 text-left" style={{ touchAction: "manipulation" }}>
                      <div>
                        <div className="flex items-center gap-1.5 text-[16px] font-extrabold leading-none text-[var(--text)]">{selSym || "Symbol"}<i className="fa-solid fa-chevron-down text-[9px] opacity-50" /></div>
                        {disp && disp !== selSym && <div className="mt-0.5 text-[10px] text-[var(--muted)]">{disp}</div>}
                      </div>
                    </button>
                    <div className="text-right">
                      <div className="text-[28px] font-extrabold leading-none tabular-nums" style={{ color: upC ? BUY : SELL }}>{price != null ? gnum(price, dg(selSym)) : "…"}</div>
                      <div className="mt-1 text-[12px] font-semibold tabular-nums" style={{ color: upC ? BUY : SELL }}>{upC ? "▲" : "▼"} {chg >= 0 ? "+" : ""}{gnum(chg, dg(selSym))} ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {(TFS || []).map((x: string) => (
                      <button key={x} onClick={() => setTf(x)} className="rounded-md px-2 py-1 text-[10px] font-semibold transition-colors" style={tf === x ? { background: "#2f81f7", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{x}</button>
                    ))}
                    <button onPointerDown={(e) => { e.preventDefault(); setChartFull(true); }} className="ml-auto flex h-7 w-7 items-center justify-center rounded border border-[var(--border)]" style={{ background: "var(--soft)", color: "var(--muted)", touchAction: "manipulation" }}>
                      <i className="fa-solid fa-expand text-[11px]" />
                    </button>
                  </div>
                </div>
              );
            })()}
            {/* Indicator settings bottom sheet (periods) — opened from full-screen */}
            {cfgSheet && (
              <>
                <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setCfgSheet(false)} />
                <div className="fixed inset-x-0 bottom-0 z-[90] rounded-t-3xl p-4" style={{ background: "var(--panel)", paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)" }}>
                  <div className="mb-3 flex items-center justify-between"><div className="text-sm font-bold text-[var(--text)]">Indicator Settings</div><button onClick={() => setCfgSheet(false)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark" /></button></div>
                  {([["ma", "MA period"], ["rsi", "RSI period"], ["bb", "Bollinger period"], ["macdF", "MACD fast"], ["macdS", "MACD slow"], ["macdSig", "MACD signal"]] as const).map(([k, lbl]) => (
                    <div key={k} className="mb-2.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-[var(--muted)]">{lbl}</span>
                      <input type="number" min={1} value={t.chartCfg?.[k] ?? ""} onChange={(e) => t.setChartCfg && t.setChartCfg((c: any) => ({ ...c, [k]: Math.max(1, Number(e.target.value) || 1) }))} className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-right text-[15px] text-[var(--text)]" />
                    </div>
                  ))}
                  <button onClick={() => t.setChartCfg && t.setChartCfg({ ma: 20, rsi: 14, bb: 20, macdF: 12, macdS: 26, macdSig: 9 })} className="mt-1 w-full rounded-xl border border-[var(--border)] py-2.5 text-[12px] text-[var(--muted)]">Reset to defaults</button>
                </div>
              </>
            )}
            {/* Preview chart — bare KLine (no toolbar/rail); full features in full-screen */}
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg)]">
              <KLineProChart symbol={selSym} tf={tf} theme={theme} digits={dg(selSym)} symbols={symbols} bare
                positions={[
                  ...(positions || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                  ...(t.pending || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                ]} />
            </div>
            <div className="glass flex items-stretch gap-2 border-t border-[var(--border)] p-2.5" style={{ background: theme === "dark" ? "rgba(20,24,34,0.6)" : "rgba(255,255,255,0.6)" }}>
              <button onPointerDown={(e) => { e.preventDefault(); quickTrade(selSym, "SELL", vol); }} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white disabled:opacity-50" style={{ background: SELL, touchAction: "manipulation" }}>
                <div className="text-[10px] opacity-80">SELL</div><div className="text-base font-bold tabular-nums">{price != null ? gnum(bid, dg(selSym)) : "…"}</div>
              </button>
              <div className="flex items-center"><LotStepper vol={vol} setVol={setVol} /></div>
              <button onPointerDown={(e) => { e.preventDefault(); quickTrade(selSym, "BUY", vol); }} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white disabled:opacity-50" style={{ background: BUY, touchAction: "manipulation" }}>
                <div className="text-[10px] opacity-80">BUY</div><div className="text-base font-bold tabular-nums">{price != null ? gnum(ask, dg(selSym)) : "…"}</div>
              </button>
            </div>
            {err && <div className="bg-[var(--panel)] pb-1 text-center text-[11px]" style={{ color: SELL }}>{err}</div>}
          </div>
        )}</KeepAlive>

        {/* ───────── FULL-SCREEN CHART OVERLAY ───────── */}
        {chartFull && (
          <div className="fixed inset-0 z-[85] flex flex-col" style={{ background: "var(--bg)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
            <div className="flex items-center gap-2 border-b px-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)", paddingBottom: 10, borderColor: "var(--border)", background: "var(--panel)" }}>
              <span className="font-bold text-sm">{selSym}</span>
              <button onClick={() => setChartFull(false)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)]" style={{ background: "var(--soft)", color: "var(--muted)", touchAction: "manipulation" }}>
                <i className="fa-solid fa-compress text-[12px]" />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
              <KLineProChart symbol={selSym} tf={tf} theme={theme} digits={dg(selSym)} symbols={symbols} onSymbolChange={(sm: string) => setSelSym(sm)}
                positions={[
                  ...(positions || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                  ...(t.pending || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                ]} />
            </div>
          </div>
        )}

        {/* ───────── TRADES ───────── */}
        {tab === "trades" && (
          <div className="space-y-3 p-3">
            <button onClick={() => { setNoForm({ idx: 0, lots: vol || 0.01, trigger: "", sl: "", tp: "" }); setNoOpen(true); }} className="w-full rounded-xl py-3 text-sm font-semibold text-white" style={{ background: BLUE }}><i className="fa-solid fa-plus mr-1.5" /> New Order / Pending</button>

            <div className="text-[11px] font-semibold text-[var(--muted)]">Open Positions {(positions || []).length ? "(" + positions.length + ")" : ""}</div>
            {(positions || []).length === 0 ? <div className="py-4 text-center text-[12px] text-[var(--muted)]">No open positions.</div> : (positions || []).map((p: any) => {
              const cur = prices[p.symbol] ?? p.openPrice; const plv = pnlOf(p, cur, csz(p.symbol)); const dd = dg(p.symbol);
              const open = expanded === p.id;
              return (
                <div key={p.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]" style={{ borderLeft: `4px solid ${p.type === "BUY" ? BLUE : SELL}` }}>
                  {/* Tap the row to open/close trade details (no separate arrow) */}
                  <div onClick={() => setExpanded(open ? null : p.id)} className="flex cursor-pointer select-none items-center justify-between p-3 active:bg-[var(--soft)]">
                    <div>
                      <div className="text-sm font-bold">{p.symbol} <span className="text-[12px] font-semibold" style={{ color: p.type === "BUY" ? BLUE : SELL }}>{p.type} {p.lots}</span></div>
                      <div className="text-[10px] text-[var(--muted)]">{gnum(Number(p.openPrice), dd)} → {gnum(cur, dd)}</div>
                      {(p.sl > 0 || p.tp > 0) && (
                        <div className="mt-0.5 flex gap-2 text-[9px] font-semibold tabular-nums">
                          {p.sl > 0 && <span style={{ color: "#f43f5e" }}>SL {gnum(Number(p.sl), dd)}</span>}
                          {p.tp > 0 && <span style={{ color: "#10b981" }}>TP {gnum(Number(p.tp), dd)}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-sm font-bold" style={{ color: plv >= 0 ? BUY : SELL }}>{(plv >= 0 ? "+" : "") + fmt(plv)}</div>
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
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => { setModifyId(p.id); setMSl(p.sl ? String(p.sl) : ""); setMTp(p.tp ? String(p.tp) : ""); }} className="rounded-lg border border-[var(--border)] bg-[var(--soft)] py-2 text-[12px] font-semibold"><i className="fa-solid fa-pen mr-1.5" />Modify TP/SL</button>
                        <button onClick={() => close(p.id)} className="rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: SELL }}><i className="fa-solid fa-xmark mr-1.5" />Close</button>
                      </div>
                      {modifyId === p.id && (
                        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3">
                          <div className="mb-2 text-[11px] font-semibold">Modify SL / TP</div>
                          <div className="grid grid-cols-2 gap-2">
                            <input value={mSl} onChange={(e) => setMSl(e.target.value)} placeholder="Stop loss" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
                            <input value={mTp} onChange={(e) => setMTp(e.target.value)} placeholder="Take profit" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => setModifyId(null)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[12px]">Cancel</button>
                            <button onClick={() => saveModify(p.id)} className="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BLUE }}>Save</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {(pending || []).length > 0 && (<>
            <div className="mt-3 text-[11px] font-semibold" style={{ color: BLUE }}><i className="fa-regular fa-clock mr-1" />Pending Orders ({pending.length})</div>
            {(pending || []).map((o: any) => {
              const dd = dg(o.symbol); const trig = Number(o.price); const cur = prices[o.symbol]; const dist = cur != null ? Math.abs(trig - cur) : null;
              const c = o.side === "BUY" ? BLUE : SELL; const label = (o.side === "BUY" ? "Buy" : "Sell") + " " + (o.kind === "LIMIT" ? "Limit" : "Stop");
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
                    <div><div className="text-[var(--muted)]">TRIGGER</div><div className="font-semibold">{gnum(trig, dd)}</div></div>
                    <div><div className="text-[var(--muted)]">CURRENT</div><div className="font-semibold">{cur != null ? gnum(cur, dd) : "…"}</div></div>
                    <div><div className="text-[var(--muted)]">DISTANCE</div><div className="font-semibold">{dist != null ? gnum(dist, dd) : "—"}</div></div>
                    <div><div className="text-[var(--muted)]">S/L</div><div className="font-semibold">{o.sl ? gnum(Number(o.sl), dd) : "—"}</div></div>
                    <div><div className="text-[var(--muted)]">T/P</div><div className="font-semibold">{o.tp ? gnum(Number(o.tp), dd) : "—"}</div></div>
                  </div>
                </div>
              );
            })}</>)}
          </div>
        )}

        {/* ───────── HISTORY ───────── */}
        {tab === "history" && (
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
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: h.side === "BUY" ? BUY : SELL }}>{h.side}</span>
                          <span className="text-[11px] text-[var(--muted)]">{h.lots}</span>
                          {h.closeReason && (() => {
                            const cr = String(h.closeReason).toUpperCase();
                            const isTP = cr === "TP" || cr.includes("TAKE");
                            const isSL = cr === "SL" || cr.includes("STOP LOSS");
                            const isMC = cr === "MC" || cr.includes("MARGIN") || cr.includes("STOP OUT") || cr.includes("LIQUID");
                            if (!isTP && !isSL && !isMC) return null; // hide "Manual" on the client side
                            const lbl = isTP ? "TP" : isSL ? "SL" : "MC";
                            const col = isTP ? BUY : SELL;
                            return <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: col, color: "#fff" }} title={"Closed: " + lbl}>{lbl}</span>;
                          })()}
                        </div>
                        <div className="text-sm font-bold" style={{ color: Number(h.pnl) >= 0 ? BUY : SELL }}>{(Number(h.pnl) >= 0 ? "+" : "") + fmt(Number(h.pnl))}</div>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">{gnum(Number(h.openPrice), dd)} → {gnum(Number(h.closePrice), dd)}</div>
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
                {(financials || []).length === 0 ? <div className="py-6 text-center text-[12px] text-[var(--muted)]">No financial records.</div> : (financials || []).map((f: any) => {
                  const credit = ["DEPOSIT", "CREDIT_IN", "BONUS", "TRANSFER_IN", "INSURANCE"].includes(f.type) || (f.type === "PNL_ADJUST" && Number(f.amount) >= 0);
                  return (
                    <div key={f.id} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                      <div>
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--soft)", color: "var(--muted)" }}>{String(f.type).replace(/_/g, " ")}</span>
                        <div className="mt-1 text-[12px] font-medium">{f.description || "—"}</div>
                        <div className="text-[10px] text-[var(--muted)]">{f.appliedAt ? new Date(f.appliedAt).toLocaleString() : "—"}</div>
                      </div>
                      <div className="text-sm font-bold" style={{ color: credit ? BUY : SELL }}>{(credit ? "+" : "-") + "$" + fmt(Math.abs(Number(f.amount)))}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ───────── PROFILE ───────── */}
        {tab === "profile" && (
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
                  <button onClick={() => avatarRef.current?.click()} className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: BUY, border: "2px solid var(--card)" }}><i className="fa-solid fa-pencil text-[10px]" /></button>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-base font-bold">{account?.ownerName || account?.name} <i className="fa-solid fa-circle-check text-[13px]" style={{ color: BLUE }} /></div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]"><i className="fa-solid fa-envelope mr-1.5" />{account?.email || "—"}</div>
                  <div className="text-[11px] text-[var(--muted)]"><i className="fa-solid fa-phone mr-1.5" />{account?.phone || "—"}</div>
                </div>
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
                <span className="font-bold" style={{ color: BUY }}>${fmt(balance)}</span>
              </div>
              <div className="my-2 border-t border-[var(--border)]" />
              <div className="flex items-center justify-between py-1 text-[12px] font-bold"><span>Total Balance</span><span>${fmt(totalBal)}</span></div>
              <div className="mt-2 text-[10px] font-semibold text-[var(--muted)]">ACCOUNT DETAILS</div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Deposit</span><span>${fmt(Number(account?.deposit || 0))}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Withdrawal</span><span>${fmt(Number(account?.withdrawal || 0))}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Profit</span><span style={{ color: Number(account?.pnl || 0) >= 0 ? BUY : SELL }}>${fmt(Number(account?.pnl || 0))}</span></div>
            </div>

            {/* running trade summary */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">RUNNING TRADE SUMMARY</div>
              <div className="mb-2 text-[10px] text-[var(--muted)]">Showing: {account?.login} · {account?.type} · {(positions || []).length} open</div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Floating P/L</span><span style={{ color: floating >= 0 ? BUY : SELL }}>${fmt(floating)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Equity</span><span>${fmt(equity)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Used Margin</span><span>${fmt(used)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Free Margin</span><span>${fmt(free)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Margin Level</span><span>{level ? level.toFixed(2) : "0.00"}%</span></div>
            </div>

            {/* by direction */}
            <div className="glass-card p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">BY DIRECTION</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: "rgba(22,163,74,.1)" }}>
                  <div className="text-[11px] font-bold" style={{ color: BUY }}>BUY</div>
                  <div className="mt-1 text-sm font-bold">{sumLots(buyPos).toFixed(2)} lots</div>
                  <div className="text-[10px] text-[var(--muted)]">{buyPos.length} trades</div>
                  <div className="mt-1 text-[12px] font-semibold" style={{ color: sumPL(buyPos) >= 0 ? BUY : SELL }}>${fmt(sumPL(buyPos))}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: "rgba(220,38,38,.1)" }}>
                  <div className="text-[11px] font-bold" style={{ color: SELL }}>SELL</div>
                  <div className="mt-1 text-sm font-bold">{sumLots(sellPos).toFixed(2)} lots</div>
                  <div className="text-[10px] text-[var(--muted)]">{sellPos.length} trades</div>
                  <div className="mt-1 text-[12px] font-semibold" style={{ color: sumPL(sellPos) >= 0 ? BUY : SELL }}>${fmt(sumPL(sellPos))}</div>
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
                      <div className="text-[12px] font-bold" style={{ color: pl >= 0 ? BUY : SELL }}>${fmt(pl)}</div>
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
                    <div className="text-[10px] text-[var(--muted)]">${fmt(acctBal(a))} · 1:{a.leverage}</div>
                  </div>
                  {a.id === accId && <i className="fa-solid fa-circle-check" style={{ color: BUY }} />}
                </button>
              ))}
              <button onClick={async () => { const r = await openAccount("LIVE"); if (r?.pending) { setMyReqsLoaded(false); loadMyReqs(); } }} className="mt-2 w-full rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BUY }}><i className="fa-solid fa-plus mr-1" /> Create New Live Account</button>
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
                    <div className="text-[10px] text-[var(--muted)]">${fmt(acctBal(a))} · 1:{a.leverage}</div>
                  </div>
                  {a.id === accId && <i className="fa-solid fa-circle-check" style={{ color: BUY }} />}
                </button>
              ))}
              {/* One demo per client: hide "Create" once a demo exists. Top-up lives on
                  the dashboard (demo account), not here. */}
              {demoAccts.length === 0 && (
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
            <button onClick={() => { setAcctReqModal && setAcctReqModal(false); setTab("profile"); }} className="mt-4 w-full rounded-xl py-2.5 text-[13px] font-semibold text-white" style={{ background: BLUE }}>View My Requests</button>
            <button onClick={() => setAcctReqModal && setAcctReqModal(false)} className="mt-2 w-full rounded-xl py-2 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Close</button>
          </div>
        </div>
      )}

      {/* NEW ORDER / PENDING MODAL */}
      {noOpen && (() => {
        const tab: "trade" | "pending" = noForm.tab || "trade";
        const dd = dg(selSym);
        const place = async (side: "BUY" | "SELL", kind: "MARKET" | "LIMIT" | "STOP") => {
          const ok = kind === "MARKET"
            ? await quickTrade(selSym, side, Number(noForm.lots))
            : await placePending(selSym, side, kind, Number(noForm.trigger), Number(noForm.lots), Number(noForm.sl) || 0, Number(noForm.tp) || 0);
          if (ok) setNoOpen(false);
        };
        const inp = "w-full rounded-lg border px-3 py-2 text-sm tabular-nums";
        const ist = { borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" };
        return (
          <div className="fixed inset-0 z-[95] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div className="glass glass-edge w-full rounded-t-[26px] p-4" style={{ background: theme === "dark" ? "rgba(28,30,38,0.82)" : "rgba(255,255,255,0.82)", borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <div className="font-bold">New Order — {selSym}</div>
                <button onClick={() => setNoOpen(false)} className="text-[var(--muted)]"><i className="fa-solid fa-xmark" /></button>
              </div>
              <div className="mb-3 flex gap-1 rounded-xl border border-[var(--border)] p-1">
                {([["trade", "Trade"], ["pending", "Pending"]] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => setNoForm({ ...noForm, tab: k })} className="flex-1 rounded-lg py-2 text-[12px] font-semibold" style={tab === k ? { background: BLUE, color: "#fff" } : { color: "var(--muted)" }}>{lbl}</button>
                ))}
              </div>
              <div className="mb-2"><div className="mb-1 text-[10px] text-[var(--muted)]">Lots</div><input type="number" step="0.01" className={inp} style={ist} value={noForm.lots} onChange={(e) => setNoForm({ ...noForm, lots: e.target.value })} /></div>
              {tab === "pending" && <div className="mb-2"><div className="mb-1 text-[10px] text-[var(--muted)]">Trigger price</div><input type="number" className={inp} style={ist} placeholder={price ? gnum(price, dd) : "price"} value={noForm.trigger} onChange={(e) => setNoForm({ ...noForm, trigger: e.target.value })} /></div>}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div><div className="mb-1 text-[10px] text-[var(--muted)]">Stop Loss</div><input type="number" className={inp} style={ist} value={noForm.sl} onChange={(e) => setNoForm({ ...noForm, sl: e.target.value })} /></div>
                <div><div className="mb-1 text-[10px] text-[var(--muted)]">Take Profit</div><input type="number" className={inp} style={ist} value={noForm.tp} onChange={(e) => setNoForm({ ...noForm, tp: e.target.value })} /></div>
              </div>
              {err && <div className="mb-2 text-center text-[11px]" style={{ color: SELL }}>{err}</div>}
              {tab === "trade" ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => place("SELL", "MARKET")} className="flex flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white active:scale-[0.98]" style={{ background: SELL }}><span className="text-[11px] uppercase tracking-wide opacity-90">Sell</span><span className="text-[15px] tabular-nums">{price != null ? gnum(bid, dd) : "…"}</span></button>
                  <button onClick={() => place("BUY", "MARKET")} className="flex flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white active:scale-[0.98]" style={{ background: BLUE }}><span className="text-[11px] uppercase tracking-wide opacity-90">Buy</span><span className="text-[15px] tabular-nums">{price != null ? gnum(ask, dd) : "…"}</span></button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {([["BUY", "LIMIT", "Buy Limit"], ["SELL", "LIMIT", "Sell Limit"], ["BUY", "STOP", "Buy Stop"], ["SELL", "STOP", "Sell Stop"]] as const).map(([side, kind, lbl]) => {
                    const buy = side === "BUY";
                    return (<button key={lbl} onClick={() => place(side, kind)} className="rounded-xl py-2.5 text-[12px] font-semibold active:scale-[0.98]" style={{ background: buy ? "rgba(47,129,247,0.15)" : "rgba(224,82,96,0.13)", color: buy ? "#6ab0ff" : SELL, border: "1px solid " + (buy ? "rgba(47,129,247,0.45)" : "rgba(224,82,96,0.45)") }}>{lbl}</button>);
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* PERSISTENT BALANCE BAR */}
      <button onClick={() => setBalOpen((v: boolean) => !v)} className="glass flex w-full items-center justify-between border-t px-4 py-1.5" style={{ borderColor: "var(--border)", background: theme === "dark" ? "rgba(20,24,34,0.55)" : "rgba(255,255,255,0.55)" }}>
        <span className="text-[11px] text-[var(--muted)]"><i className="fa-solid fa-briefcase mr-1.5" />Balance <i className={"fa-solid ml-0.5 " + (balOpen ? "fa-chevron-down" : "fa-chevron-up")} /></span>
        <span className="text-base font-bold tabular-nums" style={{ color: balance >= 0 ? BUY : SELL }}>${fmt(balance)}</span>
      </button>
      {balOpen && (
        <div className="border-t border-[var(--border)] px-4 py-3" style={{ background: "var(--card)" }}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Balance</span><span className="font-semibold tabular-nums">${fmt(balance)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Equity</span><span className="font-semibold tabular-nums">${fmt(equity)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Floating P/L</span><span className="font-semibold tabular-nums" style={{ color: floating >= 0 ? BUY : SELL }}>${fmt(floating)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Used Margin</span><span className="font-semibold tabular-nums">${fmt(used)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Free Margin</span><span className="font-semibold tabular-nums">${fmt(free)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Margin Level</span><span className="font-semibold tabular-nums">{used > 0 ? level.toFixed(1) + "%" : "—"}</span></div>
          </div>
        </div>
      )}

      {/* BOTTOM NAV — solid rounded bar; active item = brand squircle with white icon */}
      {(() => {
        const primary = brand?.primaryColor || "#2563eb";
        const dark = theme === "dark";
        const barBg = dark ? "#21242b" : "#ffffff";
        const inactive = dark ? "rgba(255,255,255,0.6)" : "#64748b"; // outline-icon stroke colour
        return (
          <div className="px-4 pt-2" style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}>
            <div className="flex items-center justify-around rounded-[26px] px-2 py-2" style={{
              background: barBg,
              border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(15,23,42,0.06)",
              boxShadow: dark ? "0 14px 34px -14px rgba(0,0,0,0.75)" : "0 14px 30px -14px rgba(15,23,42,0.28)",
            }}>
              {navItems.map(([k, icon]) => {
                const active = tab === k;
                return (
                  <button key={k} onClick={() => startTransition(() => setTab(k as any))} aria-label={k}
                    className="flex items-center justify-center rounded-[15px]" style={{
                      width: 46, height: 46,
                      background: active ? primary : "transparent",
                      boxShadow: active ? `0 8px 18px -6px ${primary}80` : "none",
                      transform: active ? "translateY(-1px)" : "none",
                      transition: "background .25s ease, box-shadow .25s ease, transform .25s cubic-bezier(.34,1.56,.64,1)",
                    }}>
                    <i className={`fa-solid ${icon}`} style={{
                      fontSize: 17,
                      // active = solid white; inactive = outline (transparent fill + muted stroke)
                      color: active ? "#fff" : "transparent",
                      WebkitTextStroke: active ? "0px transparent" : `1.4px ${inactive}`,
                      transition: "color .25s ease, -webkit-text-stroke .25s ease",
                      animation: active ? "nav-pop .25s cubic-bezier(.34,1.56,.64,1)" : undefined,
                    }} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* TRANSFER MODAL */}
      {xferModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="glass glass-edge w-full max-w-[340px] rounded-[22px] border p-4" style={{ background: theme === "dark" ? "rgba(28,30,38,0.85)" : "rgba(255,255,255,0.85)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
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
              <div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-[var(--muted)]">Available {pnlOnly ? "(profit only)" : "balance"}</span><button type="button" onClick={() => setXfer({ ...(xfer || {}), amount: String(av.toFixed(2)) })} className="font-semibold" style={{ color: "#22d3ee" }}>${fmt(av)} · Use max</button></div>
            ); })()}
            <label className="text-[10px] text-[var(--muted)]">Amount</label>
            <input type="number" value={xfer?.amount || ""} onChange={(e) => setXfer({ ...(xfer || {}), amount: e.target.value })} placeholder="0.00" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[12px] text-[var(--text)]" />
            {xferErr && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{xferErr}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setXferModal(false)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[12px]">Cancel</button>
              <button onClick={doTransfer} className="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BLUE }}>Transfer</button>
            </div>
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
          <div className="glass glass-edge w-full max-w-[320px] rounded-[22px] border p-4" style={{ background: theme === "dark" ? "rgba(28,30,38,0.85)" : "rgba(255,255,255,0.85)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
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
