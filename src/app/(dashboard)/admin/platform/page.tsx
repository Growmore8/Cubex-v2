"use client";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { pnlFor } from "@/lib/trademath";
import { io, Socket } from "socket.io-client";
import PriceCell from "@/components/PriceCell";
import { playSound, soundForNotification, isMuted, setMuted } from "@/lib/sounds";
import PaymentsPanel from "@/components/PaymentsPanel";
import KycPanel from "@/components/KycPanel";
import ReferralPanel from "@/components/ReferralPanel";
import RequestsPanel from "@/components/RequestsPanel";
import KLineProChart from "@/components/KLineProChart";
import ManagersModal from "@/components/admin/ManagersModal";
import PaymentMethodsModal from "@/components/admin/PaymentMethodsModal";
import DeskMarketWatch from "@/components/DeskMarketWatch";
import PasswordInput from "@/components/ui/PasswordInput";
import CountrySelect from "@/components/ui/CountrySelect";
import SymbolPicker from "@/components/ui/SymbolPicker";
import { randomConfirmWord } from "@/lib/confirmword";
import { iconForNotification } from "@/lib/notif";
import { isOnline as presenceOnline } from "@/components/ui/Presence";
import instruments from "@/config/instruments";
import { contractFor } from "@/config/contracts";
import { gnum, gmoney, titleCaseName } from "@/lib/format";
import { ADSS_DARK, ADSS_LIGHT, ADSS_FONT, BUY, SELL, GOLD, BUYBTN, SELLBTN } from "@/config/theme";

const TFS = ["1M", "5M", "15M", "30M", "1H", "4H", "1D"];
const TABS: [string, string][] = [["overview", "Overview"], ["trade", "Trade"], ["history", "History"], ["summary", "Summary"], ["clients", "Clients"], ["audit", "Audit"], ["payments", "Payments"], ["kyc", "KYC"], ["requests", "Requests"], ["symbols", "Symbols"], ["groups", "Groups"], ["risk", "Risk"], ["copy", "Copy Trading"], ["signals", "Signals"], ["broadcast", "Broadcast"], ["referral", "Referral"]];

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
  if (isFx && /^USD/i.test(sym)) pf = pf / (price || 1); // USD base -> convert to USD
  return pf;
}

export default function AdminDeskPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { const t = localStorage.getItem("cubex-theme"); if (t === "light" || t === "dark") setTheme(t); }, []);
  function toggleTheme() { setTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("cubex-theme", n); return n; }); }

  // 2FA state for admin
  const [adminTotpEnabled, setAdminTotpEnabled] = useState(false);
  const [adminTotpModal, setAdminTotpModal] = useState<"setup" | "disable" | null>(null);
  const [adminTotpQr, setAdminTotpQr] = useState("");
  const [adminTotpSecret, setAdminTotpSecret] = useState("");
  const [adminTotpCode, setAdminTotpCode] = useState("");
  const [adminTotpBusy, setAdminTotpBusy] = useState(false);
  const [adminTotpErr, setAdminTotpErr] = useState("");
  useEffect(() => { fetch("/api/auth/totp/status").then((r) => r.json()).then((d) => { if (d.ok) setAdminTotpEnabled(d.totpEnabled); }).catch(() => {}); }, []);
  async function adminOpenTotpSetup() {
    setAdminTotpErr(""); setAdminTotpCode(""); setAdminTotpQr(""); setAdminTotpSecret(""); setAdminTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/setup").then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setAdminTotpQr(r.qrDataUrl); setAdminTotpSecret(r.secret); setAdminTotpModal("setup");
    } catch (e: any) { setAdminTotpErr(e.message || "Failed"); }
    finally { setAdminTotpBusy(false); }
  }
  async function adminConfirmTotpEnable() {
    setAdminTotpErr(""); setAdminTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: adminTotpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setAdminTotpEnabled(true); setAdminTotpModal(null);
    } catch (e: any) { setAdminTotpErr(e.message || "Invalid code"); }
    finally { setAdminTotpBusy(false); }
  }
  async function adminConfirmTotpDisable() {
    setAdminTotpErr(""); setAdminTotpBusy(true);
    try {
      const r = await fetch("/api/auth/totp/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: adminTotpCode }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Failed");
      setAdminTotpEnabled(false); setAdminTotpModal(null);
    } catch (e: any) { setAdminTotpErr(e.message || "Invalid code"); }
    finally { setAdminTotpBusy(false); }
  }

  const [clients, setClients] = useState<any[]>([]);
  // Accounts that are "secondary" for their userId (oldest account = root, all others = sub)
  const subAccIds = useMemo(() => {
    const groups: Record<string, { id: string; createdAt: string }[]> = {};
    clients.forEach((c: any) => { const uid = c.userId || c.id; (groups[uid] || (groups[uid] = [])).push({ id: c.id, createdAt: c.createdAt }); });
    const s = new Set<string>();
    Object.values(groups).forEach((accs) => {
      if (accs.length <= 1) return;
      const sorted = [...accs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      sorted.slice(1).forEach((a) => s.add(a.id));
    });
    return s;
  }, [clients]);
  const isSubAcc = (c: any) => !!c.parentId || subAccIds.has(c.id);
  const [managers, setManagers] = useState<any[]>([]);
  const [mgrModal, setMgrModal] = useState(false);
  const [pmModal, setPmModal] = useState(false);
  // Toolbox: show the per-tab × close mark? Off by default, toggleable (persisted).
  const [tabCloseX, setTabCloseX] = useState(false);
  useEffect(() => { try { setTabCloseX(localStorage.getItem("cubex-tabx") === "1"); } catch {} }, []);
  const toggleTabCloseX = () => setTabCloseX((v) => { const n = !v; try { localStorage.setItem("cubex-tabx", n ? "1" : "0"); } catch {} return n; });
  const [tradeGroups, setTradeGroups] = useState<any[]>([]);
  const [nrecent, setNrecent] = useState<any[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const NOTI_TEMPLATES: any = { Maintenance: { title: "Scheduled Maintenance", body: "Our platform will undergo scheduled maintenance. Trading may be briefly unavailable. We apologize for any inconvenience." }, Promotion: { title: "Special Promotion", body: "A new promotion is now available. Contact your account manager to learn more." }, News: { title: "Market News", body: "Stay informed with the latest market updates and analysis." }, Notice: { title: "Important Notice", body: "Please review this important notice regarding your trading account." }, Custom: { title: "", body: "" } };
  
  const [symbols, setSymbols] = useState<any[]>([]);
  const [adminSymSpreads, setAdminSymSpreads] = useState<Record<string, number>>({});
  const [adminSymTypes, setAdminSymTypes] = useState<Record<string, string>>({});
  const [saDefaultSpreads, setSaDefaultSpreads] = useState<Record<string, number>>({});
  const [adminSymMax, setAdminSymMax] = useState<Record<string, number>>({});
  const [adminSymIds, setAdminSymIds] = useState<Record<string, string>>({});
  const [adminSymbols, setAdminSymbols] = useState<any[]>([]); // full admin symbol list (includes enabled, swap, commission)
  const [symQ, setSymQ] = useState(""); // Symbols tab search query
  const [symCat, setSymCat] = useState("all"); // Symbols tab category filter
  const [symEdit, setSymEdit] = useState<{ sym: string; spread: number; spreadType: string; spreadMax: number; id: string; swapLong: number; swapShort: number; commissionPerLot: number } | null>(null);
  const [grpCtx, setGrpCtx] = useState<{ x: number; y: number; g: any } | null>(null);
  const [grpSub, setGrpSub] = useState(""); // which inline section is open in grpCtx panel
  const [grpForm, setGrpForm] = useState<Record<string, any>>({});
  const [grpSymOv, setGrpSymOv] = useState<{ g: any; disabled: string[]; q: string } | null>(null);
  const [grpEdit, setGrpEdit] = useState<any>(null);
  const [catEdit, setCatEdit] = useState<{ cat: string; syms: string[]; spread: number; spreadType: string; spreadMax: number } | null>(null);
  const [allSymEdit, setAllSymEdit] = useState<{ type: string; pips: number } | null>(null);
  const [open, setOpen] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [accHistory, setAccHistory] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [liveSpreadPips, setLiveSpreadPips] = useState<Record<string, number>>({});
  const [selSym, setSelSym] = useState("");
  const [tf, setTf] = useState("1M");
const [selAcc, setSelAcc] = useState<any>(null);
  const selAccRef = useRef<any>(null);
  useEffect(() => { selAccRef.current = selAcc; }, [selAcc]);
  const [lot, setLot] = useState(0.01);
  // Instant reflection: whenever the client list reloads (after a trade close,
  // fund add, etc.) re-point selAcc at the fresh record so the summary ticker
  // (balance / equity / realized P&L) updates immediately without a manual reload.
  useEffect(() => {
    setSelAcc((cur: any) => (cur ? (clients.find((c: any) => c.id === cur.id) || cur) : cur));
  }, [clients]);
  const sl = 0, tp = 0;
  const [tab, setTab] = useState("trade");
  const [tabState, setTabState] = useState<Record<string, boolean>>({ overview: true, trade: true, history: true, summary: true, clients: true, audit: true, payments: true, kyc: true, requests: true, symbols: true, groups: true, risk: true, copy: true, signals: true, broadcast: true, referral: true });
  const [copyRelations, setCopyRelations] = useState<any[]>([]);
  const [copyForm, setCopyForm] = useState({ masterAccId: "", followerAccId: "", ratio: "1.0" });
  const [copyErr, setCopyErr] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; acc: any } | null>(null);
  const [menuSub, setMenuSub] = useState("");
  const [act, setAct] = useState<any>(null);
  const [actMin, setActMin] = useState(false);
  const [aform, setAform] = useState<any>({});
  const [topMenu, setTopMenu] = useState<string>("");
  const [modal, setModal] = useState<"" | "client" | "manager" | "group" | "notify">("");
  const [modalMin, setModalMin] = useState(false);
  useEffect(() => { if (modal === "notify") fetch("/api/admin/notify").then((r) => r.json()).then((d) => { if (d.ok) setNrecent(d.recent || []); }).catch(() => {}); }, [modal]);
  const [form, setForm] = useState<any>({ type: "LIVE", leverage: 100, currency: "USD" });
  const [dupWarn, setDupWarn] = useState<{ name: string; accounts: number } | null>(null);
  const dupTimerRef = useRef<any>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  // Auto-clear feedback messages after 5 seconds so they never stick permanently.
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(""), 5000); return () => clearTimeout(t); }, [err]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(""), 5000); return () => clearTimeout(t); }, [ok]);
  const [toasts, setToasts] = useState<any[]>([]);
  const [confirmBox, setConfirmBox] = useState<{ msg: string; danger?: boolean; onYes: () => void; requireWord?: string } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  function askConfirm(msg: string, onYes: () => void, danger = true) { setConfirmInput(""); setConfirmBox({ msg, danger, onYes }); }
  // Safe-delete: requires typing a random word before the action runs.
  function askDelete(msg: string, onYes: () => void) { setConfirmInput(""); setConfirmBox({ msg, danger: true, onYes, requireWord: randomConfirmWord() }); }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navW, setNavW] = useState(248);
  const [mwW, setMwW] = useState(310);
  const [tbH, setTbH] = useState(240);
  const [layout, setLayout] = useState(1);
  const [openCharts, setOpenCharts] = useState<string[]>([]);
  const [activeChart, setActiveChart] = useState(0);
  const [showBuySell, setShowBuySell] = useState(true);

  const [panels, setPanels] = useState<{ nav: boolean; mw: boolean; toolbox: boolean }>({ nav: true, mw: true, toolbox: true });
  const [ticket, setTicket] = useState<string | null>(null);
  const [tform, setTform] = useState<any>({ vol: 0.01, sl: 0, tp: 0, type: "Market" });
  const [posMenu, setPosMenu] = useState<{ x: number; y: number; t: any } | null>(null);
  const [pos, setPos] = useState<any>(null);
  const [symOv, setSymOv] = useState<any>(null);
  const [symOvTab, setSymOvTab] = useState<"access"|"spread">("access");
  const [mt, setMt] = useState<any>(null);
  const [mtMin, setMtMin] = useState(false);
  const [hEdit, setHEdit] = useState<any>(null);
  const [pform, setPform] = useState<any>({});
  const [tradeSel, setTradeSel] = useState<Record<string, boolean>>({});
  const [histSel, setHistSel] = useState<Record<string, boolean>>({});
  const [inlineEdit, setInlineEdit] = useState<Record<string, any>>({});
  const [cliQ, setCliQ] = useState("");
  const [cliType, setCliType] = useState("ALL");
  const [cliStatus, setCliStatus] = useState("ALL");
  // Per-table sort state: first click asc, second desc, third clears. Shared across all toolbox tables.
  const [sortBy, setSortBy] = useState<Record<string, { k: string; d: 1 | -1 }>>({});
  const toggleSort = (tbl: string, k: string) => setSortBy((s) => {
    const cur = s[tbl];
    if (!cur || cur.k !== k) return { ...s, [tbl]: { k, d: 1 } };
    if (cur.d === 1) return { ...s, [tbl]: { k, d: -1 } };
    const n = { ...s }; delete n[tbl]; return n;
  });
  const sortRows = (tbl: string, rows: any[], acc: Record<string, (r: any) => any>) => {
    const cfg = sortBy[tbl]; if (!cfg || !acc[cfg.k]) return rows;
    const get = acc[cfg.k];
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * cfg.d;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * cfg.d;
    });
  };
  const SortTh = ({ tbl, k, label, align, cls }: { tbl: string; k: string; label: any; align?: "right"; cls: string }) => {
    const cfg = sortBy[tbl]; const active = !!cfg && cfg.k === k;
    return (
      <th className={cls} onClick={() => toggleSort(tbl, k)} style={{ cursor: "pointer", userSelect: "none" }}>
        <span className={"inline-flex items-center gap-1 " + (align === "right" ? "flex-row-reverse" : "")}>
          {label}
          <i className={"fa-solid text-[8px] " + (active ? (cfg!.d === 1 ? "fa-arrow-up-long" : "fa-arrow-down-long") : "fa-sort")} style={{ opacity: active ? 1 : 0.3, color: active ? "var(--accent)" : "var(--muted)" }} />
        </span>
      </th>
    );
  };
  const [auditCat, setAuditCat] = useState("ALL");
  const [auditQ, setAuditQ] = useState("");
  const [navTab, setNavTab] = useState<"live" | "demo">("live");
  const [chartInd, setChartInd] = useState({ sma: false, ema: false, bb: false, rsi: false, macd: false, psar: false, cdl: false, stoch: false, atr: false, adx: false, sig: false, ribbon: false });
  const [chartCfg, setChartCfg] = useState<any>({ ma: 20, rsi: 14, bb: 20, macdF: 12, macdS: 26, macdSig: 9 });

  const [stmtModal, setStmtModal] = useState(false);
  const [stmtEmailModal, setStmtEmailModal] = useState(false);
  const [stmtPreset, setStmtPreset] = useState("all");
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");
  const [stmtEmail, setStmtEmail] = useState("");
  const [stmtMsg, setStmtMsg] = useState("");
  const [stmtSending, setStmtSending] = useState(false);
  const [navSearch, setNavSearch] = useState("");
  const [mwSearch, setMwSearch] = useState("");
  const [soundMuted, setSoundMuted] = useState(false);
  useEffect(() => { setSoundMuted(isMuted()); }, []);
  const [role, setRole] = useState("");
  const roleRef = useRef("");
  const isManager = role === "MANAGER";
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: "", logoUrl: null });
  const [trial, setTrial] = useState<{ active: boolean; daysLeft: number } | null>(null);
  const [swapEnabled, setSwapEnabled] = useState(true);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
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
  const [symDisabledCount, setSymDisabledCount] = useState(0); // ticker only — does NOT open modal
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
    if (d.ok) {
      setSymPerm((p: any) => (p ? { ...p, disabled: d.disabled } : p));
      setSymDisabledCount((d.disabled || []).length);
      setOk(`${symbol} turned ${disabled ? "OFF" : "ON"} for clients`);
      loadAll();
    } else setErr(d.error || "Failed to update symbol");
  }
  const [accAlerts, setAccAlerts] = useState<any[]>([]);
  async function loadAccAlerts(accId: string) { try { const d = await fetch("/api/admin/clients/" + accId + "/alerts").then((r) => r.json()); if (d.ok) setAccAlerts(d.alerts || []); } catch {} }
  useEffect(() => { if (selAcc?.id) loadAccAlerts(selAcc.id); else setAccAlerts([]); }, [selAcc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadAccHistory(accId?: string) {
    const id = accId ?? selAcc?.id;
    if (!id) { setAccHistory([]); return; }
    try { const d = await fetch("/api/desk/history?accountId=" + id).then((r) => r.json()); if (d.ok) setAccHistory(d.history || []); } catch {}
  }
  useEffect(() => {
    loadAccHistory(selAcc?.id);
  }, [selAcc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  async function loadPending() { try { const d = await fetch("/api/desk/pending").then((r) => r.json()); if (d.ok) setPendingOrders(d.pending || []); } catch {} }
  useEffect(() => { loadPending(); const t = setInterval(loadPending, 6000); return () => clearInterval(t); }, []);
  async function cancelPending(id: string) { const r = await fetch("/api/desk/pending/" + id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadPending(); }
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [bcTitle, setBcTitle] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcSending, setBcSending] = useState(false);
  const [bcMsg, setBcMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Signals state
  const [adminSignals, setAdminSignals] = useState<any[]>([]);
  const [sigForm, setSigForm] = useState({ symbol: "", direction: "BUY", entryPrice: "", sl: "", tp: "", rationale: "" });
  const [sigSending, setSigSending] = useState(false);
  const [sigMsg, setSigMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadSignals = () => fetch("/api/admin/signals").then((r) => r.json()).then((d) => { if (d.ok) setAdminSignals(d.signals || []); }).catch(() => {});
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
  const [dirs, setDirs] = useState<Record<string, number>>({});

  const selSymRef = useRef(selSym);
  useEffect(() => { selSymRef.current = selSym; }, [selSym]);

  const digitsMap: Record<string, number> = Object.fromEntries(symbols.map((s) => [s.symbol, s.digits]));
  function dg(sym: string) { return digitsMap[sym] ?? instruments[sym]?.digits ?? 2; }
  // Magnitude-aware: never lose precision on small-value symbols (e.g. ADAUSDT 0.18940)
  function pxDigits(sym: string, n: number) {
    let d = dg(sym);
    const a = Math.abs(n);
    if (a > 0 && a < 1) d = Math.max(d, 5);
    else if (a < 10) d = Math.max(d, 4);
    else if (a < 100) d = Math.max(d, 3);
    return d;
  }
  // Grouped (thousands separators) price for DISPLAY.
  function pxFmt(sym: string, val: any) {
    if (val == null || val === "") return "-";
    const n = Number(val);
    if (!isFinite(n)) return "-";
    return gnum(n, pxDigits(sym, n));
  }
  // Plain (no commas) price — for <input type="number"> default values.
  function pxRaw(sym: string, val: any) {
    if (val == null || val === "") return "";
    const n = Number(val);
    if (!isFinite(n)) return "";
    return n.toFixed(pxDigits(sym, n));
  }
  // Grouped price for direct prices[sym] displays.
  const gpx = (sym: string, val: any) => pxFmt(sym, val);
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
    if (sy.ok) { const seen = new Set<string>(); const uniq = (sy.symbols || []).filter((s: any) => { if (seen.has(s.symbol)) return false; seen.add(s.symbol); return true; }); setSymbols(uniq); if (!selSymRef.current && uniq.length) setSelSym((uniq.find((s: any) => s.symbol === "BTCUSD") || uniq[0]).symbol); }
    // Load per-symbol spreads for market watch bid/ask display
    fetch("/api/admin/symbols").then((r) => r.json()).then((asr) => { if (asr.ok) { const m: Record<string, number> = {}; const types: Record<string, string> = {}; const maxes: Record<string, number> = {}; const ids: Record<string, string> = {}; (asr.symbols || []).forEach((s: any) => { m[s.symbol] = Number(s.spread ?? 0); types[s.symbol] = s.spreadType || "FIXED"; maxes[s.symbol] = Number(s.spreadMax ?? 0); ids[s.symbol] = s.id; }); setAdminSymSpreads(m); setAdminSymTypes(types); setAdminSymMax(maxes); setAdminSymIds(ids); setAdminSymbols(asr.symbols || []); } }).catch(() => {});
    // Load SA default spreads (fallback when no exchange bid/ask and no admin spread configured)
    fetch("/api/admin/spread-defaults").then((r) => r.json()).then((d) => { if (d.ok) setSaDefaultSpreads(d.defaults); }).catch(() => {});
    if (o.ok) setOpen(o.trades);
    if (h.ok) setHistory(h.history);
    if (a.ok) setAudit(a.logs);
    if (mg.ok) setManagers(mg.managers || []);
    if (gr.ok) setTradeGroups(gr.groups || []);
    setDataReady(true);
    fetch("/api/admin/symbol-perms").then((r) => r.json()).then((d) => { if (d.ok) setSymDisabledCount((d.disabled || []).length); }).catch(() => {});
  }
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.ok && d.user) { roleRef.current = d.user.role; setRole(d.user.role); setPerms(d.perms || {}); if (d.brand) setBrand(d.brand); setTrial(d.trial || null); setSwapEnabled(d.swapEnabled !== false); if (d.features) setFeatures(d.features); }
    }).catch(() => {}).finally(() => loadAll());
  }, []);
  // If the active tab is feature-gated (SA disabled it), fall back to Trade.
  useEffect(() => {
    if ((tab === "copy" || tab === "signals") && (features.copyTrading === false || perms.copyTrading === false)) setTab("trade");
  }, [features, perms]); // eslint-disable-line react-hooks/exhaustive-deps
  const notifSeen = useRef<Set<string>>(new Set());
  const notifPrimed = useRef(false);
  async function loadNotifs() {
    try {
      const d = await fetch("/api/notifications").then((r) => r.json());
      if (!d.ok) return;
      const items = d.items || [];
      // Activity (client/manager financial + trade + login) also pops a transient
      // toast, but every notification is now ALSO kept in the header bell so nothing
      // is missed if staff aren't watching the screen at that moment.
      const ACTIVITY = new Set(["TRADE", "FUNDS", "LOGIN"]);
      const isActivity = (n: any) => ACTIVITY.has(String(n.type || "").toUpperCase());
      if (notifPrimed.current) {
        for (const n of items) {
          const id = String(n.id);
          if (!notifSeen.current.has(id)) { playSound(soundForNotification(n)); if (isActivity(n)) pushNotifToast(n); }
        }
      }
      items.forEach((n: any) => notifSeen.current.add(String(n.id)));
      notifPrimed.current = true;
      setNotifs(items); setNotifUnread(items.filter((n: any) => !n.read).length);
    } catch {}
  }
  useEffect(() => { loadNotifs(); const t = setInterval(loadNotifs, 20000); return () => clearInterval(t); }, []);
  async function openNotifs() { setNotifOpen((v) => !v); if (!notifOpen && notifUnread > 0) { try { await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {} setNotifUnread(0); } }
  // Single toast at a time — a new one replaces the old (no stacking list).
  function toast(msg: string, kind: string) { const id = Date.now() + Math.random(); setToasts([{ id, msg, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500); }
  function pushNotifToast(n: any) {
    const st = soundForNotification(n);
    const id = Date.now() + Math.random();
    setToasts([{ id, notif: true, st, title: n.title, body: n.body }]); // replace, no list
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }
  useEffect(() => { if (ok) toast(ok, "ok"); }, [ok]);
  useEffect(() => { if (symbols.length && openCharts.length === 0) { const btc = symbols.find((s) => s.symbol === "BTCUSD"); const rest = symbols.filter((s) => s.symbol !== "BTCUSD").slice(0, btc ? 3 : 4).map((s) => s.symbol); const init = btc ? ["BTCUSD", ...rest] : rest; setOpenCharts(init); setSelSym(init[0]); } }, [symbols]);
  // Remember the last market setup (open charts / timeframe / indicators / layout /
  // panels) across refreshes. Restoring openCharts (non-empty) stops the default
  // init effect above from overwriting it.
  useEffect(() => {
    try {
      const sv = JSON.parse(localStorage.getItem("cubex-desk-setup") || "null");
      if (sv) {
        if (Array.isArray(sv.openCharts) && sv.openCharts.length) { setOpenCharts(sv.openCharts); setSelSym(sv.openCharts[Math.min(sv.activeChart || 0, sv.openCharts.length - 1)]); }
        if (typeof sv.activeChart === "number") setActiveChart(sv.activeChart);
        if (sv.tf) setTf(sv.tf);
        if (sv.chartInd) setChartInd(sv.chartInd);
        if (sv.chartCfg) setChartCfg((c: any) => ({ ...c, ...sv.chartCfg }));
        if (typeof sv.layout === "number") setLayout(sv.layout);
        if (sv.panels) setPanels(sv.panels);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (openCharts.length === 0) return; // don't persist the empty initial state
    try { localStorage.setItem("cubex-desk-setup", JSON.stringify({ openCharts, activeChart, tf, chartInd, chartCfg, layout, panels })); } catch {}
  }, [openCharts, activeChart, tf, chartInd, chartCfg, layout, panels]);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    // Batch high-frequency ticks: accumulate in refs, flush to state once per
    // animation frame so 57 symbols can't trigger hundreds of re-renders/sec.
    const pP: Record<string, number> = {};
    const pD: Record<string, number> = {};
    const pS: Record<string, number> = {};
    const flush = () => {
      const pxKeys = Object.keys(pP); const drKeys = Object.keys(pD); const skKeys = Object.keys(pS);
      if (!pxKeys.length && !drKeys.length && !skKeys.length) return;
      const px = { ...pP }; const dr = { ...pD }; const sp = { ...pS };
      for (const k in pP) delete pP[k]; for (const k in pD) delete pD[k]; for (const k in pS) delete pS[k];
      if (skKeys.length) setLiveSpreadPips((ss) => ({ ...ss, ...sp }));
      startTransition(() => {
        if (pxKeys.length) setPrices((pp) => ({ ...pp, ...px }));
        if (drKeys.length) setDirs((dd) => ({ ...dd, ...dr }));
      });
    };
    socket.on("prices", (snapshot: Record<string, number>) => {
      startTransition(() => setPrices((pp) => ({ ...pp, ...snapshot })));
      for (const k in snapshot) prevRef.current[k] = snapshot[k];
    });
    socket.on("tick", ({ symbol, price, bid, real }: any) => {
      const prev = prevRef.current[symbol];
      if (prev != null && prev !== price) pD[symbol] = price > prev ? 1 : -1;
      prevRef.current[symbol] = price;
      pP[symbol] = price;
      if (real != null && real > 0 && bid != null && bid > 0 && real > bid) {
        const d = dg(symbol);
        pS[symbol] = (real - bid) / pipOf(d);
      }
    });
    const flushIv = setInterval(flush, 150);
    // Single timer clears the up/down flash for all symbols (cheap vs per-symbol timers)
    const clr = setInterval(() => setDirs((dd) => { let any = false; for (const k in dd) if (dd[k] !== 0) { any = true; break; } return any ? {} : dd; }), 650);
    socket.on("liquidation", () => { loadAll(); loadNotifs(); loadAccHistory(selAccRef.current?.id); });
    socket.on("refresh", () => { loadAll(); loadNotifs(); loadAccHistory(selAccRef.current?.id); });
    const t = setInterval(() => fetch("/api/desk/trades").then((r) => r.json()).then((d) => d.ok && setOpen(d.trades)).catch(() => {}), 7000);
    return () => { socket.disconnect(); clearInterval(t); clearInterval(clr); clearInterval(flushIv); };
  }, []);

  function dragX(e: any, which: "nav" | "mw") { e.preventDefault(); const sx = e.clientX; const sw = which === "nav" ? navW : mwW; const mv = (ev: any) => { const dx = ev.clientX - sx; if (which === "nav") setNavW(Math.max(120, Math.min(360, sw + dx))); else setMwW(Math.max(120, Math.min(380, sw - dx))); }; const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }
  function dragY(e: any) { e.preventDefault(); const sy = e.clientY; const sh = tbH; const mv = (ev: any) => { const dy = sy - ev.clientY; setTbH(Math.max(110, Math.min(520, sh + dy))); }; const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); }

  async function place(symbol: string, type: "BUY" | "SELL", opts?: any) {
    setErr(""); if (!selAcc) { setErr("Select an account in the navigator first"); return; }
    const body: any = { accountId: selAcc.id, symbol, type, lots: Number(opts && opts.lots != null ? opts.lots : lot), sl: Number(opts && opts.sl != null ? opts.sl : sl), tp: Number(opts && opts.tp != null ? opts.tp : tp) };
    if (opts?.trailingStop) body.trailingStop = Number(opts.trailingStop);
    if (opts?.comment) body.comment = opts.comment;
    const r = await fetch("/api/desk/manual-trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setTicket(null); loadAll();
  }
  async function placeTicket(btnSide: "BUY" | "SELL") {
    if (!ticket) return;
    if (tform.type === "Market") { place(ticket, btnSide, { lots: tform.vol, sl: tform.sl, tp: tform.tp, trailingStop: Number(tform.trail) || 0, comment: tform.comment || undefined }); return; }
    setErr("");
    if (!selAcc) { setErr("Select an account first"); return; }
    const trig = Number(tform.price); if (!trig) { setErr("Enter a trigger price"); return; }
    const side = tform.type.indexOf("Buy") === 0 ? "BUY" : "SELL";
    const kind = tform.type.indexOf("Stop") !== -1 ? "STOP" : "LIMIT";
    const r = await fetch("/api/desk/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: selAcc.id, symbol: ticket, side, kind, lots: tform.vol, price: trig, sl: tform.sl, tp: tform.tp, comment: tform.comment || undefined }) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setTicket(null); loadAll();
  }
  async function close(id: string) { const r = await fetch("/api/desk/trades/" + id + "/close", { method: "POST" }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Close failed"); return; } loadAll(); }
  async function delTrade(id: string) { const r = await fetch("/api/desk/trades/" + id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Delete failed"); return; } loadAll(); }
  async function delTradesBulk(ids: string[]) { for (const id of ids) { await fetch("/api/desk/trades/" + id, { method: "DELETE" }); } setTradeSel({}); loadAll(); }
  function unlinkSub(c: any) { askConfirm(`Unlink sub-account ${c.login} from its parent? It becomes a standalone account.`, async () => { const r = await fetch("/api/admin/clients/" + c.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unlinkSub" }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else { setOk("Sub-account unlinked"); loadAll(); } }, false); }
  function delClient(acc: any) { setMenu(null); askDelete(`Delete ${acc.login} - ${acc.name}? This permanently removes the client and cannot be undone.`, async () => { const r = await fetch("/api/admin/clients/" + acc.id, { method: "DELETE" }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }); }
  function reconcileAcc(acc: any) { setMenu(null); askConfirm(`Recalculate balance for ${acc.login} - ${acc.name}? This rebuilds realized P/L from the surviving closed trades and manual P/L entries (fixes balances left wrong after a deleted manual P/L). Deposits, withdrawals and credit are not touched.`, async () => { const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile" }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else { setOk(`Balance recalculated (P/L ${d.before?.toFixed?.(2)} → ${d.after?.toFixed?.(2)})`); loadAll(); } }, false); }

  function openAct(kind: string, acc: any, finType?: string, label?: string) { setMenu(null); setMenuSub(""); setErr(""); setAform({}); setActMin(false); setAct({ kind, acc, finType, label }); }
  function actTitle() { if (!act) return ""; const m: any = { money: act.label, manualpnl: "Manual P/L", transfer: "Transfer Between Accounts", rename: "Client Details", accountid: "Change Account ID", password: "Change Password", assignmgr: "Assign Manager", assign: "Assign Manager & Group", settings: "Account Settings", subaccount: "Create Sub-Account", assigngroup: "Assign Group", leverage: "Change Leverage", mclevel: "Margin Call Level", spreadmarkup: "Spread Markup" }; return m[act.kind] || "Action"; }
  function actIcon() { if (!act) return "fa-circle"; const m: any = { money: "fa-dollar-sign", manualpnl: "fa-chart-line", transfer: "fa-right-left", rename: "fa-user-pen", accountid: "fa-id-card", password: "fa-key", assignmgr: "fa-user-tie", assign: "fa-user-tie", settings: "fa-sliders", subaccount: "fa-sitemap", assigngroup: "fa-layer-group", leverage: "fa-gauge-high", mclevel: "fa-triangle-exclamation", spreadmarkup: "fa-arrows-left-right" }; return m[act.kind] || "fa-circle"; }
  function actPrimary() {
    if (!act) return { label: "Confirm", color: BUY, fg: "#04140e" };
    const m: any = {
      money: { label: "Apply", color: "#2563eb", fg: "#fff" }, transfer: { label: "Confirm Transfer", color: "#2563eb", fg: "#fff" },
      rename: { label: "Save Changes", color: "#2563eb", fg: "#fff" }, accountid: { label: "Change", color: "#2563eb", fg: "#fff" },
      subaccount: { label: "Create", color: "#2563eb", fg: "#fff" }, mclevel: { label: "Save", color: SELL, fg: "#fff" },
      spreadmarkup: { label: "Save", color: "#2563eb", fg: "#fff" },
    };
    return m[act.kind] || { label: "Confirm", color: BUY, fg: "#04140e" };
  }
  const acctBal = (c: any) => c ? (Number(c.deposit || 0) + Number(c.pnl || 0) - Number(c.withdrawal || 0)) : 0;
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
      const settleTo = aform.settleTo || undefined;
      const bonusExpiryAt = aform.bonusExpiryAt || undefined;
      url = "/api/admin/clients/" + id + "/balance"; body = { type: act.finType, amount: amt, description: desc, appliedAt, settleTo, bonusExpiryAt };
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
    else if (act.kind === "assignmgr") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assignManager", managerId: aform.managerId || null }; }
    else if (act.kind === "settings") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", leverage: Number(aform.leverage ?? act.acc.leverage), mcLevel: Number(aform.mcLevel ?? act.acc.mcLevel), doNotLiquidate: aform.doNotLiquidate ?? act.acc.doNotLiquidate, currency: aform.currency ?? act.acc.currency, swapFree: !!(aform.swapFree ?? act.acc.swapFree) }; }
    else if (act.kind === "subaccount") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "subAccount", name: aform.name || "", type: aform.subType || "LIVE", leverage: Number(aform.subLev) || act.acc.leverage, currency: aform.subCcy || act.acc.currency, deposit: Number(aform.subDep) || 0 }; }
    else if (act.kind === "assigngroup") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assignGroup", groupId: aform.groupId || null }; }
    else if (act.kind === "assign") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "assign", managerId: (aform.managerId ?? act.acc.managerId) || null, groupId: (aform.groupId ?? act.acc.groupId) || null }; }
    else if (act.kind === "leverage") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", leverage: Number(aform.leverage ?? act.acc.leverage) }; }
    else if (act.kind === "mclevel") { url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", mcLevel: Number(aform.mcLevel ?? act.acc.mcLevel), doNotLiquidate: aform.doNotLiquidate ?? act.acc.doNotLiquidate }; }
    else if (act.kind === "spreadmarkup") { const smType = aform.spreadMarkupType ?? act.acc.spreadMarkupType ?? "FIXED"; url = "/api/admin/clients/" + id + "/manage"; body = { action: "settings", spreadMarkup: smType === "FLOATING" ? 0 : Number(aform.spreadMarkup ?? act.acc.spreadMarkup ?? 0), spreadMarkupType: smType, spreadMarkupMax: 0 }; }
    else return;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setAct(null); loadAll();
  }
  async function doStatus(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", locked: !acc.locked }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDeactivate(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deactivate", deactivated: !acc.deactivated }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDNL(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", doNotLiquidate: !acc.doNotLiquidate }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doStatusAll(acc: any, lock: boolean) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "statusAll", locked: lock }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function doDeactivateAll(acc: any, deactivate: boolean) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deactivateAll", deactivated: deactivate }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  function doClearPin(acc: any) { setMenu(null); askConfirm(`Reset (clear) the PIN for ${acc.login}? They can set a new one next login.`, async () => { const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearPin" }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else setOk("PIN reset"); }, false); }
  async function doPool(acc: any) { setMenu(null); const r = await fetch("/api/admin/clients/" + acc.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pool", promote: !acc.isPool }) }); const d = await r.json(); if (!d.ok) setErr(d.error || "Failed"); else loadAll(); }
  async function modifyTrade(id: string, fields: any) { const r = await fetch("/api/desk/trades/" + id + "/modify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Modify failed"); return; } setInlineEdit((e) => { const n = { ...e }; delete n[id]; return n; }); loadAll(); }
  async function uploadKyc() { setErr(""); setKycUpMsg(""); if (!kycUploadFor || !kycUploadFile) { setErr("Select the front side"); return; } if (!kycBackFile) { setErr("Select the back side — both front and back are required"); return; } const fd = new FormData(); fd.append("login", kycUploadFor.login); fd.append("docType", kycUploadType); fd.append("file", kycUploadFile); fd.append("back", kycBackFile); const r = await fetch("/api/admin/kyc/upload", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false })); if (!r.ok) { setErr(r.error || "Upload failed"); return; } setKycUpMsg("Uploaded successfully"); setKycUploadFile(null); setKycBackFile(null); setTimeout(() => { setKycUploadFor(null); setKycUpMsg(""); }, 1500); loadAll(); }

  function openPos(kind: string, t: any) {
    setPosMenu(null); setErr("");
    if (kind === "modify") setPform({ sl: t.sl || 0, tp: t.tp || 0 });
    else if (kind === "manual") { const now = new Date(); const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); setPform({ closePrice: prices[t.symbol] ?? Number(t.openPrice), closedAt: tz, follow: true }); }
    else setPform({ lots: Number((Number(t.lots) / 2).toFixed(2)) || 0.01 });
    setPos({ kind, t });
  }
  async function submitPos() {
    if (!pos) return; setErr("");
    const t = pos.t; let url = ""; let body: any = {};
    if (pos.kind === "modify") { url = "/api/desk/trades/" + t.id + "/modify"; body = { sl: Number(pform.sl) || 0, tp: Number(pform.tp) || 0 }; }
    else if (pos.kind === "manual") { url = "/api/desk/trades/" + t.id + "/close"; body = { price: Number(pform.closePrice) || (prices[t.symbol] ?? Number(t.openPrice)), closedAt: pform.closedAt ? new Date(pform.closedAt).toISOString() : undefined }; }
    else { const lots = Number(pform.lots); if (!lots || lots <= 0 || lots >= Number(t.lots)) { setErr("Enter lots between 0 and " + t.lots); return; } url = "/api/desk/trades/" + t.id + "/partial"; body = { lots, price: prices[t.symbol] ?? t.openPrice }; }
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setPos(null); loadAll();
  }
  function openModal(kind: any) { setTopMenu(""); setErr(""); setOk(""); setForm({ type: "LIVE", leverage: 100, currency: "USD" }); setDupWarn(null); setModalMin(false); setModal(kind); }
  async function submit(url: string, body: any, label: string) { setErr(""); setOk(""); const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } setOk(label + " created"); setModal(""); loadAll(); }
  const f = (k: string, v: any) => {
    setForm((o: any) => ({ ...o, [k]: v }));
    if (k === "email") {
      setDupWarn(null);
      clearTimeout(dupTimerRef.current);
      const email = String(v || "").trim();
      if (email.includes("@")) {
        dupTimerRef.current = setTimeout(() => {
          fetch("/api/admin/clients?check=" + encodeURIComponent(email))
            .then((r) => r.json())
            .then((d) => { if (d.ok && d.exists) setDupWarn({ name: d.name, accounts: d.accounts }); })
            .catch(() => {});
        }, 600);
      }
    }
  };
  // Preview the Live ID that a new pool account will get (peek, no consume).
  const [poolLogin, setPoolLogin] = useState("");
  async function fetchNextLogin(type: string) { try { const d = await fetch("/api/admin/next-login?type=" + (type || "LIVE")).then((r) => r.json()); if (d.ok) setPoolLogin(d.login); } catch {} }
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
    askDelete("Delete this history row? Balance will be reversed.", async () => {
      const r = await fetch("/api/desk/history/" + h.id, { method: "DELETE" }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { setErr(r.error || "Delete failed"); return; }
      loadAll(); loadAccHistory();
    });
  }
  function delHistBulk() {
    const ids = Object.keys(histSel).filter((k) => histSel[k]);
    if (!ids.length) return;
    askDelete(`Delete ${ids.length} row(s)? Balances will be reversed.`, async () => {
      const r = await fetch("/api/desk/history/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { setErr(r.error || "Bulk delete failed"); return; }
      setHistSel({}); loadAll(); loadAccHistory();
    });
  }
  function openHEdit(h: any) { setHEdit({ ...h, amt: Math.abs(Number(h.pnl) || 0) }); }
  async function submitHEdit() {
    if (!hEdit) return; setErr("");
    const isFin = String(hEdit.id).startsWith("F");
    const body: any = isFin
      ? { amount: Number(hEdit.amt), description: hEdit.desc }
      // Only send explicit pnl when admin manually edited it — otherwise backend auto-recalculates from closePrice
      : { closePrice: Number(hEdit.closePrice), ...(!hEdit._pnlAuto ? { pnl: Number(hEdit.pnl) } : {}), sl: Number(hEdit.sl), tp: Number(hEdit.tp) };
    const r = await fetch("/api/desk/history/" + hEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setErr(r.error || "Save failed"); return; }
    setHEdit(null); loadAll(); loadAccHistory();
  }
  async function openMT(acc: any) {
    setMenu(null); setMtMin(false);
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
    // Use the LIVE price only when "follow live" is on; otherwise honour the price
    // (and date/time) the user typed — so a manual/back-dated trade opens exactly
    // at the entered price, not the current market.
    const openPrice = (mt.follow === false && Number(mt.openPrice) > 0) ? Number(mt.openPrice) : (prices[mt.symbol] ?? Number(mt.openPrice) ?? 0);
    const body = { accountId: mt.acc.id, symbol: mt.symbol, type: mt.type, lots: Number(mt.lots), sl: Number(mt.sl) || 0, tp: Number(mt.tp) || 0, openPrice, openedAt: mt.date ? new Date(mt.date).toISOString() : undefined };
    const r = await fetch("/api/desk/manual-trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setMt(null); loadAll();
  }
  async function openSymOv(acc: any) {
    setMenu(null);
    setSymOvTab("access");
    const r = await fetch("/api/admin/clients/" + acc.id + "/symbols").then((x) => x.json()).catch(() => ({ ok: false }));
    const disabled: Record<string, boolean> = {};
    if (r.ok && Array.isArray(r.disabled)) r.disabled.forEach((s: string) => (disabled[s] = true));
    const spreadOverrides: Record<string, string> = {};
    if (r.ok && r.spreadOverrides) Object.entries(r.spreadOverrides).forEach(([sym, pips]) => { spreadOverrides[sym] = String(pips); });
    setSymOv({ acc, disabled, spreadOverrides, q: "" });
  }

  function switchLayout(l: number) {
    setLayout(l);
    if (l > 1) {
      setOpenCharts((prev) => {
        if (prev.length >= l) return prev;
        const existing = new Set(prev);
        const fills = symbols.filter((s) => !existing.has(s.symbol)).slice(0, l - prev.length).map((s) => s.symbol);
        return [...prev, ...fills];
      });
    }
  }
  function setActive(i: number) { setActiveChart(i); if (openCharts[i]) setSelSym(openCharts[i]); }
  function setTile(sym: string) { setOpenCharts((prev) => { if (prev.length === 0) return [sym]; const n = prev.slice(); n[activeChart] = sym; return n; }); setSelSym(sym); }
  // User picked a symbol inside a specific chart tile's dropdown → switch that tile.
  function replaceTile(i: number, sym: string) { setOpenCharts((prev) => { if (!prev.length) return [sym]; if (prev[i] === sym) return prev; const n = prev.slice(); n[i] = sym; return n; }); if (i === activeChart) setSelSym(sym); }
  function addChart(sym: string) { setOpenCharts((prev) => prev.indexOf(sym) !== -1 ? prev : prev.concat([sym])); }
  function removeChart(i: number) { setOpenCharts((prev) => prev.filter((_, j) => j !== i)); setActiveChart((a) => a >= i && a > 0 ? a - 1 : a); }
  function openTicket(sym: string) { setTicket(sym); setTform({ vol: lot, sl: 0, tp: 0, type: "Market", price: 0 }); }

  const accOpen = selAcc ? open.filter((o) => o.accountLogin === selAcc.login) : [];
  const accPending = selAcc ? pendingOrders.filter((o) => o.accountLogin === selAcc.login) : [];
  const balOfFn = (a: any) => a ? Number(a.deposit) + Number(a.pnl) - Number(a.withdrawal) : 0;
  const floating = accOpen.reduce((s, p) => s + pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)), 0);
  const balance = balOfFn(selAcc);
  const equity = balance + floating + Number(selAcc?.credit || 0) + Number(selAcc?.bonus || 0) + Number(selAcc?.insurance || 0);
  const used = selAcc ? (() => {
    // hedged (net) margin: net BUY−SELL lots per symbol, charge margin on |net| only
    const net: Record<string, number> = {};
    for (const p of accOpen) net[p.symbol] = (net[p.symbol] || 0) + (p.type === "BUY" ? 1 : -1) * Number(p.lots);
    let m = 0;
    for (const s in net) { const nl = Math.abs(net[s]); if (nl < 1e-9) continue; const pr = prices[s] ?? (accOpen.find((p) => p.symbol === s)?.openPrice ?? 0); let mg = (nl * csz(s) * pr) / (selAcc.leverage || 100); if (/JPY$/i.test(s)) mg = mg / 100; m += mg; }
    return m;
  })() : 0;
  const free = equity - used;
  const level = used > 0 ? (equity / used) * 100 : 0;

  const liveAccs = clients.filter((c) => !String(c.login).toUpperCase().startsWith("DEMO"));
  const demoAccs = clients.filter((c) => String(c.login).toUpperCase().startsWith("DEMO"));

  // Extra spread to overlay on market watch when a client is selected:
  // shows exactly what that client sees (symbol base + group markup + account markup)
  const deskViewLabel = selAcc ? `${selAcc.login} – ${selAcc.name || ""}` : null;
  const deskExtraSpread = (() => {
    if (!selAcc) return 0;
    const accMarkup = (selAcc.spreadMarkupType ?? "FLOATING") === "FIXED" ? Number(selAcc.spreadMarkup ?? 0) : 0;
    const grp = tradeGroups.find((g: any) => g.id === selAcc.groupId);
    const grpMarkup = grp ? ((grp.spreadType ?? "FLOATING") === "FIXED" ? Number(grp.spread ?? 0) : 0) : 0;
    return accMarkup + grpMarkup;
  })();
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

  const fmt = (v: number) => gmoney(v);
  const px = (sym: string) => (prices[sym] != null ? gpx(sym, prices[sym]) : "...");
  const dot = (c: string) => (<span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />);
  const inp = "ui-input mt-1 w-full bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]";
  const lab = "text-[10px] text-[var(--muted)]";
  const flab = "mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";
  const mi = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--soft)] transition-colors";
  const subi = "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-[var(--soft)] transition-colors";
  const mIco = (icon: string, color?: string) => <i className={"fa-solid " + icon} style={{ width: 13, fontSize: 11, textAlign: "center", color: color || "var(--muted)" }} />;
  // Flyout submenu — opens right; if near right edge opens left instead
  const flyRight = menu ? menu.x + 240 + 220 < (typeof window !== "undefined" ? window.innerWidth : 9999) : true;
  const flyCls = "absolute top-0 ml-1 min-w-[210px] overflow-hidden rounded-xl border py-1 z-[70] " + (flyRight ? "left-full" : "right-full mr-1");
  const flySty: React.CSSProperties = { background: "color-mix(in srgb, var(--panel) 96%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", boxShadow: "0 20px 50px -12px rgba(0,0,0,0.45)", animation: "menuPop 0.12s cubic-bezier(.16,1,.3,1)" };
  const tgl = (on: boolean) => "rounded border border-[var(--border)] px-2 py-1 " + (on ? "" : "opacity-50");
  function toggleCat(c: string) { setCollapsed((o) => ({ ...o, [c]: !o[c] })); }
  function togglePanel(k: "nav" | "mw" | "toolbox") { setPanels((p) => ({ ...p, [k]: !p[k] })); }
  const stTag = (txt: string, col: string) => (<span className="rounded px-1 text-[8px] font-semibold" style={{ background: col + "22", color: col }}>{txt}</span>);
  const sIco = (icon: string, col: string, title: string) => (<i className={"fa-solid " + icon} title={title} style={{ fontSize: 9.5, color: col }} />);
  const acctRow = (c: any) => (
    <button key={c.id} onClick={() => setSelAcc(c)} onContextMenu={(e) => { e.preventDefault(); setSelAcc(c); setMenu({ x: e.clientX, y: e.clientY, acc: c }); }}
      className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left" style={selAcc?.id === c.id ? { background: "var(--soft)", color: GOLD } : undefined}>
      {(() => { const on = presenceOnline(c.user?.lastSeenAt); return <span className="inline-block h-2 w-2 shrink-0 rounded-full" title={on ? "Online" : "Offline"} style={{ background: on ? "#22c55e" : "#5b6577", boxShadow: on ? "0 0 6px #22c55e" : "none" }} />; })()}<span className="flex-1 truncate">{c.login} - {titleCaseName(c.name)}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/* device icon only — left dot already encodes online/offline */}
        {c.user?.lastDevice && sIco(String(c.user.lastDevice).toLowerCase() === "mobile" ? "fa-mobile-screen-button" : String(c.user.lastDevice).toLowerCase() === "tablet" ? "fa-tablet-screen-button" : "fa-laptop", "#8b97a8", c.user.lastDevice)}
        {/* Deactivated only — active is the default, no extra dot needed */}
        {c.deactivated ? sIco("fa-ban", "#8b97a8", "Deactivated") : null}
        {/* Locked */}
        {c.locked ? sIco("fa-lock", SELL, "Locked") : null}
        {/* Do Not Liquidate */}
        {c.doNotLiquidate ? sIco("fa-hand", GOLD, "Do Not Liquidate (DNL)") : null}
        {/* KYC — only for live root (non-sub) accounts */}
        {c.type === "LIVE" && !isSubAcc(c) && (c.kycStatus === "APPROVED"
          ? sIco("fa-id-card", BUY, "KYC Verified")
          : c.kycStatus === "PENDING"
          ? sIco("fa-id-card", GOLD, "KYC Pending")
          : sIco("fa-id-card", "#6b7280", "KYC Not Verified"))}
      </span>
    </button>
  );

  const shown: { sym: string; i: number }[] = layout === 1 ? (openCharts[activeChart] ? [{ sym: openCharts[activeChart], i: activeChart }] : []) : openCharts.slice(0, layout).map((sym, i) => ({ sym, i }));
  // MT5 model: price = BID. ask = price + spread. FLOATING uses live exchange spread.
  return (
    <div style={{ ...(theme === "dark" ? ADSS_DARK : ADSS_LIGHT), fontFamily: ADSS_FONT }} className="relative flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {trial && (
        <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-semibold" style={{ background: trial.daysLeft <= 5 ? "rgba(246,70,93,0.16)" : "rgba(234,179,8,0.16)", color: trial.daysLeft <= 5 ? "#f6465d" : "#eab308" }}>
          <i className="fa-solid fa-clock" /> Demo trial — {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left. Contact sales to keep your platform.
        </div>
      )}
      <div className="flex items-stretch border-b border-[var(--border)] bg-[var(--panel)] text-[11px]">
        <div className="flex items-center gap-2 border-r border-[var(--border)] px-3 py-1.5" style={{ width: panels.nav ? navW + 1 : undefined }}>
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-4 w-4 rounded object-contain" /> : <span className="inline-block h-4 w-4 rounded" style={{ background: "var(--accent)" }} />}<b className="font-medium">{brand.name || "Platform"}</b>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>{isManager ? "Manager Terminal" : "Back Office"}</span>
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
            const panel = "ui-pop absolute left-0 z-50 mt-1 w-52 overflow-hidden rounded-xl border py-1";
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
                    {!isManager && can("manageManagers") && dItem(() => { setMgrModal(true); }, "fa-users-gear", "Managers")}
                    {!isManager && dItem(() => { setPmModal(true); }, "fa-credit-card", "Payment Methods")}
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
                    {dItem(() => switchLayout(1), "fa-square", "Single Chart", undefined, layout === 1)}
                    {dItem(() => switchLayout(2), "fa-table-columns", "Split (1 | 1)", undefined, layout === 2)}
                    {dItem(() => switchLayout(4), "fa-table-cells-large", "Grid (4 Charts)", undefined, layout === 4)}
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
                    {can("exportPdf") && dItem(() => { if (!selAcc) { setErr("Select an account first"); return; } setStmtPreset("all"); setStmtFrom(""); setStmtTo(""); setStmtModal(true); }, "fa-file-pdf", "Download Statement", "#ef4444")}
                    {can("exportPdf") && dItem(() => { if (!selAcc) { setErr("Select an account first"); return; } setStmtEmail(""); setStmtMsg(""); setStmtPreset("all"); setStmtFrom(""); setStmtTo(""); setStmtEmailModal(true); }, "fa-envelope", "Email Statement", "#3b82f6")}
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
              <div className="ui-pop absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-auto rounded-xl border shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                <div className="sticky top-0 flex items-center justify-between border-b px-3 py-2" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                  <span className="text-[11px] font-semibold">Notifications</span>
                  {notifs.length > 0 && <button onClick={async () => { try { await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); setNotifUnread(0); setNotifs((n: any[]) => n.map((x) => ({ ...x, read: true }))); } catch {} }} className="text-[10px]" style={{ color: "var(--accent)" }}>Mark all read</button>}
                </div>
                {notifs.length === 0 ? <div className="px-3 py-6 text-center text-[11px] text-[var(--muted)]"><i className="fa-solid fa-bell-slash mb-1 block text-lg opacity-40" />No notifications</div>
                  : notifs.map((n: any) => { const ic = iconForNotification(n); return (
                    <div key={n.id} className="flex items-start gap-2 border-b px-3 py-2 last:border-0" style={{ borderColor: "var(--border)" }}>
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: ic.color + "22", color: ic.color }}><i className={"fa-solid " + ic.icon + " text-[10px]"} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium">{n.title}</div>
                        {n.body && <div className="mt-0.5 whitespace-pre-line text-[10px] text-[var(--muted)]">{n.body}</div>}
                        <div className="mt-0.5 text-[9px] text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ); })}
              </div></>)}
          </div>
          <button onClick={() => { setAdminTotpErr(""); setAdminTotpCode(""); if (adminTotpEnabled) setAdminTotpModal("disable"); else adminOpenTotpSetup(); }} disabled={adminTotpBusy} title={adminTotpEnabled ? "2FA enabled – click to disable" : "Set up 2FA"} className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--soft)] disabled:opacity-50" style={adminTotpEnabled ? { color: BUY } : undefined}><i className="fa-solid fa-lock" /></button>
          <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} className="rounded px-2 py-1 hover:bg-[var(--soft)]" style={{ color: SELL }} title="Logout"><i className="fa-solid fa-right-from-bracket" /></button>
        </div>
      </div>      {ok && <div className="px-3 py-1 text-[11px]" style={{ color: BUY }}>{ok}</div>}

      <div className="flex min-h-0 flex-1">
        {panels.nav && (<>
          <aside className="flex flex-col border-r border-[var(--border)] bg-[var(--panel)]" style={{ width: navW }}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5 text-[10px] font-bold tracking-wide text-[var(--text)]">NAVIGATOR<button onClick={() => togglePanel("nav")} aria-label="hide" className="text-[var(--muted)]">x</button></div>
            {/* Live / Demo tabs */}
            <div className="flex border-b border-[var(--border)] text-[10px]">
              <button onClick={() => setNavTab("live")} className="flex-1 py-1.5 font-semibold" style={navTab === "live" ? { color: BUY, borderBottom: `2px solid ${BUY}` } : { color: "var(--muted)" }}>LIVE ({liveAccs.length})</button>
              <button onClick={() => setNavTab("demo")} className="flex-1 py-1.5 font-semibold" style={navTab === "demo" ? { color: "var(--accent)", borderBottom: `2px solid var(--accent)` } : { color: "var(--muted)" }}>DEMO ({demoAccs.length})</button>
            </div>
            <div className="border-b border-[var(--border)] px-1.5 py-1">
              <input value={navSearch} onChange={(e) => setNavSearch(e.target.value)} name="nav-search-field" autoComplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.currentTarget.removeAttribute("readonly")} placeholder="Client ID / Name / Email" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] text-[var(--text)]" />
            </div>
            <div className="flex-1 overflow-auto p-1 text-[11px]">
              {(() => {
                const base = navTab === "live" ? liveAccs : demoAccs;
                const list = navSearch ? base.filter((c: any) => (c.login + " " + c.name + " " + (c.user?.email || c.email || "")).toLowerCase().includes(navSearch.toLowerCase())) : base;
                if (!list.length) return <div className="px-2 py-3 text-center text-[var(--muted)]">No {navTab} accounts.</div>;

                // Group by userId: the oldest account per user is the root; all others nest under it.
                // This works even for accounts without parentId set (legacy / created before auto-link).
                const userGroups: Record<string, any[]> = {};
                list.forEach((c: any) => { const uid = c.userId || c.id; (userGroups[uid] || (userGroups[uid] = [])).push(c); });
                const childMap: Record<string, any[]> = {};
                const primaryIdForUser: Record<string, string> = {};
                Object.entries(userGroups).forEach(([uid, accs]) => {
                  if (accs.length <= 1) return;
                  const sorted = [...accs].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                  primaryIdForUser[uid] = sorted[0].id;
                  childMap[sorted[0].id] = sorted.slice(1);
                });
                const isRoot = (c: any) => { const uid = c.userId || c.id; return !primaryIdForUser[uid] || primaryIdForUser[uid] === c.id; };

                // Render a root account + its nested sub-accounts (no nesting when searching)
                const acctBlock = (c: any) => {
                  const kids = !navSearch ? (childMap[c.id] || []) : [];
                  if (!kids.length) return acctRow(c);
                  const key = "par-" + c.id;
                  return (
                    <div key={c.id}>
                      <div className="flex items-center">
                        <button onClick={(e) => { e.stopPropagation(); toggleCat(key); }} className="flex w-5 shrink-0 items-center justify-center self-stretch" style={{ color: "var(--muted)" }}>
                          <i className={"fa-solid " + (collapsed[key] ? "fa-chevron-right" : "fa-chevron-down")} style={{ fontSize: 7 }} />
                        </button>
                        <div className="min-w-0 flex-1">{acctRow(c)}</div>
                      </div>
                      {!collapsed[key] && (
                        <div className="ml-5 flex flex-col gap-0.5 border-l pl-1" style={{ borderColor: "var(--border)" }}>
                          {kids.map((ch: any) => acctRow(ch))}
                        </div>
                      )}
                    </div>
                  );
                };

                // 3-level hierarchy: manager > group > client (same as before, now with sub-account nesting)
                const direct = list.filter((c: any) => !c.manager && !c.group);
                const grpOwner: Record<string, string | null> = {};
                tradeGroups.forEach((g: any) => { grpOwner[g.id] = g.managerId || null; });
                const grpRows: Record<string, any[]> = {};
                const mgrDirect: Record<string, any[]> = {};
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
                // Include ALL managers (even those with no clients yet) in the LIVE tab,
                // so a newly created manager shows in the terminal immediately.
                const managerIds = Array.from(new Set([...Object.keys(mgrDirect), ...Object.keys(mgrGroups), ...(navTab === "live" && !navSearch ? managers.map((m: any) => m.id) : [])]));

                const header = (key: string, label: string, icon: string, color: string, count: number, pad = "") => (
                  <button onClick={() => toggleCat(key)} className={"flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-semibold " + pad} style={{ color }}>
                    <i className={"fa-solid " + (collapsed[key] ? "fa-chevron-right" : "fa-chevron-down")} style={{ fontSize: 8 }} />
                    <i className={"fa-solid " + icon} style={{ fontSize: 10 }} />
                    <span className="flex-1 truncate text-left">{label}</span>
                    <span className="rounded px-1.5" style={{ background: color + "22" }}>{count}</span>
                  </button>
                );
                // Count roots only for header badge (sub-accounts counted under parent)
                const rootCount = (arr: any[]) => arr.filter(isRoot).length;
                const groupSection = (gid: string, nested = false) => {
                  const g = tradeGroups.find((x: any) => x.id === gid);
                  return (
                    <div key={"grp-" + gid} className={nested ? "" : "mt-0.5"}>
                      <button onClick={() => toggleCat("grp-" + gid)} onContextMenu={(e) => { e.preventDefault(); if (g) setGrpCtx({ x: e.clientX, y: e.clientY, g }); }}
                        className={"flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-semibold"} style={{ color: "var(--accent)" }}>
                        <i className={"fa-solid " + (collapsed["grp-" + gid] ? "fa-chevron-right" : "fa-chevron-down")} style={{ fontSize: 8 }} />
                        <i className="fa-solid fa-folder" style={{ fontSize: 10 }} />
                        <span className="flex-1 truncate text-left">{grpName(gid)}</span>
                        <span className="rounded px-1.5" style={{ background: "var(--accent)22" }}>{grpRows[gid].length}</span>
                      </button>
                      {!collapsed["grp-" + gid] && <div className="flex flex-col gap-0.5 pl-2">{grpRows[gid].filter(isRoot).map(acctBlock)}</div>}
                    </div>
                  );
                };
                return (
                  <div className="flex flex-col gap-0.5">
                    {direct.length > 0 && (<>
                      <div className="px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{navTab === "live" ? "Live" : "Demo"} Accounts</div>
                      {direct.filter(isRoot).map(acctBlock)}
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
                              {loose.filter(isRoot).map(acctBlock)}
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
          {/* Chart tabs row \u2014 open symbol tabs with \u00d7 close + add button */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1" style={{ scrollbarWidth: "none" }}>
            {openCharts.map((sym, i) => (
              <div key={sym + i} onClick={() => setActive(i)} className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold select-none" style={{ background: i === activeChart ? "rgba(41,98,255,0.15)" : "transparent", color: i === activeChart ? "var(--accent)" : "var(--muted)", border: `1px solid ${i === activeChart ? "rgba(41,98,255,0.3)" : "transparent"}` }}>
                <span>{sym}</span>
                <button onClick={(e) => { e.stopPropagation(); removeChart(i); }} className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] hover:bg-[var(--soft)]" style={{ color: "var(--muted)", lineHeight: 1 }}>{"\u00d7"}</button>
              </div>
            ))}
            {symbols.some((s) => !openCharts.includes(s.symbol)) && (
              <button onClick={() => { const next = symbols.find((s) => !openCharts.includes(s.symbol)); if (next) addChart(next.symbol); }} className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold hover:bg-[var(--soft)] select-none" style={{ color: "var(--muted)" }} title="Add chart">
                + Add
              </button>
            )}
          </div>
          <div className="grid min-h-0 flex-1 gap-px bg-[var(--border)]" style={{ gridTemplateColumns: layout === 1 ? "1fr" : "1fr 1fr", gridTemplateRows: layout === 4 ? "1fr 1fr" : "1fr" }}>
            {shown.length === 0 ? <div className="flex items-center justify-center text-[var(--muted)]">No chart open.</div> : shown.map(({ sym, i }) => (
              <div key={"tile" + i} className="relative min-h-0 overflow-hidden bg-[var(--bg)]" onClick={() => setActive(i)}>
                {/* Buy/Sell overlay \u2014 top-left, positioned below TV header (~38px) + left sidebar (~40px) */}
                {(() => {
                  const p = prices[sym]; const d = dg(sym); const pip = pipOf(d);
                  const isFloatO = (adminSymTypes[sym] ?? "FLOATING") === "FLOATING";
                  const spO = (isFloatO ? (liveSpreadPips[sym] ?? adminSymSpreads[sym] ?? 0) : (adminSymSpreads[sym] ?? 0)) + deskExtraSpread;
                  const bid = p != null ? gnum(p, d) : "\u2014";
                  const ask = p != null ? gnum(p + spO * pip, d) : "\u2014";
                  return (
                    <div style={{ position: "absolute", top: 36, left: 68, zIndex: 10 }} onClick={(e) => e.stopPropagation()}>
                      {showBuySell ? (
                        <div style={{ display: "flex", gap: 5, alignItems: "center", background: "rgba(10,13,20,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "5px 7px", boxShadow: "0 4px 18px rgba(0,0,0,0.45)" }}>
                          <button onClick={() => place(sym, "SELL")} className="hover:brightness-110 active:scale-95" style={{ background: SELLBTN, color: "#fff", border: "none", borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 700, lineHeight: 1, cursor: "pointer", boxShadow: `0 2px 8px ${SELLBTN}66`, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 62 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>SELL</span>
                            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.02em" }}>{bid}</span>
                          </button>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.45)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Lots</span>
                            <input type="number" step="0.01" min="0.01" value={lot} onChange={(e) => setLot(Number(e.target.value))} onClick={(e) => e.stopPropagation()} style={{ width: 52, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", borderRadius: 6, padding: "4px 5px", fontSize: 12, fontWeight: 700, fontFamily: "monospace", textAlign: "center", outline: "none" }} title="Lots" />
                          </div>
                          <button onClick={() => place(sym, "BUY")} className="hover:brightness-110 active:scale-95" style={{ background: BUYBTN, color: "#fff", border: "none", borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 700, lineHeight: 1, cursor: "pointer", boxShadow: `0 2px 8px ${BUYBTN}66`, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 62 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>BUY</span>
                            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.02em" }}>{ask}</span>
                          </button>
                          <button onClick={() => setShowBuySell(false)} title="Hide" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.5)", borderRadius: 6, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, flexShrink: 0 }}>
                            <i className="fa-solid fa-chevron-left" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setShowBuySell(true)} title="Show trade panel" style={{ background: "rgba(10,13,20,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                          <i className="fa-solid fa-right-left" style={{ fontSize: 9 }} /> Trade
                        </button>
                      )}
                    </div>
                  );
                })()}
                {(() => {
                  const pos = [
                    ...(selAcc ? open.filter((o) => o.symbol === sym && o.accountLogin === selAcc.login) : []).map((o) => ({ id: o.id, ticket: o.ticket, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                    ...(selAcc ? pendingOrders.filter((o) => o.symbol === sym && o.accountLogin === selAcc.login) : []).map((o) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                  ];
                  const isFloatSym = (adminSymTypes[sym] ?? "FLOATING") === "FLOATING";
                  const cfgSp = adminSymSpreads[sym] || 0; const liveSp = liveSpreadPips[sym];
                  const spPips = (isFloatSym ? (liveSp != null && liveSp > 0 ? liveSp : cfgSp) : cfgSp) + deskExtraSpread;
                  return <KLineProChart symbol={sym} tf={tf} theme={theme} digits={dg(sym)} symbols={symbols} positions={pos} spreadPips={spPips} onSymbolChange={(sm) => replaceTile(i, sm)} showBuiltinOHLC={false} onTfChange={setTf} />;
                })()}
              </div>
            ))}
          </div>
        </div>

        {panels.mw && (<>
          <div onMouseDown={(e) => dragX(e, "mw")} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]" />
          <aside className="flex flex-col border-l border-[var(--border)] bg-[var(--panel)]" style={{ width: mwW }}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5 text-[10px] font-bold tracking-wide text-[var(--text)]">MARKET WATCH<button onClick={() => togglePanel("mw")} aria-label="hide" className="text-[var(--muted)]">x</button></div>
            {deskViewLabel && (
              <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2 py-1" style={{ background: "rgba(37,99,235,0.08)" }}>
                <i className="fa-solid fa-eye text-[9px]" style={{ color: "var(--accent)" }} />
                <span className="text-[9px] truncate" style={{ color: "var(--accent)" }}>Viewing as: {deskViewLabel}</span>
                {deskExtraSpread > 0 && <span className="ml-auto text-[9px] shrink-0" style={{ color: "var(--muted)" }}>+{deskExtraSpread}p markup</span>}
              </div>
            )}
            <DeskMarketWatch symbols={symbols} selSym={selSym} onPick={setTile}
              disabledSyms={symPerm?.disabled || []}
              onCategoryEdit={(cat, syms) => { const first = syms[0]; setCatEdit({ cat, syms, spread: adminSymSpreads[first] ?? 0, spreadType: adminSymTypes[first] ?? "FLOATING", spreadMax: adminSymMax[first] ?? 0 }); }}
              symbolSpreads={adminSymSpreads} symbolTypes={adminSymTypes} groupSpread={deskExtraSpread} saDefaultSpreads={saDefaultSpreads} />
          </aside>
        </>)}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[11px] font-bold" style={{ color: theme === "dark" ? "#facc15" : "var(--muted)" }}>
        <span>Balance: <span className="text-[var(--text)]">{selAcc ? fmt(balance) : "--"}</span></span>
        <span>Equity: <span style={{ color: !selAcc ? "var(--text)" : equity >= balance ? BUY : SELL }}>{selAcc ? fmt(equity) : "--"}</span></span>
        <span>Margin: <span className="text-[var(--text)]">{selAcc ? fmt(used) : "--"}</span></span>
        <span>Free Margin: <span className="text-[var(--text)]">{selAcc ? fmt(free) : "--"}</span></span>
        <span>Margin Level: <span style={{ color: !selAcc || !level ? "var(--muted)" : level >= 200 ? "#22c55e" : level >= 150 ? "#facc15" : level >= 100 ? "#f97316" : SELL }}>{selAcc && level ? level.toFixed(1) + "%" : "--"}</span></span>
        <span>Profit: <span style={{ color: floating >= 0 ? BUY : SELL }}>{selAcc ? (floating >= 0 ? "+" : "-") + fmt(Math.abs(floating)) : "--"}</span></span>
        {selAcc && <span>MC: <span style={{ color: Number(selAcc.mcLevel) > 0 ? SELL : "var(--muted)" }}>{Number(selAcc.mcLevel) > 0 ? selAcc.mcLevel + "%" : "Off"}</span></span>}
        {selAcc && <span>DNL: <span style={{ color: selAcc.doNotLiquidate ? GOLD : "var(--muted)" }}>{selAcc.doNotLiquidate ? "On" : "Off"}</span></span>}
        <span>{selAcc ? selAcc.login + " - " + titleCaseName(selAcc.name) : "No account selected"}</span>
        <span style={{ color: "var(--muted)" }}>|</span>
        <span>Off: <span style={{ color: symDisabledCount > 0 ? SELL : "var(--muted)" }}>{symDisabledCount} sym</span></span>
        <span>Spread set: <span style={{ color: "var(--text)" }}>{Object.keys(adminSymTypes).filter((k) => adminSymTypes[k] === "FIXED").length}/{symbols.length}</span></span>
      </div>
      {err && !act && !modal && !ticket && <div className="px-3 py-1 text-[11px]" style={{ color: SELL }}>{err}</div>}

      {panels.toolbox && (<>
        <div onMouseDown={dragY} className="h-1 cursor-row-resize bg-[var(--border)] hover:bg-[var(--accent)]" />
        <div className="flex shrink-0 flex-col" style={{ height: tbH }}>
          <div className="flex items-end gap-1 border-b border-[var(--border)] px-2 pt-1">
            <div className="flex flex-1 items-end gap-0.5 overflow-auto">
              {TABS.filter(([k]) =>
                tabState[k] &&
                (k !== "audit"    || can("viewAudit")) &&
                (k !== "copy"     || (features.copyTrading !== false && perms.copyTrading !== false)) &&
                (k !== "signals"  || (features.copyTrading !== false && perms.copyTrading !== false)) &&
                (k !== "referral" || features.referralProgram !== false)
              ).map(([k, lbl]) => {
                const active = tab === k;
                return (
                  <div key={k} onClick={() => setTab(k)} className="group relative flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={active
                      ? { background: "var(--panel)", color: "var(--accent)", border: "1px solid var(--border)", borderBottom: "1px solid var(--panel)", marginBottom: "-1px", boxShadow: "0 -2px 8px -4px rgba(0,0,0,0.25)" }
                      : { background: "color-mix(in srgb, var(--border) 30%, transparent)", color: "var(--muted)", border: "1px solid transparent" }}>
                    {active && <span className="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
                    {lbl}{k === "trade" ? " (" + accOpen.length + (accPending.length ? " + " + accPending.length + "p" : "") + ")" : ""}
                    {tabCloseX && <button onClick={(e) => { e.stopPropagation(); setTabState((s) => ({ ...s, [k]: false })); }} className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]">{"\u00D7"}</button>}
                  </div>
                );
              })}
            </div>
            <button onClick={toggleTabCloseX} title={tabCloseX ? "Hide tab close (\u00D7) marks" : "Show tab close (\u00D7) marks"} className="pb-1 px-1.5 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-circle-xmark text-[11px]" style={{ opacity: tabCloseX ? 1 : 0.35 }} /></button>
            <button onClick={() => togglePanel("toolbox")} title="Close toolbox" className="pb-1 px-1.5 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-chevron-down text-[11px]" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3">
            {tab === "trade" && (() => {
              if (!selAcc) return <div className="flex h-full items-center justify-center text-[11px] italic" style={{ color: "var(--muted)" }}>Please select an account first.</div>;
              const tAllOn = accOpen.length > 0 && accOpen.every((p) => tradeSel[p.id]);
              const tToggleAll = () => { if (tAllOn) setTradeSel({}); else { const n: Record<string, boolean> = {}; accOpen.forEach((p) => (n[p.id] = true)); setTradeSel(n); } };
              const tSelIds = accOpen.filter((p) => tradeSel[p.id]).map((p) => p.id);
              const odt = (p: any) => { const v = p.openTime || p.openedAt || p.createdAt || p.time; return v ? new Date(v).toLocaleString() : "-"; };
              const oid = (p: any) => p.ticket ?? p.orderId ?? p.order ?? p.id;
              const thc = "px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
              return (
                <table className="w-full border-collapse text-[10px] [&_td]:border-b [&_td]:border-[color-mix(in_srgb,var(--border)_38%,transparent)] [&_td]:px-1.5 [&_th]:px-1.5">
                  <thead><tr className="border-b border-[var(--border)] sticky top-0 z-10 bg-[var(--panel)]">
                    <th className={thc}><input type="checkbox" checked={tAllOn} onChange={tToggleAll} /></th>
                    <SortTh tbl="trade" k="date" label="Date Time" cls={thc} /><SortTh tbl="trade" k="oid" label="Order ID" cls={thc} /><SortTh tbl="trade" k="symbol" label="Symbol" cls={thc} /><SortTh tbl="trade" k="type" label="Type" cls={thc} />
                    <SortTh tbl="trade" k="lots" label="Lots" align="right" cls={thc + " text-right"} /><SortTh tbl="trade" k="openPrice" label="Open Price" align="right" cls={thc + " text-right"} /><SortTh tbl="trade" k="sl" label="S/L" align="right" cls={thc + " text-right"} /><SortTh tbl="trade" k="tp" label="T/P" align="right" cls={thc + " text-right"} />
                    <SortTh tbl="trade" k="current" label="Current" align="right" cls={thc + " text-right"} /><SortTh tbl="trade" k="pnl" label="PnL" align="right" cls={thc + " text-right"} />{swapEnabled && <><th className={thc + " text-right"}>Swap</th><th className={thc + " text-right"}>Comm</th></>}<th className={thc + " text-right"}>Action</th>
                  </tr></thead>
                  <tbody>
                    {tSelIds.length > 0 && (<tr><td colSpan={14} className="px-2 py-1 space-x-1">
                      <button onClick={() => askConfirm("Close " + tSelIds.length + " trade(s)?", () => { tSelIds.forEach((id) => close(id)); setTradeSel({}); })} className="rounded px-2 py-0.5 text-[9px] font-medium" style={{ background: SELL, color: "#fff" }}>Close Selected ({tSelIds.length})</button>
                      {can("deleteTrades") && <button onClick={() => askConfirm("Delete " + tSelIds.length + " open trade(s)? This removes them entirely (no P/L realized).", () => delTradesBulk(tSelIds))} className="rounded px-2 py-0.5 text-[9px] font-medium" style={{ background: "var(--soft)", color: SELL, border: "1px solid rgba(224,82,96,0.4)" }}>Delete Selected ({tSelIds.length})</button>}
                    </td></tr>)}
                    {accOpen.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={14}>No open trades.</td></tr> : sortRows("trade", accOpen, {
                      date: (p) => { const v = p.openedAt || p.createdAt || p.openTime || p.time; return v ? new Date(v).getTime() : null; },
                      oid: (p) => oid(p), symbol: (p) => p.symbol, type: (p) => p.type, lots: (p) => Number(p.lots),
                      openPrice: (p) => Number(p.openPrice), sl: (p) => Number(p.sl), tp: (p) => Number(p.tp),
                      current: (p) => Number(prices[p.symbol] ?? p.openPrice), pnl: (p) => pnlOf(p, prices[p.symbol] ?? p.openPrice, csz(p.symbol)),
                    }).map((p) => {
                      const cur = prices[p.symbol] ?? p.openPrice;
                      const pl = pnlOf(p, cur, csz(p.symbol));
                      const ie = inlineEdit[p.id] || {};
                      const isEditing = !!inlineEdit[p.id];
                      const ei = (f: string, def: any) => ie[f] !== undefined ? ie[f] : def;
                      const setIe = (f: string, v: any) => setInlineEdit((e) => ({ ...e, [p.id]: { ...(e[p.id] || {}), [f]: v } }));
                      const tInp = "rounded border-0 bg-transparent text-[var(--text)] text-right px-1 py-0.5 text-[9px] w-16 outline-none focus:bg-[var(--soft)]";
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
                              : <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: (p.type === "BUY" ? BUY : SELL) + "22", color: p.type === "BUY" ? BUY : SELL }}>{p.type}</span>}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {isEditing ? <input type="number" step="0.01" min="0.01" className={tInp} value={ei("lots", p.lots)} onChange={(e) => setIe("lots", e.target.value)} /> : p.lots}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {isEditing ? <input type="number" step="0.00001" className={tInp} value={ei("openPrice", pxRaw(p.symbol, p.openPrice))} onChange={(e) => setIe("openPrice", e.target.value)} /> : pxFmt(p.symbol, p.openPrice)}
                          </td>
                          <td className="px-2 py-1 text-right" title={Number(p.trailingStop ?? 0) > 0 ? "Trailing Stop active" : undefined}>
                            {!isEditing && Number(p.trailingStop ?? 0) > 0 && <span className="mr-0.5 rounded px-0.5 text-[8px] font-bold" style={{ background: "#f59e0b22", color: "#f59e0b" }}>TSL</span>}
                            <input type="number" step="0.00001" className={tInp} placeholder="0" value={ei("sl", p.sl ? Number(p.sl).toFixed(dg(p.symbol)) : "")} onChange={(e) => { setIe("sl", e.target.value); }} />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input type="number" step="0.00001" className={tInp} placeholder="0" value={ei("tp", p.tp ? Number(p.tp).toFixed(dg(p.symbol)) : "")} onChange={(e) => { setIe("tp", e.target.value); }} />
                          </td>
                          <td className="px-2 py-1 text-right">{pxFmt(p.symbol, cur)}</td>
                          <td className="px-2 py-1 text-right"><span className="text-[10px] font-bold tabular-nums" style={{ color: pl >= 0 ? BUY : SELL }}>{(pl >= 0 ? "+" : "") + gnum(pl, 2)}</span></td>
                          {swapEnabled && <><td className="px-2 py-1 text-right" style={{ color: Number(p.swap ?? 0) >= 0 ? BUY : SELL }} title="Accumulated swap">{Number(p.swap ?? 0) !== 0 ? gnum(Number(p.swap), 2) : "—"}</td>
                          <td className="px-2 py-1 text-right" style={{ color: SELL }} title="Commission charged">{Number(p.commission ?? 0) !== 0 ? gnum(Number(p.commission), 2) : "—"}</td></>}
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {isEditing ? (<>
                              <button onClick={() => modifyTrade(p.id, { sl: ie.sl !== undefined ? Number(ie.sl) : Number(p.sl) || 0, tp: ie.tp !== undefined ? Number(ie.tp) : Number(p.tp) || 0, ...(ie.lots ? { lots: ie.lots } : {}), ...(ie.openPrice ? { openPrice: ie.openPrice } : {}), ...(ie.type ? { type: ie.type } : {}), ...(ie.openedAt ? { openedAt: ie.openedAt } : {}) })} className="mr-1 rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: BUY, color: "#fff" }}>Save</button>
                              <button onClick={() => setInlineEdit((e) => { const n = { ...e }; delete n[p.id]; return n; })} className="mr-1 rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: "var(--muted)" }}><i className="fa-solid fa-xmark" /></button>
                            </>) : (
                              <button onClick={() => setInlineEdit((e) => ({ ...e, [p.id]: { sl: p.sl ? Number(p.sl) : "", tp: p.tp ? Number(p.tp) : "" } }))} className="mr-1 rounded px-1.5 py-0.5 text-[9px]" title="Edit trade" style={{ background: "var(--soft)", color: "var(--accent)" }}>
                                <i className="fa-solid fa-pen" style={{ fontSize: 8 }} />
                              </button>
                            )}
                            <button onClick={() => close(p.id)} title="Close at market (instant)" className="mr-1 rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(224,82,96,0.15)", color: SELL, border: "1px solid rgba(224,82,96,0.3)" }}>
                              Close ×
                            </button>
                            <button onClick={() => openPos("manual", p)} title="Manual close (set close price & time)" className="mr-1 rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "var(--soft)", color: "var(--accent)", border: "1px solid var(--border)" }}>
                              Manual
                            </button>
                            {can("deleteTrades") && <button onClick={() => askConfirm("Delete this open trade entirely? No P/L is realized.", () => delTrade(p.id))} title="Delete trade" className="rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: SELL }}><i className="fa-solid fa-trash" style={{ fontSize: 8 }} /></button>}
                          </td>
                        </tr>);
                    })}
                    {accPending.length > 0 && (
                      <tr><td colSpan={14} className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
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
                        <td className="px-2 py-1 text-right" title={o.kind === "STOP_LIMIT" ? `Stop: ${pxFmt(o.symbol, o.price)} → Limit: ${pxFmt(o.symbol, o.stopLimit)}` : "Trigger price"}>
                          {pxFmt(o.symbol, o.price)} <span className="text-[8px] text-[var(--muted)]">{o.kind === "STOP_LIMIT" ? "stop" : "trig"}</span>
                          {o.kind === "STOP_LIMIT" && <><br /><span className="text-[8px]">{pxFmt(o.symbol, o.stopLimit)} <span className="text-[var(--muted)]">lmt</span></span></>}
                        </td>
                        <td className="px-2 py-1 text-right">{o.sl ? pxFmt(o.symbol, o.sl) : "-"}</td>
                        <td className="px-2 py-1 text-right">{o.tp ? pxFmt(o.symbol, o.tp) : "-"}</td>
                        <td className="px-2 py-1 text-right">{pxFmt(o.symbol, prices[o.symbol] ?? o.price)}</td>
                        <td className="px-2 py-1 text-right text-[var(--muted)]">pending</td>
                        <td className="px-2 py-1 text-right text-[var(--muted)]">—</td>
                        <td className="px-2 py-1 text-right whitespace-nowrap" title={o.comment || ""}>
                          {o.comment && <span className="mr-1 text-[var(--muted)]" title={o.comment}><i className="fa-solid fa-comment text-[8px]" /></span>}
                          <button onClick={() => cancelPending(o.id)} className="rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(224,82,96,0.15)", color: SELL, border: "1px solid rgba(224,82,96,0.3)" }}>Cancel ×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            {tab === "trade" && selAcc && accAlerts.length > 0 && (
              <div className="border-t border-[var(--border)] px-3 py-2">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#f59e0b" }}><i className="fa-solid fa-bell mr-1" />Price Alerts ({accAlerts.filter((a) => !a.triggered).length} active, {accAlerts.filter((a) => a.triggered).length} triggered)</div>
                <div className="flex flex-wrap gap-1.5">
                  {accAlerts.map((al) => (
                    <div key={al.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px]" style={{ background: al.triggered ? "rgba(100,100,100,0.12)" : "rgba(245,158,11,0.12)", border: al.triggered ? "1px solid rgba(100,100,100,0.2)" : "1px solid rgba(245,158,11,0.3)", color: al.triggered ? "var(--muted)" : "#f59e0b" }}>
                      <span>{al.symbol} {al.condition === "ABOVE" ? "↑" : "↓"} {al.price}</span>
                      {al.note && <span className="text-[var(--muted)]">· {al.note}</span>}
                      {al.triggered && <span className="text-[8px]">(triggered)</span>}
                      <button onClick={async () => { await fetch(`/api/admin/clients/${selAcc.id}/alerts?alertId=${al.id}`, { method: "DELETE" }); loadAccAlerts(selAcc.id); }} className="ml-0.5 opacity-60 hover:opacity-100"><i className="fa-solid fa-xmark text-[8px]" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab === "history" && (() => {
              if (!selAcc) return <div className="flex h-full items-center justify-center text-[11px] italic" style={{ color: "var(--muted)" }}>Please select an account first.</div>;
              const thc = "px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
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
              const rows = accHistory.filter((h) => (hfType === "ALL" || hType(h) === hfType)).filter(inRange);
              const hAllOn = rows.length > 0 && rows.every((h) => histSel[h.id]);
              const hToggleAll = () => { if (hAllOn) setHistSel({}); else { const n: Record<string, boolean> = {}; rows.forEach((h) => (n[h.id] = true)); setHistSel(n); } };
              return (
                <div className="flex h-full flex-col text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
                    {presets.map(([k, lbl]) => <button key={k} onClick={() => { setHfPreset(k); setHfFrom(""); setHfTo(""); }} className="rounded px-2 py-0.5" style={hfPreset === k ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{lbl}</button>)}
                    <span className="ml-1 text-[var(--muted)]">From</span><input type="date" value={hfFrom} onChange={(e) => { setHfFrom(e.target.value); setHfPreset("ALL"); }} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]" />
                    <span className="text-[var(--muted)]">To</span><input type="date" value={hfTo} onChange={(e) => { setHfTo(e.target.value); setHfPreset("ALL"); }} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]" />
                    <span className="text-[var(--muted)]">Type</span><select value={hfType} onChange={(e) => setHfType(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select>
                    <a href={"/api/admin/export/trades?" + new URLSearchParams(Object.fromEntries([["accountId", selAcc?.id || ""], hfFrom ? ["from", hfFrom] : ["",""], hfTo ? ["to", hfTo] : ["",""]].filter(([k]) => k))).toString()} download className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 font-semibold" style={{ background: BUY + "22", color: BUY, border: "1px solid " + BUY + "44" }} title="Export filtered trades as CSV"><i className="fa-solid fa-download" /> Export CSV</a>
                    {Object.keys(histSel).filter((k) => histSel[k]).length > 0 && <button onClick={delHistBulk} className="rounded px-2 py-0.5" style={{ background: SELL, color: "#1a0606" }}>Delete Selected ({Object.keys(histSel).filter((k) => histSel[k]).length})</button>}
                  </div>
                  {/* Period summary — below the filter row */}
                  {selAcc && (() => {
                    const fin2 = (types: string[]) => rows.filter((r: any) => r.kind === "FIN" && types.includes(String(r.type))).reduce((a: number, r: any) => a + Number(r.pnl || 0), 0);
                    const plRows2 = rows.filter((r: any) => r.kind === "TRADE" || (r.kind === "FIN" && String(r.type) === "PNL_ADJUST"));
                    const tradePL2 = plRows2.reduce((a: number, r: any) => a + Number(r.pnl || 0), 0);
                    const deposits2 = fin2(["DEPOSIT"]); const withdrawals2 = fin2(["WITHDRAWAL"]); const credit2 = fin2(["CREDIT_IN", "CREDIT_OUT", "BONUS", "INSURANCE"]);
                    const net2 = rows.reduce((a: number, r: any) => a + Number(r.pnl || 0), 0);
                    const cell2 = (label: string, val: number) => (<span className="whitespace-nowrap"><span style={{ color: "var(--muted)" }}>{label} </span><span style={{ color: val > 0 ? BUY : val < 0 ? SELL : "var(--text)", fontWeight: 700 }}>{val > 0 ? "+" : ""}{gnum(val, 2)}</span></span>);
                    return (
                      <div className="flex items-center gap-3 overflow-x-auto border-b border-[var(--border)] px-2 py-1 text-[10px]" style={{ scrollbarWidth: "none" }}>
                        <span><span style={{ color: "var(--muted)" }}>Records </span><b>{rows.length}</b></span>
                        {cell2("Deposits", deposits2)}{cell2("Withdrawals", withdrawals2)}{cell2("Credit/Bonus", credit2)}
                        <span><span style={{ color: "var(--muted)" }}>Trade P/L </span><span style={{ color: tradePL2 >= 0 ? BUY : SELL, fontWeight: 700 }}>{tradePL2 >= 0 ? "+" : ""}{gnum(tradePL2, 2)}</span></span>
                        <span className="rounded px-2 py-0.5" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}><span style={{ color: "var(--muted)" }}>Net </span><span style={{ color: net2 >= 0 ? BUY : SELL, fontWeight: 800 }}>{net2 >= 0 ? "+" : ""}{gnum(net2, 2)}</span></span>
                      </div>
                    );
                  })()}
                  <div className="flex-1 overflow-auto">
                    <table className="w-full border-collapse [&_td]:border-b [&_td]:border-[color-mix(in_srgb,var(--border)_38%,transparent)] [&_td]:px-1.5 [&_th]:px-1.5">
                      <thead><tr className="border-b border-[var(--border)] sticky top-0 z-10 bg-[var(--panel)]">
                        <th className={thc}><input type="checkbox" checked={hAllOn} onChange={hToggleAll} /></th>
                        <SortTh tbl="hist" k="date" label="Date/Time" cls={thc} /><SortTh tbl="hist" k="ref" label="Order/Ref" cls={thc} /><SortTh tbl="hist" k="type" label="Type" cls={thc} /><SortTh tbl="hist" k="symbol" label="Symbol" cls={thc} /><SortTh tbl="hist" k="lots" label="Lots" align="right" cls={thc + " text-right"} /><SortTh tbl="hist" k="desc" label="Desc" cls={thc} />
                        <SortTh tbl="hist" k="openPx" label="Open Px" align="right" cls={thc + " text-right"} /><SortTh tbl="hist" k="closePx" label="Close Px" align="right" cls={thc + " text-right"} /><SortTh tbl="hist" k="sl" label="S/L" align="right" cls={thc + " text-right"} /><SortTh tbl="hist" k="tp" label="T/P" align="right" cls={thc + " text-right"} />
                        <SortTh tbl="hist" k="closeTime" label="Close Time" cls={thc} /><SortTh tbl="hist" k="pnl" label="Gross P&L" align="right" cls={thc + " text-right"} />{swapEnabled && <><th className={thc + " text-right"}>Swap</th><th className={thc + " text-right"}>Comm</th></>}<th className={thc + " text-right"}>{swapEnabled ? "Net P&L" : "P&L"}</th><th className={thc + " text-right"}>Edit</th>
                      </tr></thead>
                      <tbody>
                        {rows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={16}>No history.</td></tr> : sortRows("hist", rows, {
                          date: (h) => { const v = h.openedAt || h.openTime || h.at || h.createdAt; return v ? new Date(v).getTime() : null; },
                          ref: (h) => h.ticket ?? h.orderId ?? h.id,
                          type: (h) => hType(h), symbol: (h) => h.symbol, lots: (h) => Number(h.lots), desc: (h) => h.closeReason || h.description || h.desc,
                          openPx: (h) => Number(h.openPrice), closePx: (h) => Number(h.closePrice), sl: (h) => Number(h.sl), tp: (h) => Number(h.tp),
                          closeTime: (h) => { const v = hdt(h); return v ? new Date(v).getTime() : null; }, pnl: (h) => Number(h.pnl),
                        }).map((h) => (
                          <tr key={h.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                            <td className="px-2 py-1"><input type="checkbox" checked={!!histSel[h.id]} onChange={() => setHistSel((s) => ({ ...s, [h.id]: !s[h.id] }))} /></td>
                            <td className="px-2 py-1 text-[var(--muted)]">{(() => { const v = h.openedAt || h.openTime || h.at || h.createdAt; return v ? new Date(v).toLocaleString() : "-"; })()}</td>
                            <td className="px-2 py-1">{h.ticket ?? h.orderId ?? h.id}</td>
                            <td className="px-2 py-1" style={{ color: hType(h) === "BUY" ? BUY : SELL }}>{h.side || h.type || "-"}</td>
                            <td className="px-2 py-1">{h.symbol}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{h.kind === "TRADE" && h.lots ? Number(h.lots).toFixed(2) : "—"}</td>
                            <td className="px-2 py-1">{(() => { const r = h.closeReason || h.description || h.desc; const col = r === "TP" ? "#10b981" : r === "SL" ? "#f43f5e" : r === "MC" ? "#f59e0b" : "var(--muted)"; return <span style={{ color: col, fontWeight: r && r !== "MANUAL" ? 600 : "normal" }}>{r || "—"}</span>; })()}</td>
                            <td className="px-2 py-1 text-right">{h.openPrice != null && Number(h.openPrice) !== 0 ? pxFmt(h.symbol, h.openPrice) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.closePrice != null && Number(h.closePrice) !== 0 ? pxFmt(h.symbol, h.closePrice) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.sl ? pxFmt(h.symbol, h.sl) : "-"}</td>
                            <td className="px-2 py-1 text-right">{h.tp ? pxFmt(h.symbol, h.tp) : "-"}</td>
                            <td className="px-2 py-1 text-[var(--muted)]">{hdt(h) ? new Date(hdt(h)).toLocaleString() : "-"}</td>
                            <td className="px-2 py-1 text-right" style={{ color: (h.pnl ?? 0) >= 0 ? BUY : SELL }}>{h.pnl != null ? gnum(h.pnl, 2) : "-"}</td>
                            {swapEnabled && <><td className="px-2 py-1 text-right" style={{ color: Number(h.swap ?? 0) >= 0 ? BUY : SELL }}>{h.kind === "TRADE" && Number(h.swap ?? 0) !== 0 ? gnum(Number(h.swap), 2) : "—"}</td>
                            <td className="px-2 py-1 text-right" style={{ color: SELL }}>{h.kind === "TRADE" && Number(h.commission ?? 0) !== 0 ? gnum(Number(h.commission), 2) : "—"}</td></>}
                            {(() => { const net = Number(h.pnl ?? 0) + (swapEnabled ? Number(h.swap ?? 0) : 0) - (swapEnabled ? Number(h.commission ?? 0) : 0); return <td className="px-1 py-0.5 text-right">{h.kind === "TRADE" ? <span className="text-[10px] font-bold tabular-nums" style={{ color: net >= 0 ? BUY : SELL }}>{(net >= 0 ? "+" : "") + gnum(net, 2)}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>; })()}
                            <td className="px-2 py-1 text-right whitespace-nowrap" title={h.comment || ""}>{h.comment && <i className="fa-solid fa-comment mr-1 text-[8px] text-[var(--muted)]" title={h.comment} />}<button title="Edit" onClick={() => openHEdit(h)} className="mr-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "var(--accent)" }}><i className="fa-solid fa-pen" /></button><button title="Delete" onClick={() => delHist(h)} className="rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {tab === "summary" && !selAcc && (() => {
              // Platform-wide P&L report using aggregated account data
              const liveClients = clients.filter((c: any) => c.type === "LIVE");
              const demoClients = clients.filter((c: any) => c.type === "DEMO");
              const totalDep = clients.reduce((a: number, c: any) => a + Number(c.deposit || 0), 0);
              const totalWd  = clients.reduce((a: number, c: any) => a + Number(c.withdrawal || 0), 0);
              const totalPnl = clients.reduce((a: number, c: any) => a + Number(c.pnl || 0), 0);
              const totalCredit = clients.reduce((a: number, c: any) => a + Number(c.credit || 0) + Number(c.bonus || 0), 0);
              // Commission + swap from recent history (limited to 150 loaded rows)
              const tradePnl = history.filter((h: any) => h.kind === "TRADE");
              const grossComm = tradePnl.reduce((a: number, h: any) => a + Number(h.commission || 0), 0);
              const grossSwap = tradePnl.reduce((a: number, h: any) => a + Math.abs(Number(h.swap || 0)), 0);
              // Symbol breakdown from recent history
              const symVol: Record<string, { lots: number; pnl: number; trades: number }> = {};
              tradePnl.forEach((h: any) => {
                if (!h.symbol || h.symbol === "-") return;
                if (!symVol[h.symbol]) symVol[h.symbol] = { lots: 0, pnl: 0, trades: 0 };
                symVol[h.symbol].lots  += Number(h.lots || 0);
                symVol[h.symbol].pnl   += Number(h.pnl || 0);
                symVol[h.symbol].trades++;
              });
              const topSyms = Object.entries(symVol).sort((a, b) => b[1].lots - a[1].lots).slice(0, 8);
              // Group breakdown
              const grpMap: Record<string, { dep: number; pnl: number; cnt: number }> = {};
              clients.forEach((c: any) => {
                const gname = c.group?.name || "Ungrouped";
                if (!grpMap[gname]) grpMap[gname] = { dep: 0, pnl: 0, cnt: 0 };
                grpMap[gname].dep += Number(c.deposit || 0) - Number(c.withdrawal || 0);
                grpMap[gname].pnl += Number(c.pnl || 0);
                grpMap[gname].cnt++;
              });
              const grpRows = Object.entries(grpMap).sort((a, b) => b[1].dep - a[1].dep);
              const sc = (label: string, val: number, col?: string) => (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
                  <div className="mt-1 text-base font-bold tabular-nums" style={{ color: col || (val >= 0 ? BUY : SELL) }}>{val >= 0 ? "+" : ""}{gnum(val, 2)}</div>
                </div>
              );
              const thc = "px-2 py-1.5 text-left text-[10px] font-semibold" as const;
              const tdc = "px-2 py-1.5 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_38%,transparent)] tabular-nums" as const;
              return (
                <div className="h-full overflow-auto p-3 text-[11px]">
                  {/* Top stat cards */}
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Accounts</div><div className="mt-1 text-base font-bold">{liveClients.length} Live · <span style={{ color: "var(--muted)" }}>{demoClients.length} Demo</span></div></div>
                    {sc("Total Deposits", totalDep, BUY)}
                    {sc("Total Withdrawals", -totalWd, SELL)}
                    {sc("Net Deposits", totalDep - totalWd, "var(--text)")}
                    {sc("Realized P/L", totalPnl)}
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Credit / Bonus</div><div className="mt-1 text-base font-bold tabular-nums" style={{ color: "var(--accent)" }}>{gnum(totalCredit, 2)}</div></div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Comm (recent)</div><div className="mt-1 text-base font-bold tabular-nums" style={{ color: BUY }}>{gnum(grossComm, 2)}</div></div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Swap (recent)</div><div className="mt-1 text-base font-bold tabular-nums" style={{ color: "var(--text)" }}>{gnum(grossSwap, 2)}</div></div>
                  </div>
                  <div className="flex gap-3">
                    {/* Group breakdown */}
                    <div className="flex-1 overflow-auto rounded-xl border border-[var(--border)]">
                      <div className="border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>By Group</div>
                      <table className="w-full border-collapse">
                        <thead><tr style={{ background: "var(--soft)" }}><th className={thc} style={{ color: "var(--muted)" }}>Group</th><th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Accounts</th><th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Net Deposits</th><th className={thc + " text-right"} style={{ color: "var(--muted)" }}>P/L</th></tr></thead>
                        <tbody>
                          {grpRows.map(([name, g]) => (
                            <tr key={name}>
                              <td className={tdc + " font-medium"}>{name}</td>
                              <td className={tdc + " text-right"}>{g.cnt}</td>
                              <td className={tdc + " text-right"}>{gnum(g.dep, 2)}</td>
                              <td className={tdc + " text-right"} style={{ color: g.pnl >= 0 ? BUY : SELL }}>{g.pnl >= 0 ? "+" : ""}{gnum(g.pnl, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Top symbols (from recent history) */}
                    {topSyms.length > 0 && (
                      <div className="w-56 shrink-0 overflow-auto rounded-xl border border-[var(--border)]">
                        <div className="border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Top Symbols (recent)</div>
                        <table className="w-full border-collapse">
                          <thead><tr style={{ background: "var(--soft)" }}><th className={thc} style={{ color: "var(--muted)" }}>Symbol</th><th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Lots</th><th className={thc + " text-right"} style={{ color: "var(--muted)" }}>P/L</th></tr></thead>
                          <tbody>
                            {topSyms.map(([sym, d]) => (
                              <tr key={sym}>
                                <td className={tdc + " font-mono font-semibold"}>{sym}</td>
                                <td className={tdc + " text-right"}>{d.lots.toFixed(2)}</td>
                                <td className={tdc + " text-right"} style={{ color: d.pnl >= 0 ? BUY : SELL }}>{d.pnl >= 0 ? "+" : ""}{gnum(d.pnl, 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 text-[9px]" style={{ color: "var(--muted)" }}>
                    <i className="fa-solid fa-circle-info mr-1" />Deposits/withdrawals/P&amp;L are platform totals from all accounts. Commission &amp; swap figures are based on the most recent {tradePnl.length} closed trades loaded.
                    <a href="/api/admin/export/trades" download className="ml-3 font-semibold" style={{ color: BUY }}><i className="fa-solid fa-download mr-1" />Export all trades (CSV)</a>
                  </div>
                </div>
              );
            })()}
            {tab === "summary" && selAcc && (
              <div className="p-3">
                <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  {([ ["TOTAL DEPOSITS", fmt(Number(selAcc?.deposit || 0)), BUY], ["TOTAL WITHDRAWALS", "-" + fmt(Number(selAcc?.withdrawal || 0)), SELL], ["NET DEPOSITS", fmt(Number(selAcc?.deposit || 0) - Number(selAcc?.withdrawal || 0)), "var(--text)"], ["CREDIT", fmt(Number(selAcc?.credit || 0)), Number(selAcc?.credit || 0) > 0 ? "#a855f7" : "var(--muted)"], ["BONUS", fmt(Number(selAcc?.bonus || 0)), Number(selAcc?.bonus || 0) > 0 ? GOLD : "var(--muted)"], ["INSURANCE", fmt(Number(selAcc?.insurance || 0)), Number(selAcc?.insurance || 0) > 0 ? "#06b6d4" : "var(--muted)"], ["CLOSED TRADE P/L", fmt(Number(selAcc?.pnl || 0)), Number(selAcc?.pnl || 0) >= 0 ? BUY : SELL], ["CURRENT BALANCE", fmt(balance), "var(--text)"], ["MC LEVEL", Number(selAcc?.mcLevel || 0) > 0 ? selAcc?.mcLevel + "%" : "Off", GOLD], ["NET BALANCE", fmt(equity), "var(--accent)"] ] as [string, string, string][]).map(([k, v, c]) => (
                    <div key={k as string} className="rounded-xl border border-[var(--border)] bg-[var(--soft)] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">{k}</div><div className="mt-1 text-base font-bold tabular-nums" style={{ color: c }}>{v}</div></div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <a href={"/api/desk/statement?accountId=" + selAcc.id} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: "#ef4444" }}><i className="fa-solid fa-file-pdf" /> PDF Statement</a>
                  <a href={"/api/admin/export/trades?accountId=" + selAcc.id} download className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: BUY + "22", color: BUY, border: "1px solid " + BUY + "44" }}><i className="fa-solid fa-download" /> Export Trades CSV</a>
                </div>
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
              const thc = "px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
              return (
                <div className="flex h-full flex-col text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
                    <input value={cliQ} onChange={(e) => setCliQ(e.target.value)} placeholder="Search login / name / email" className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text)] min-w-[160px]" />
                    <select value={cliType} onChange={(e) => setCliType(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All Types</option><option value="LIVE">Live</option><option value="DEMO">Demo</option></select>
                    <select value={cliStatus} onChange={(e) => setCliStatus(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-[var(--text)]"><option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="LOCKED">Locked</option><option value="INACTIVE">Inactive</option></select>
                    <span className="text-[var(--muted)]">{cliRows.length} clients</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full border-collapse [&_td]:border-b [&_td]:border-[color-mix(in_srgb,var(--border)_38%,transparent)] [&_td]:px-1.5 [&_th]:px-1.5">
                      <thead><tr className="border-b border-[var(--border)] sticky top-0 bg-[var(--panel)] z-10">
                        <SortTh tbl="cli" k="login" label="Login" cls={thc} /><SortTh tbl="cli" k="name" label="Name" cls={thc} /><SortTh tbl="cli" k="email" label="Email" cls={thc} />
                        <SortTh tbl="cli" k="phone" label="Phone" cls={thc} /><SortTh tbl="cli" k="country" label="Country" cls={thc} /><SortTh tbl="cli" k="manager" label="Manager" cls={thc} />
                        <SortTh tbl="cli" k="type" label="Type" cls={thc} /><SortTh tbl="cli" k="balance" label="Balance" cls={thc} /><SortTh tbl="cli" k="online" label="Online" cls={thc} />
                        <SortTh tbl="cli" k="ip" label="Last IP" cls={thc} /><SortTh tbl="cli" k="status" label="Status" cls={thc} /><th className={thc + " text-right"}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {cliRows.length === 0 ? <tr><td className="px-2 py-3 text-[var(--muted)]" colSpan={12}>No clients.</td></tr> : (() => {
                          // Group same-user LIVE + DEMO accounts together
                          const byUser = new Map<string, any[]>();
                          const noUser: any[] = [];
                          for (const c of cliRows) {
                            if (!c.userId) { noUser.push(c); continue; }
                            if (!byUser.has(c.userId)) byUser.set(c.userId, []);
                            byUser.get(c.userId)!.push(c);
                          }
                          for (const accs of byUser.values()) {
                            accs.sort((a: any, b: any) => (b.type === "LIVE" ? 1 : 0) - (a.type === "LIVE" ? 1 : 0));
                          }
                          const primaries = [...byUser.values()].map((g) => g[0]);
                          const sortDef = { login: (c: any) => c.login, name: (c: any) => c.name, email: (c: any) => c.user?.email || c.email, phone: (c: any) => c.phone, country: (c: any) => c.country, manager: (c: any) => c.manager?.name, type: (c: any) => c.type, balance: (c: any) => balOf(c), online: (c: any) => (presenceOnline(c.user?.lastSeenAt) ? 1 : 0), ip: (c: any) => c.user?.lastLoginIp, status: (c: any) => (c.deactivated ? "Inactive" : c.locked ? "Locked" : "Active") };
                          const allPrimaries = sortRows("cli", [...primaries, ...noUser], sortDef);
                          const flatRows: { acc: any; isDemoSub: boolean }[] = [];
                          const done = new Set<string>();
                          for (const p of allPrimaries) {
                            if (p.userId && byUser.has(p.userId) && !done.has(p.userId)) {
                              done.add(p.userId);
                              byUser.get(p.userId)!.forEach((acc: any, i: number) => flatRows.push({ acc, isDemoSub: i > 0 }));
                            } else if (!p.userId) {
                              flatRows.push({ acc: p, isDemoSub: false });
                            }
                          }
                          return flatRows.map(({ acc: c, isDemoSub }) => {
                            const email = c.user?.email || c.email || "-";
                            const lastIp = c.user?.lastLoginIp || "-";
                            const bal = balOf(c);
                            const accPos = open.filter((p: any) => p.accountLogin === c.login || p.accountId === c.id);
                            const accFl = accPos.reduce((s: number, p: any) => s + pnlOf(p, prices[p.symbol] ?? Number(p.openPrice), csz(p.symbol)), 0);
                            const accUsed = accPos.reduce((s: number, p: any) => { const pr = prices[p.symbol] ?? Number(p.openPrice); const m = (Number(p.lots) * csz(p.symbol) * pr) / (Number(c.leverage) || 100); return s + (/JPY$/i.test(p.symbol) ? m / (pr || 1) : m); }, 0);
                            const accMl = accUsed > 0 ? ((bal + accFl) / accUsed) * 100 : null;
                            const statusLabel = c.deactivated ? "Inactive" : c.locked ? "Locked" : "Active";
                            const statusCol = c.deactivated ? GOLD : c.locked ? SELL : BUY;
                            const kycApproved = c.type === "LIVE" && c.kycStatus === "APPROVED";
                            const kycPending = c.type === "LIVE" && c.kycStatus === "PENDING";
                            const kycRejected = c.type === "LIVE" && c.kycStatus === "REJECTED";
                            return (
                              <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]"
                                style={isDemoSub ? { background: "rgba(99,102,241,0.04)", borderLeft: "2px solid rgba(99,102,241,0.25)" } : undefined}
                                onContextMenu={(e) => { e.preventDefault(); setSelAcc(c); setMenu({ x: e.clientX, y: e.clientY, acc: c }); }}>
                                <td className="px-2 py-1 font-medium" style={{ color: isDemoSub ? "#818cf8" : GOLD }}>
                                  {isDemoSub && <span className="mr-0.5 text-[9px]" style={{ color: "rgba(99,102,241,0.4)" }}>└</span>}
                                  <button onClick={() => setSelAcc(c)} title="Select account">{c.login}</button>
                                  {c.isPool && <span className="ml-1 text-[9px] rounded px-0.5" style={{ background: GOLD + "22", color: GOLD }}>POOL</span>}
                                </td>
                                <td className="px-2 py-1">{titleCaseName(c.name)}</td>
                                <td className="px-2 py-1 text-[var(--muted)]">{isDemoSub ? <span style={{ color: "rgba(99,102,241,0.5)" }}>↑</span> : email}</td>
                                <td className="px-2 py-1 text-[var(--muted)]">{isDemoSub ? "" : (c.phone || "-")}</td>
                                <td className="px-2 py-1 text-[var(--muted)]">{isDemoSub ? "" : (c.country || "-")}</td>
                                <td className="px-2 py-1 text-[var(--muted)]">{c.manager?.name || "-"}</td>
                                <td className="px-2 py-1">
                                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: c.type === "LIVE" ? BUY + "22" : "#6366f122", color: c.type === "LIVE" ? BUY : "#818cf8" }}>{c.type}</span>
                                  {kycApproved && <span className="ml-1 rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: BUY + "22", color: BUY }} title="KYC Verified"><i className="fa-solid fa-shield-halved mr-0.5" />KYC</span>}
                                  {kycPending && <span className="ml-1 rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: GOLD + "22", color: GOLD }} title="KYC Pending"><i className="fa-solid fa-clock mr-0.5" />KYC</span>}
                                  {kycRejected && <span className="ml-1 rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: SELL + "22", color: SELL }} title="KYC Rejected"><i className="fa-solid fa-xmark mr-0.5" />KYC</span>}
                                </td>
                                <td className="px-2 py-1 text-right" style={{ color: bal >= 0 ? BUY : SELL }}>
                                  {bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  {accMl != null && <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" title={`Margin Level: ${accMl.toFixed(0)}%`} style={{ background: accMl >= 200 ? "#22c55e" : accMl >= 100 ? "#f59e0b" : "#ef4444", boxShadow: accMl < 100 ? "0 0 5px #ef444480" : accMl < 200 ? "0 0 4px #f59e0b60" : "0 0 4px #22c55e60" }} />}
                                </td>
                                <td className="px-2 py-1 text-center">{(() => { const on = presenceOnline(c.user?.lastSeenAt); const ls = c.user?.lastSeenAt ? new Date(c.user.lastSeenAt).toLocaleString() : "never"; return <span title={on ? "Online" : "Last seen " + ls} className={"inline-block h-2 w-2 rounded-full " + (on ? "bg-green-400" : "bg-gray-600")} style={on ? { boxShadow: "0 0 5px #4ade80" } : undefined} />; })()}</td>
                                <td className="px-2 py-1 text-[var(--muted)]">{lastIp}</td>
                                <td className="px-2 py-1" style={{ color: statusCol }}>{statusLabel}</td>
                                <td className="px-2 py-1 text-right whitespace-nowrap">
                                  <button title="Edit" onClick={() => openAct("rename", c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "var(--accent)" }}><i className="fa-solid fa-pen-to-square" /></button>
                                  <button title={c.locked ? "Unlock" : "Lock"} onClick={() => doStatus(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: c.locked ? BUY : SELL }}><i className={"fa-solid " + (c.locked ? "fa-lock-open" : "fa-lock")} /></button>
                                  <button title={c.deactivated ? "Activate" : "Deactivate"} onClick={() => doDeactivate(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: GOLD }}><i className={"fa-solid " + (c.deactivated ? "fa-circle-check" : "fa-ban")} /></button>
                                  <button title={c.isPool ? "Demote from Pool" : "Promote to Pool"} onClick={() => doPool(c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "#a78bfa" }}><i className={"fa-solid " + (c.isPool ? "fa-circle-minus" : "fa-circle-plus")} /></button>
                                  <button title="Change ID" onClick={() => openAct("accountid", c)} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: "var(--muted)" }}><i className="fa-solid fa-id-card" /></button>
                                  {c.type === "LIVE" && <button title="Upload KYC" onClick={() => { setKycUploadFor(c); setKycUploadType("PASSPORT"); setKycUploadFile(null); setKycUpMsg(""); }} className="mr-0.5 rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: kycApproved ? BUY : "#38bdf8" }}><i className={"fa-solid " + (kycApproved ? "fa-shield-halved" : "fa-id-card-clip")} /></button>}
                                  {can("deleteClients") && <button title="Delete" onClick={() => delClient(c)} className="rounded px-1.5 py-0.5 hover:bg-[var(--soft)]" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {tab === "audit" && (() => {
              const AUDIT_CATS = ["ALL", "SUPERADMIN", "ADMIN", "MANAGER", "CLIENT"];
              const AUDIT_COL: Record<string, string> = { SUPERADMIN: "#a78bfa", ADMIN: GOLD, MANAGER: "#38bdf8", CLIENT: BUY };
              const auditRows = audit.filter((l: any) => {
                if (auditCat !== "ALL" && (l.category || "ADMIN").toUpperCase() !== auditCat) return false;
                if (!auditQ) return true;
                const q = auditQ.toLowerCase();
                return (l.targetLogin || "").toLowerCase().includes(q) ||
                  (l.targetName || "").toLowerCase().includes(q) ||
                  (l.targetEmail || "").toLowerCase().includes(q) ||
                  (l.performedBy || "").toLowerCase().includes(q) ||
                  (l.actorName || "").toLowerCase().includes(q) ||
                  (l.action || "").toLowerCase().includes(q) ||
                  (l.detail || "").toLowerCase().includes(q);
              });
              const th = "px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap";
              const td = "px-2 py-1.5 align-top";
              return (
                <div className="flex h-full flex-col text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
                    {AUDIT_CATS.map((c) => (
                      <button key={c} onClick={() => setAuditCat(c)} className="rounded px-2 py-0.5" style={auditCat === c ? { background: AUDIT_COL[c] || "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>{c}</button>
                    ))}
                    <span className="text-[var(--muted)]">{auditRows.length} entries</span>
                    <input value={auditQ} onChange={(e: any) => setAuditQ(e.target.value)} placeholder="Search…" className="ml-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text)]" style={{ width: 140 }} />
                    <a href={"/api/admin/export/audit" + (auditCat !== "ALL" ? "?category=" + auditCat : "")} download className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 font-semibold text-[10px]" style={{ background: BUY + "22", color: BUY, border: "1px solid " + BUY + "44" }} title="Export audit log as CSV"><i className="fa-solid fa-download" /> Export CSV</a>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
                        <tr className="border-b border-[var(--border)]">
                          <th className={th}>Cat</th>
                          <th className={th}>Account ID</th>
                          <th className={th}>Name</th>
                          <th className={th}>Email</th>
                          <th className={th}>Actor</th>
                          <th className={th}>Action</th>
                          <th className={th}>Detail</th>
                          <th className={th + " text-right"}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRows.length === 0 ? (
                          <tr><td className="px-2 py-4 text-center text-[var(--muted)]" colSpan={8}>No activity.</td></tr>
                        ) : auditRows.slice(0, 200).map((l: any) => {
                          const cat = (l.category || "ADMIN").toUpperCase();
                          const col = AUDIT_COL[cat] || "var(--muted)";
                          // Strip login prefix from detail to avoid duplication
                          const detailClean = l.targetLogin ? (l.detail || "").replace(new RegExp("^" + l.targetLogin + "\\s*"), "") : (l.detail || "");
                          return (
                            <tr key={l.id} className="border-b border-[var(--border)] hover:bg-[var(--soft)]">
                              <td className={td}><span className="rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wide" style={{ background: col + "22", color: col }}>{cat}</span></td>
                              <td className={td + " font-mono font-semibold"} style={{ color: "var(--accent)" }}>{l.targetLogin || <span className="text-[var(--muted)]">—</span>}</td>
                              <td className={td + " font-medium"}>{l.targetName || <span className="text-[var(--muted)]">—</span>}</td>
                              <td className={td} style={{ color: "var(--muted)" }}>{l.targetEmail || <span className="text-[var(--muted)]">—</span>}</td>
                              <td className={td} style={{ color: "var(--muted)" }}>{l.actorName ? <><span className="font-medium" style={{ color: "var(--text)" }}>{l.actorName}</span><br /><span>{l.performedBy}</span></> : l.performedBy}</td>
                              <td className={td}><span className="font-semibold" style={{ color: "var(--accent)" }}>{l.action}</span></td>
                              <td className={td} style={{ color: "var(--muted)", maxWidth: 220, wordBreak: "break-all" }}>{detailClean}</td>
                              <td className={td + " text-right whitespace-nowrap"} style={{ color: "var(--muted)" }}>{l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {tab === "payments" && <PaymentsPanel />}
            {tab === "kyc" && <KycPanel />}
            {tab === "requests" && <RequestsPanel />}

            {/* ── OVERVIEW tab ── */}
            {tab === "overview" && !dataReady && <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…</div>}
            {tab === "overview" && dataReady && (() => {
              const totalClients = clients.length;
              const liveClients = clients.filter((c: any) => c.type === "LIVE").length;
              const demoClients = clients.filter((c: any) => c.type === "DEMO").length;
              const totalPositions = open.length;
              const totalFloating = open.reduce((sum: number, p: any) => {
                const cur = prices[p.symbol] ?? Number(p.openPrice);
                return sum + pnlOf(p, cur, contractFor(catMap[p.symbol] || "forex", p.symbol));
              }, 0);
              const totalDeposits = clients.reduce((s: number, c: any) => s + Number(c.deposit ?? 0), 0);
              const totalWithdrawals = clients.reduce((s: number, c: any) => s + Number(c.withdrawal ?? 0), 0);
              const totalCredit = clients.reduce((s: number, c: any) => s + Number(c.credit ?? 0) + Number(c.bonus ?? 0), 0);
              const totalPnl = clients.reduce((s: number, c: any) => s + Number(c.pnl ?? 0), 0);
              const totalEquity = totalDeposits - totalWithdrawals + totalCredit + totalPnl;
              const nearMC = clients.filter((c: any) => {
                const dep = Number(c.deposit ?? 0) - Number(c.withdrawal ?? 0) + Number(c.credit ?? 0) + Number(c.bonus ?? 0) + Number(c.pnl ?? 0);
                const accPositions = open.filter((p: any) => p.accountLogin === c.login || p.accountId === c.id);
                if (accPositions.length === 0) return false;
                const fl = accPositions.reduce((s: number, p: any) => s + pnlOf(p, prices[p.symbol] ?? Number(p.openPrice), contractFor(catMap[p.symbol] || "forex", p.symbol)), 0);
                const eq = dep + fl;
                const used = accPositions.reduce((s: number, p: any) => {
                  const pr = prices[p.symbol] ?? Number(p.openPrice);
                  const margin = (Number(p.lots) * contractFor(catMap[p.symbol] || "forex", p.symbol) * pr) / (Number(c.leverage) || 100);
                  return s + (/JPY$/i.test(p.symbol) ? margin / (pr || 1) : margin);
                }, 0);
                if (used === 0) return false;
                return (eq / used) * 100 < 150;
              }).length;
              const todayTrades = history.filter((h: any) => { const d = h.closeTime || h.closedAt; if (!d) return false; return new Date(d).toDateString() === new Date().toDateString(); });
              const todayPnl = todayTrades.reduce((s: number, h: any) => s + Number(h.pnl ?? 0), 0);
              const statCard = (icon: string, label: string, value: string | number, color?: string, sub?: string, accent?: string) => (
                <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]" style={{ minWidth: 0 }}>
                  {accent && <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />}
                  <div className="pointer-events-none absolute right-0 top-0 h-full w-16 opacity-40" style={{ background: accent ? `radial-gradient(ellipse at 100% 40%, ${accent}28 0%, transparent 70%)` : undefined }} />
                  <div className="p-3">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px]" style={{ background: (color || accent) ? `${color || accent}18` : "var(--soft)", color: color || accent || "var(--muted)" }}>
                        <i className={"fa-solid " + icon} />
                      </span>
                      <span className="truncate text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{label}</span>
                    </div>
                    <div className="truncate text-[19px] font-extrabold tabular-nums leading-none" style={{ color: color || "var(--text)" }}>{value}</div>
                    {sub && <div className="mt-1 truncate text-[9px]" style={{ color: "var(--muted)" }}>{sub}</div>}
                  </div>
                </div>
              );
              return (
                <div className="space-y-2 p-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                    {statCard("fa-users", "Total Accounts", totalClients, undefined, `${liveClients} Live · ${demoClients} Demo`, "#2f81f7")}
                    {statCard("fa-chart-line", "Open Positions", totalPositions, undefined, `${gnum(totalFloating, 2)} floating P/L`, "#f59e0b")}
                    {statCard(totalFloating >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", "Floating P/L", (totalFloating >= 0 ? "+" : "") + gnum(totalFloating, 2), totalFloating >= 0 ? BUY : SELL, "All open positions", totalFloating >= 0 ? BUY : SELL)}
                    {statCard("fa-download", "Total Deposits", gnum(totalDeposits, 2), BUY, undefined, BUY)}
                    {statCard("fa-upload", "Total Withdrawals", gnum(totalWithdrawals, 2), SELL, undefined, SELL)}
                    {statCard("fa-wallet", "Total Equity", gnum(totalEquity, 2), totalEquity >= 0 ? BUY : SELL, "Net across all accounts", totalEquity >= 0 ? BUY : SELL)}
                    {statCard("fa-triangle-exclamation", "Near Margin Call", nearMC, nearMC > 0 ? SELL : "var(--muted)", "Below 150% margin level", nearMC > 0 ? SELL : undefined)}
                    {statCard("fa-bars-progress", "Closed Today", todayTrades.length, undefined, (todayPnl >= 0 ? "+" : "") + gnum(todayPnl, 2) + " net P/L", "#8b5cf6")}
                    {statCard("fa-layer-group", "Trade Groups", tradeGroups.length, undefined, tradeGroups.map((g: any) => g.name).join(", ") || "None")}
                  </div>
                  {nearMC > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold" style={{ borderColor: `${SELL}40`, background: `${SELL}0d`, color: SELL }}>
                      <i className="fa-solid fa-triangle-exclamation" />
                      {nearMC} account{nearMC > 1 ? "s" : ""} near margin call — check Positions immediately
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── GROUPS tab ── */}
            {/* ── SYMBOLS tab ── */}
            {tab === "symbols" && (() => {
              const thc = "px-2 py-1.5 text-left text-[10px] font-semibold sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]" as const;
              const tdc = "px-2 py-1.5 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_38%,transparent)]" as const;
              const cats = Array.from(new Set(adminSymbols.map((s) => s.category || "forex"))).sort();
              const filtered = adminSymbols.filter((s) => {
                const matchCat = symCat === "all" || s.category === symCat;
                const matchQ = !symQ || s.symbol.toLowerCase().includes(symQ.toLowerCase()) || (s.display || "").toLowerCase().includes(symQ.toLowerCase());
                return matchCat && matchQ;
              });
              const openEdit = (s: any) => setSymEdit({ sym: s.symbol, spread: Number(s.spread ?? 0), spreadType: s.spreadType || "FIXED", spreadMax: Number(s.spreadMax ?? 0), id: s.id, swapLong: Number(s.swapLong ?? 0), swapShort: Number(s.swapShort ?? 0), commissionPerLot: Number(s.commissionPerLot ?? 0) });
              const toggleEnabled = async (s: any) => {
                const r = await fetch("/api/admin/symbols/" + s.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) }).then((x) => x.json());
                if (r.ok) setAdminSymbols((prev) => prev.map((x) => x.id === s.id ? { ...x, enabled: !s.enabled } : x));
                else setErr(r.error || "Failed");
              };
              return (
                <div className="flex h-full flex-col">
                  {/* Toolbar */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                    <input value={symQ} onChange={(e) => setSymQ(e.target.value)} placeholder="Search symbol…" className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] outline-none" style={{ color: "var(--text)", width: 160 }} />
                    <select value={symCat} onChange={(e) => setSymCat(e.target.value)} className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] outline-none" style={{ color: "var(--text)" }}>
                      <option value="all">All categories</option>
                      {cats.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                    </select>
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>{filtered.length} / {adminSymbols.length} symbols</span>
                    <span className="ml-auto text-[10px]" style={{ color: "var(--muted)" }}>Click a row to edit spread / swap / commission</span>
                  </div>
                  {/* Table */}
                  <div className="flex-1 overflow-auto">
                    {adminSymbols.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--muted)" }}>No symbols configured. Add them via Admin → Symbols.</div>
                    ) : (
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr>
                            <th className={thc} style={{ color: "var(--muted)" }}>Symbol</th>
                            <th className={thc} style={{ color: "var(--muted)" }}>Display</th>
                            <th className={thc} style={{ color: "var(--muted)" }}>Cat</th>
                            <th className={thc} style={{ color: "var(--muted)" }}>Digits</th>
                            <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Spread</th>
                            <th className={thc} style={{ color: "var(--muted)" }}>Type</th>
                            <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Swap L</th>
                            <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Swap S</th>
                            <th className={thc + " text-right"} style={{ color: "var(--muted)" }}>Comm/lot</th>
                            <th className={thc + " text-center"} style={{ color: "var(--muted)" }}>On</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((s) => {
                            const isFloat = (s.spreadType || "FIXED") === "FLOATING";
                            const liveSp = liveSpreadPips[s.symbol];
                            const dispSp = isFloat && liveSp != null && liveSp > 0 ? liveSp : Number(s.spread ?? 0);
                            return (
                              <tr key={s.id} className="cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]" onClick={() => openEdit(s)}>
                                <td className={tdc + " font-mono font-semibold"}>{s.symbol}</td>
                                <td className={tdc} style={{ color: "var(--muted)" }}>{s.display || s.symbol}</td>
                                <td className={tdc} style={{ color: "var(--muted)" }}>{s.category || "forex"}</td>
                                <td className={tdc + " tabular-nums text-center"}>{s.digits}</td>
                                <td className={tdc + " tabular-nums text-right"}>{dispSp} pips</td>
                                <td className={tdc}>
                                  <span className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: isFloat ? "rgba(245,158,11,0.15)" : "rgba(99,102,241,0.15)", color: isFloat ? "#d97706" : "#6366f1" }}>{isFloat ? "Float" : "Fixed"}</span>
                                </td>
                                <td className={tdc + " tabular-nums text-right"} style={{ color: Number(s.swapLong) !== 0 ? (Number(s.swapLong) > 0 ? "#22c55e" : "#e05260") : "var(--muted)" }}>{Number(s.swapLong ?? 0).toFixed(2)}</td>
                                <td className={tdc + " tabular-nums text-right"} style={{ color: Number(s.swapShort) !== 0 ? (Number(s.swapShort) > 0 ? "#22c55e" : "#e05260") : "var(--muted)" }}>{Number(s.swapShort ?? 0).toFixed(2)}</td>
                                <td className={tdc + " tabular-nums text-right"}>{Number(s.commissionPerLot ?? 0).toFixed(2)}</td>
                                <td className={tdc + " text-center"} onClick={(e) => { e.stopPropagation(); toggleEnabled(s); }}>
                                  <span className={"rounded-full px-1.5 py-0.5 text-[9px] font-bold cursor-pointer " + (s.enabled ? "text-[#16a34a]" : "text-[var(--muted)]")} style={{ background: s.enabled ? "rgba(22,163,74,0.12)" : "color-mix(in srgb, var(--border) 60%, transparent)" }}>{s.enabled ? "ON" : "OFF"}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })()}

            {tab === "groups" && !dataReady && <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…</div>}
            {tab === "groups" && dataReady && (() => {
              const thc = "px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--muted)]";
              const tdc = "px-2 py-1.5 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_38%,transparent)]";
              return (
                <div className="flex h-full gap-3">
                  {/* Group list */}
                  <div className="flex-1 overflow-auto">
                    <table className="w-full border-collapse">
                      <thead><tr className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]">
                        <th className={thc}>Name</th>
                        <th className={thc}>Manager</th>
                        <th className={thc + " text-right"}>Clients</th>
                        <th className={thc + " text-right"}>Spread Markup</th>
                        <th className={thc + " text-right"}>Leverage</th>
                        <th className={thc + " text-center"}>Swap-Free</th>
                        <th className={thc + " text-right"}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {tradeGroups.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No groups yet. Create one →</td></tr>}
                        {tradeGroups.map((g: any) => {
                          const mgr = managers.find((m: any) => m.id === g.managerId);
                          const memberCount = clients.filter((c: any) => c.groupId === g.id).length;
                          const isEditing = grpEdit?.id === g.id;
                          const cfg = g.config || {};
                          return (
                            <tr key={g.id} style={isEditing ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                              <td className={tdc + " font-medium"}>{g.name}</td>
                              <td className={tdc} style={{ color: "var(--muted)" }}>{mgr ? mgr.name : "Admin-level"}</td>
                              <td className={tdc + " text-right tabular-nums"}>{memberCount}</td>
                              <td className={tdc + " text-right tabular-nums"}>{g.spread != null ? `${g.spread} pips` : "—"}</td>
                              <td className={tdc + " text-right tabular-nums"}>{cfg.leverage ? `1:${cfg.leverage}` : "—"}</td>
                              <td className={tdc + " text-center"}>{cfg.swapFree ? <span className="text-[9px] font-bold" style={{ color: "#22c55e" }}>YES</span> : <span className="text-[9px]" style={{ color: "var(--muted)" }}>No</span>}</td>
                              <td className={tdc + " text-right"}>
                                <button onClick={() => setGrpEdit(g)} className="mr-1.5 rounded px-1.5 py-0.5 text-[10px]" style={{ color: "var(--accent)" }} title="Edit"><i className="fa-solid fa-pen" /></button>
                                <button onClick={() => delGroup(g)} className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: SELL }} title="Delete"><i className="fa-solid fa-trash" /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Create/Edit panel */}
                  <div className="w-60 shrink-0 overflow-y-auto border-l border-[var(--border)] pl-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{grpEdit ? "Edit Group" : "New Group"}</div>
                    {/* helper to read/write a config field on either grpEdit or grpForm */}
                    {(() => {
                      const cfgVal = (key: string) => (grpEdit ? (grpEdit.config || {}) : (grpForm.config || {}))[key];
                      const setCfg = (key: string, val: any) => grpEdit
                        ? setGrpEdit((g: any) => ({ ...g, config: { ...(g.config || {}), [key]: val } }))
                        : setGrpForm((f: any) => ({ ...f, config: { ...(f.config || {}), [key]: val } }));
                      const inp = "mb-2 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none";
                      const lbl = "mb-1 text-[9px] font-semibold uppercase" as const;
                      return (
                        <>
                          <div className={lbl} style={{ color: "var(--muted)" }}>Name</div>
                          <input value={grpEdit?.name ?? grpForm.name ?? ""} onChange={(e) => grpEdit ? setGrpEdit((g: any) => ({ ...g, name: e.target.value })) : setGrpForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. VIP, Standard" className={inp} />
                          <div className={lbl} style={{ color: "var(--muted)" }}>Manager</div>
                          <select value={grpEdit?.managerId ?? grpForm.managerId ?? ""} onChange={(e) => { const v = e.target.value || null; grpEdit ? setGrpEdit((g: any) => ({ ...g, managerId: v })) : setGrpForm((f: any) => ({ ...f, managerId: v })); }} className={inp}>
                            <option value="">Admin-level</option>
                            {managers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <div className={lbl} style={{ color: "var(--muted)" }}>Spread Markup (pips)</div>
                          <input type="number" min={0} step={0.1} value={grpEdit?.spread ?? grpForm.spread ?? ""} onChange={(e) => grpEdit ? setGrpEdit((g: any) => ({ ...g, spread: e.target.value })) : setGrpForm((f: any) => ({ ...f, spread: e.target.value }))} placeholder="0" className={inp} />
                          {/* Swap settings */}
                          <div className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Swap</div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className={lbl} style={{ color: "var(--muted)", marginBottom: 0 }}>Swap Enabled <span className="font-normal opacity-60">(off = Islamic)</span></div>
                            <button onClick={() => grpEdit ? setGrpEdit((g: any) => ({ ...g, swapEnabled: !(g.swapEnabled !== false) })) : setGrpForm((f: any) => ({ ...f, swapEnabled: !(f.swapEnabled !== false) }))} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: (grpEdit ? grpEdit.swapEnabled !== false : grpForm.swapEnabled !== false) ? "var(--accent)" : "var(--border)" }}>
                              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ left: (grpEdit ? grpEdit.swapEnabled !== false : grpForm.swapEnabled !== false) ? "calc(100% - 18px)" : 2, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} />
                            </button>
                          </div>
                          <div className={lbl} style={{ color: "var(--muted)" }}>Swap Multiplier <span className="font-normal opacity-60">(1=standard, 0.5=VIP half)</span></div>
                          <input type="number" min={0} max={10} step={0.1} value={grpEdit?.swapMultiplier ?? grpForm.swapMultiplier ?? 1} onChange={(e) => grpEdit ? setGrpEdit((g: any) => ({ ...g, swapMultiplier: e.target.value })) : setGrpForm((f: any) => ({ ...f, swapMultiplier: e.target.value }))} className={inp} />
                          {/* Commission */}
                          <div className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Commission</div>
                          <div className={lbl} style={{ color: "var(--muted)" }}>Commission/Lot Override <span className="font-normal opacity-60">(-1 = use symbol default)</span></div>
                          <input type="number" min={-1} step={0.5} value={grpEdit?.commissionPerLot ?? grpForm.commissionPerLot ?? -1} onChange={(e) => grpEdit ? setGrpEdit((g: any) => ({ ...g, commissionPerLot: e.target.value })) : setGrpForm((f: any) => ({ ...f, commissionPerLot: e.target.value }))} className={inp} />
                          <div className={lbl} style={{ color: "var(--muted)" }}>Default Leverage</div>
                          <select value={cfgVal("leverage") ?? ""} onChange={(e) => setCfg("leverage", e.target.value ? Number(e.target.value) : null)} className={inp}>
                            <option value="">Inherit from account</option>
                            {[10,25,50,100,200,400,500,1000].map((v) => <option key={v} value={v}>1:{v}</option>)}
                          </select>
                          <div className="mb-2 flex items-center justify-between">
                            <div className={lbl} style={{ color: "var(--muted)", marginBottom: 0 }}>Swap-Free</div>
                            <button onClick={() => setCfg("swapFree", !cfgVal("swapFree"))} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: cfgVal("swapFree") ? "var(--accent)" : "var(--border)" }}>
                              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ left: cfgVal("swapFree") ? "calc(100% - 18px)" : 2, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} />
                            </button>
                          </div>
                          <div className="mb-2 flex gap-2">
                            <div className="flex-1">
                              <div className={lbl} style={{ color: "var(--muted)" }}>Min Lots</div>
                              <input type="number" min={0.01} step={0.01} value={cfgVal("minLots") ?? ""} onChange={(e) => setCfg("minLots", e.target.value ? Number(e.target.value) : null)} placeholder="0.01" className={inp} style={{ marginBottom: 0 }} />
                            </div>
                            <div className="flex-1">
                              <div className={lbl} style={{ color: "var(--muted)" }}>Max Lots</div>
                              <input type="number" min={0.01} step={1} value={cfgVal("maxLots") ?? ""} onChange={(e) => setCfg("maxLots", e.target.value ? Number(e.target.value) : null)} placeholder="100" className={inp} style={{ marginBottom: 0 }} />
                            </div>
                          </div>
                          <div className={lbl} style={{ color: "var(--muted)" }}>MC Level (%)</div>
                          <input type="number" min={0} step={5} value={cfgVal("mcLevel") ?? ""} onChange={(e) => setCfg("mcLevel", e.target.value ? Number(e.target.value) : null)} placeholder="50" className={inp} />
                        </>
                      );
                    })()}
                    <div className="flex gap-1.5 pt-1">
                      {grpEdit ? (<>
                        <button onClick={async () => {
                          const r = await fetch("/api/admin/groups/" + grpEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: grpEdit.name, managerId: grpEdit.managerId || null, spread: Number(grpEdit.spread) || 0, config: grpEdit.config || {}, swapEnabled: grpEdit.swapEnabled !== false, swapMultiplier: Number(grpEdit.swapMultiplier ?? 1), commissionPerLot: Number(grpEdit.commissionPerLot ?? -1) }) }).then((x) => x.json());
                          if (r.ok) { setOk("Group updated"); setGrpEdit(null); loadAll(); } else setErr(r.error || "Failed");
                        }} className="flex-1 rounded py-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Save</button>
                        <button onClick={() => setGrpEdit(null)} className="rounded border border-[var(--border)] px-2 py-1.5 text-[11px]">Cancel</button>
                      </>) : (
                        <button onClick={async () => {
                          if (!grpForm.name) return;
                          const r = await fetch("/api/admin/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: grpForm.name, managerId: grpForm.managerId || null, spread: Number(grpForm.spread) || 0, config: grpForm.config || {}, swapEnabled: grpForm.swapEnabled !== false, swapMultiplier: Number(grpForm.swapMultiplier ?? 1), commissionPerLot: Number(grpForm.commissionPerLot ?? -1) }) }).then((x) => x.json());
                          if (r.ok) { setOk("Group created"); setGrpForm({}); loadAll(); } else setErr(r.error || "Failed");
                        }} className="flex-1 rounded py-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Create Group</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── RISK tab ── */}
            {tab === "risk" && !dataReady && <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--muted)" }}><i className="fa-solid fa-circle-notch fa-spin mr-2" />Loading…</div>}
            {tab === "risk" && dataReady && (() => {
              const thc = "px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--muted)] whitespace-nowrap";
              const tdc = "px-2 py-1.5 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_38%,transparent)] tabular-nums";

              // --- Symbol-level net exposure (computed from live open positions + live prices) ---
              const symExp: Record<string, { buy: number; sell: number; cnt: number }> = {};
              open.forEach((p: any) => {
                if (!symExp[p.symbol]) symExp[p.symbol] = { buy: 0, sell: 0, cnt: 0 };
                if (p.type === "BUY") symExp[p.symbol].buy += Number(p.lots);
                else symExp[p.symbol].sell += Number(p.lots);
                symExp[p.symbol].cnt++;
              });
              const symRows = Object.entries(symExp).map(([sym, e]) => {
                const net = e.buy - e.sell;
                const price = prices[sym] || 0;
                const cs = contractFor(catMap[sym] || "forex", sym);
                const exposure = Math.abs(net) * cs * price;
                return { sym, ...e, net, price, exposure, var1: exposure * 0.01 };
              }).sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure));

              const totalBuy = symRows.reduce((s, r) => s + r.buy, 0);
              const totalSell = symRows.reduce((s, r) => s + r.sell, 0);
              const totalNet = totalBuy - totalSell;
              const totalExp = symRows.reduce((s, r) => s + r.exposure, 0);
              const fmtUSD = (v: number) => v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);

              // --- Client margin levels ---
              const riskClients = clients.map((c: any) => {
                const accPos = open.filter((p: any) => p.accountLogin === c.login);
                if (!accPos.length) return null;
                const fl = accPos.reduce((s: number, p: any) =>
                  s + pnlOf(p, prices[p.symbol] ?? Number(p.openPrice), contractFor(catMap[p.symbol] || "forex", p.symbol)), 0);
                const balance = Number(c.deposit ?? 0) + Number(c.pnl ?? 0) - Number(c.withdrawal ?? 0);
                const eq = balance + fl + Number(c.credit ?? 0) + Number(c.bonus ?? 0) + Number(c.insurance ?? 0);
                const usedM = accPos.reduce((s: number, p: any) => {
                  const pr = prices[p.symbol] ?? Number(p.openPrice);
                  const m = (Number(p.lots) * contractFor(catMap[p.symbol] || "forex", p.symbol) * pr) / (Number(c.leverage) || 100);
                  return s + (/JPY$/i.test(p.symbol) ? m / 100 : m);
                }, 0);
                const mlvl = usedM > 0 ? (eq / usedM) * 100 : null;
                return { c, fl, eq, usedM, freeM: eq - usedM, mlvl, positions: accPos.length };
              }).filter(Boolean).filter((r: any) => r.mlvl !== null)
                .sort((a: any, b: any) => (a.mlvl ?? 9999) - (b.mlvl ?? 9999));

              const inDanger = (riskClients as any[]).filter((r) => (r.mlvl ?? 9999) < 100).length;
              const inWarning = (riskClients as any[]).filter((r) => { const m = r.mlvl ?? 9999; return m >= 100 && m < 150; }).length;
              const activeAccounts = (riskClients as any[]).length;
              const mlColor = (v: number) => v >= 200 ? BUY : v >= 150 ? "#f59e0b" : v >= 100 ? "#f97316" : SELL;

              const KpiCard = ({ label, value, sub, col }: { label: string; value: string; sub?: string; col?: string }) => (
                <div className="flex min-w-[90px] flex-col gap-0.5 rounded-lg border border-[var(--border)] px-3 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
                  <div className="text-[15px] font-bold tabular-nums leading-tight" style={{ color: col || "var(--text)" }}>{value}</div>
                  {sub && <div className="text-[9px]" style={{ color: "var(--muted)" }}>{sub}</div>}
                </div>
              );

              return (
                <div className="flex flex-col gap-2 p-1">
                  {/* Active risk alert banners */}
                  {(inDanger > 0 || inWarning > 0) && (
                    <div className="flex shrink-0 flex-col gap-1">
                      {inDanger > 0 && (
                        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold" style={{ borderColor: SELL, background: "color-mix(in srgb, var(--red) 12%, transparent)", color: SELL }}>
                          <i className="fa-solid fa-triangle-exclamation" />
                          {inDanger} account{inDanger !== 1 ? "s" : ""} in danger zone (margin level below 100%) — liquidation imminent
                        </div>
                      )}
                      {inWarning > 0 && (
                        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold" style={{ borderColor: "#f97316", background: "color-mix(in srgb, #f97316 8%, transparent)", color: "#f97316" }}>
                          <i className="fa-solid fa-triangle-exclamation" />
                          {inWarning} account{inWarning !== 1 ? "s" : ""} in warning zone (margin 100–150%) — monitor closely and consider reaching out
                        </div>
                      )}
                    </div>
                  )}

                  {/* KPI summary row */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <KpiCard label="Open Positions" value={String(open.length)} sub={activeAccounts + " accounts"} />
                    <KpiCard label="Gross Long" value={totalBuy.toFixed(2) + "L"} sub="total buy lots" col={BUY} />
                    <KpiCard label="Gross Short" value={totalSell.toFixed(2) + "L"} sub="total sell lots" col={SELL} />
                    <KpiCard label="Net Position" value={(totalNet > 0 ? "+" : "") + totalNet.toFixed(2) + "L"} sub="buy − sell" col={totalNet > 0 ? BUY : totalNet < 0 ? SELL : "var(--muted)"} />
                    <KpiCard label="Net USD Exposure" value={fmtUSD(totalExp)} sub="broker book risk" />
                    <KpiCard label="1% VAR" value={fmtUSD(totalExp * 0.01)} sub="if price moves 1%" />
                    <KpiCard label="Danger Zone" value={String(inDanger)} sub="margin < 100%" col={inDanger > 0 ? SELL : "var(--muted)"} />
                    <KpiCard label="Warning Zone" value={String(inWarning)} sub="margin 100–150%" col={inWarning > 0 ? "#f97316" : "var(--muted)"} />
                  </div>

                  {/* Two-panel tables */}
                  <div className="grid min-h-0 flex-1 gap-3 overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    {/* Symbol net exposure */}
                    <div className="flex flex-col overflow-hidden">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                        Symbol Net Exposure · sorted by USD risk
                      </div>
                      <div className="flex-1 overflow-auto">
                        <table className="w-full border-collapse">
                          <thead><tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel)]">
                            <SortTh tbl="riskSym" k="sym" label="Symbol" cls={thc} />
                            <SortTh tbl="riskSym" k="buy" label="Buy L" align="right" cls={thc} />
                            <SortTh tbl="riskSym" k="sell" label="Sell L" align="right" cls={thc} />
                            <SortTh tbl="riskSym" k="net" label="Net" align="right" cls={thc} />
                            <th className={thc + " text-center"}>Bias</th>
                            <SortTh tbl="riskSym" k="price" label="Price" align="right" cls={thc} />
                            <SortTh tbl="riskSym" k="exposure" label="Exp. USD" align="right" cls={thc} />
                            <SortTh tbl="riskSym" k="var1" label="1% VAR" align="right" cls={thc} />
                            <SortTh tbl="riskSym" k="cnt" label="Pos" align="right" cls={thc} />
                          </tr></thead>
                          <tbody>
                            {symRows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No open positions</td></tr>}
                            {sortRows("riskSym", symRows, {
                              sym: (r) => r.sym, buy: (r) => r.buy, sell: (r) => r.sell,
                              net: (r) => r.net, price: (r) => r.price,
                              exposure: (r) => r.exposure, var1: (r) => r.var1, cnt: (r) => r.cnt,
                            }).map((r) => {
                              const total = r.buy + r.sell;
                              const buyPct = total > 0 ? (r.buy / total) * 100 : 50;
                              const priceStr = r.price ? (r.price < 10 ? r.price.toFixed(5) : r.price < 1000 ? r.price.toFixed(3) : r.price.toFixed(1)) : "—";
                              return (
                                <tr key={r.sym}>
                                  <td className={tdc + " font-semibold"}>{r.sym}</td>
                                  <td className={tdc + " text-right"} style={{ color: BUY }}>{r.buy.toFixed(2)}</td>
                                  <td className={tdc + " text-right"} style={{ color: SELL }}>{r.sell.toFixed(2)}</td>
                                  <td className={tdc + " text-right font-bold"} style={{ color: r.net > 0 ? BUY : r.net < 0 ? SELL : "var(--muted)" }}>
                                    {r.net > 0 ? "+" : ""}{r.net.toFixed(2)}
                                  </td>
                                  <td className={tdc + " text-center"}>
                                    <div className="mx-auto relative h-2 w-14 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb,var(--red) 25%,transparent)" }}>
                                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: buyPct + "%", background: BUY, opacity: 0.85 }} />
                                    </div>
                                  </td>
                                  <td className={tdc + " text-right"}>{priceStr}</td>
                                  <td className={tdc + " text-right font-semibold"}>{r.price ? fmtUSD(r.exposure) : "—"}</td>
                                  <td className={tdc + " text-right"} style={{ color: "var(--muted)" }}>{r.price ? fmtUSD(r.var1) : "—"}</td>
                                  <td className={tdc + " text-right"}>{r.cnt}</td>
                                </tr>
                              );
                            })}
                            {symRows.length > 0 && (
                              <tr style={{ background: "color-mix(in srgb, var(--accent) 7%, transparent)" }}>
                                <td className={tdc + " font-bold"}>TOTAL</td>
                                <td className={tdc + " text-right font-bold"} style={{ color: BUY }}>{totalBuy.toFixed(2)}</td>
                                <td className={tdc + " text-right font-bold"} style={{ color: SELL }}>{totalSell.toFixed(2)}</td>
                                <td className={tdc + " text-right font-bold"} style={{ color: totalNet > 0 ? BUY : totalNet < 0 ? SELL : "var(--muted)" }}>
                                  {totalNet > 0 ? "+" : ""}{totalNet.toFixed(2)}
                                </td>
                                <td className={tdc} />
                                <td className={tdc} />
                                <td className={tdc + " text-right font-bold"}>{fmtUSD(totalExp)}</td>
                                <td className={tdc + " text-right"} style={{ color: "var(--muted)" }}>{fmtUSD(totalExp * 0.01)}</td>
                                <td className={tdc + " text-right font-bold"}>{open.length}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Client margin levels */}
                    <div className="flex flex-col overflow-hidden border-l border-[var(--border)] pl-3">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                        Client Margin Levels · worst first · click to open in Clients
                      </div>
                      <div className="flex-1 overflow-auto">
                        <table className="w-full border-collapse">
                          <thead><tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel)]">
                            <SortTh tbl="riskCli" k="login" label="Login" cls={thc} />
                            <SortTh tbl="riskCli" k="name" label="Name" cls={thc} />
                            <SortTh tbl="riskCli" k="eq" label="Equity" align="right" cls={thc} />
                            <SortTh tbl="riskCli" k="usedM" label="Margin" align="right" cls={thc} />
                            <SortTh tbl="riskCli" k="freeM" label="Free" align="right" cls={thc} />
                            <SortTh tbl="riskCli" k="mlvl" label="Level" align="right" cls={thc} />
                            <SortTh tbl="riskCli" k="soLevel" label="S/O" align="right" cls={thc} />
                            <SortTh tbl="riskCli" k="positions" label="Pos" align="right" cls={thc} />
                          </tr></thead>
                          <tbody>
                            {riskClients.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No accounts with open positions</td></tr>}
                            {sortRows("riskCli", riskClients as any[], {
                              login: (r) => r.c.login, name: (r) => r.c.name,
                              eq: (r) => r.eq, usedM: (r) => r.usedM, freeM: (r) => r.freeM,
                              mlvl: (r) => r.mlvl, soLevel: (r) => Number(r.c.mcLevel), positions: (r) => r.positions,
                            }).map((r: any) => {
                              const lvl = r.mlvl ?? 9999;
                              const rowBg = lvl < 100
                                ? { background: "color-mix(in srgb, var(--red) 9%, transparent)" }
                                : lvl < 150 ? { background: "color-mix(in srgb, #f97316 6%, transparent)" } : undefined;
                              return (
                                <tr key={r.c.id} style={rowBg} className="cursor-pointer hover:opacity-80"
                                  onClick={() => { setTab("clients"); setCliQ(r.c.login); }}
                                  title="Click to open in Clients tab">
                                  <td className={tdc}>{r.c.login}</td>
                                  <td className={tdc + " max-w-[90px] truncate"}>{r.c.name}</td>
                                  <td className={tdc + " text-right"} style={{ color: r.eq >= 0 ? BUY : SELL }}>{gnum(r.eq, 2)}</td>
                                  <td className={tdc + " text-right"}>{gnum(r.usedM, 2)}</td>
                                  <td className={tdc + " text-right"} style={{ color: r.freeM >= 0 ? BUY : SELL }}>{gnum(r.freeM, 2)}</td>
                                  <td className={tdc + " text-right font-bold"} style={{ color: mlColor(lvl) }}>{r.mlvl != null ? lvl.toFixed(0) + "%" : "—"}</td>
                                  <td className={tdc + " text-right"} style={{ color: "var(--muted)" }}>{Number(r.c.mcLevel) > 0 ? Number(r.c.mcLevel).toFixed(0) + "%" : "—"}</td>
                                  <td className={tdc + " text-right"}>{r.positions}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── COPY TRADING tab ── */}
            {tab === "copy" && (() => {
              if (tabState.copy && copyRelations.length === 0) {
                fetch("/api/admin/copy-relations").then((r) => r.json()).then((d) => { if (d.ok) setCopyRelations(d.relations); }).catch(() => {});
              }
              const accOptions = clients.filter((c: any) => !c.locked && !c.deactivated);
              const thc = "px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--muted)] whitespace-nowrap";
              const tdc = "px-2 py-1.5 text-[11px] border-b border-[color-mix(in_srgb,var(--border)_38%,transparent)] tabular-nums";
              const createCopy = async () => {
                setCopyErr("");
                if (!copyForm.masterAccId || !copyForm.followerAccId) { setCopyErr("Select both accounts"); return; }
                const r = await fetch("/api/admin/copy-relations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masterAccId: copyForm.masterAccId, followerAccId: copyForm.followerAccId, ratio: Number(copyForm.ratio) || 1.0 }) }).then((x) => x.json());
                if (!r.ok) { setCopyErr(r.error || "Failed"); return; }
                setCopyRelations((prev) => [r.relation, ...prev]); setCopyForm({ masterAccId: "", followerAccId: "", ratio: "1.0" });
              };
              const deleteCopy = async (id: string) => {
                const r = await fetch("/api/admin/copy-relations/" + id, { method: "DELETE" }).then((x) => x.json());
                if (r.ok) setCopyRelations((prev) => prev.filter((x) => x.id !== id));
              };
              const toggleActive = async (id: string, active: boolean) => {
                const r = await fetch("/api/admin/copy-relations/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }).then((x) => x.json());
                if (r.ok) setCopyRelations((prev) => prev.map((x) => x.id === id ? { ...x, active } : x));
              };
              return (
                <div className="flex h-full flex-col gap-3 overflow-auto p-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Copy Trading — master account trades automatically replicate to follower accounts
                  </div>

                  {/* Create new relation */}
                  <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-[9px] font-semibold uppercase" style={{ color: "var(--muted)" }}>Master Account</div>
                      <select value={copyForm.masterAccId} onChange={(e) => setCopyForm((f) => ({ ...f, masterAccId: e.target.value }))} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none min-w-[160px]">
                        <option value="">— select master —</option>
                        {accOptions.map((c: any) => <option key={c.id} value={c.id}>{c.login} · {c.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-[9px] font-semibold uppercase" style={{ color: "var(--muted)" }}>Follower Account</div>
                      <select value={copyForm.followerAccId} onChange={(e) => setCopyForm((f) => ({ ...f, followerAccId: e.target.value }))} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none min-w-[160px]">
                        <option value="">— select follower —</option>
                        {accOptions.filter((c: any) => c.id !== copyForm.masterAccId).map((c: any) => <option key={c.id} value={c.id}>{c.login} · {c.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-[9px] font-semibold uppercase" style={{ color: "var(--muted)" }}>Lot Ratio</div>
                      <input type="number" min="0.01" step="0.01" value={copyForm.ratio} onChange={(e) => setCopyForm((f) => ({ ...f, ratio: e.target.value }))} placeholder="1.0" className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none" />
                    </div>
                    <button onClick={createCopy} className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: BUY }}>
                      <i className="fa-solid fa-link mr-1.5" />Add Relation
                    </button>
                    {copyErr && <div className="text-[11px]" style={{ color: SELL }}>{copyErr}</div>}
                  </div>

                  {/* Relations table */}
                  <div className="flex-1 overflow-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel)]">
                          <th className={thc}>Master</th>
                          <th className={thc}>Follower</th>
                          <th className={thc + " text-right"}>Ratio</th>
                          <th className={thc + " text-center"}>Status</th>
                          <th className={thc}>Since</th>
                          <th className={thc} />
                        </tr>
                      </thead>
                      <tbody>
                        {copyRelations.length === 0 && (
                          <tr><td colSpan={6} className="py-8 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No copy relations yet — add one above</td></tr>
                        )}
                        {copyRelations.map((r) => (
                          <tr key={r.id} className="hover:bg-[var(--soft)]">
                            <td className={tdc}>
                              <div className="font-semibold">{r.master.login}</div>
                              <div className="text-[9px]" style={{ color: "var(--muted)" }}>{r.master.name}</div>
                            </td>
                            <td className={tdc}>
                              <div className="font-semibold">{r.follower.login}</div>
                              <div className="text-[9px]" style={{ color: "var(--muted)" }}>{r.follower.name}</div>
                            </td>
                            <td className={tdc + " text-right font-mono font-semibold"}>{Number(r.ratio).toFixed(2)}×</td>
                            <td className={tdc + " text-center"}>
                              <button onClick={() => toggleActive(r.id, !r.active)} className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: r.active ? "color-mix(in srgb, var(--green) 15%, transparent)" : "color-mix(in srgb, var(--border) 40%, transparent)", color: r.active ? BUY : "var(--muted)" }}>
                                {r.active ? "LIVE" : "PAUSED"}
                              </button>
                            </td>
                            <td className={tdc + " text-[9px]"} style={{ color: "var(--muted)" }}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                            <td className={tdc + " text-right"}>
                              <button onClick={() => deleteCopy(r.id)} className="rounded px-2 py-0.5 text-[9px] font-semibold hover:opacity-80" style={{ background: "color-mix(in srgb, var(--red) 12%, transparent)", color: SELL }} title="Remove copy relation">
                                <i className="fa-solid fa-unlink mr-0.5" />Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="shrink-0 text-[9px]" style={{ color: "var(--muted)" }}>
                    Ratio 1.0 = same lots as master · 0.5 = half lots · 2.0 = double lots. SL/TP are mirrored at the same price levels. Follower positions close when the master closes (or hit their own SL/TP independently).
                  </div>
                </div>
              );
            })()}

            {/* ── SIGNALS tab ── */}
            {tab === "signals" && (() => {
              if (tabState.signals && adminSignals.length === 0) loadSignals();
              const activeSignals = adminSignals.filter((s) => s.active);
              const closedSignals = adminSignals.filter((s) => !s.active);
              // Build category-grouped symbol options (like market watch)
              const sigCats = Array.from(new Set(adminSymbols.map((s: any) => (s.category || "forex").toLowerCase()))).sort() as string[];
              const fld = "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors";
              return (
                <div className="flex h-full gap-3 overflow-auto p-2">
                  {/* ─ Publish form panel ─ */}
                  <div className="flex w-[300px] shrink-0 flex-col gap-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
                    {/* Panel header */}
                    <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
                      <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px]" style={{ background: "rgba(22,199,154,0.15)", color: "var(--accent)" }}>
                        <i className="fa-solid fa-signal" />
                      </span>
                      <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text)" }}>Publish New Signal</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
                      {/* Symbol + Direction row */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Symbol</div>
                          <select value={sigForm.symbol} onChange={(e) => setSigForm((f) => ({ ...f, symbol: e.target.value }))} className={fld} style={{ color: sigForm.symbol ? "var(--text)" : "var(--muted)" }}>
                            <option value="">Select…</option>
                            {sigCats.map((cat) => (
                              <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                                {adminSymbols.filter((s: any) => (s.category || "forex").toLowerCase() === cat).map((s: any) => (
                                  <option key={s.symbol} value={s.symbol}>{s.symbol}{s.display && s.display !== s.symbol ? ` · ${s.display}` : ""}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Direction</div>
                          <div className="flex h-[30px] overflow-hidden rounded-lg border border-[var(--border)] text-[11px] font-bold">
                            <button onClick={() => setSigForm((f) => ({ ...f, direction: "BUY" }))} className="flex-1 transition-colors" style={{ background: sigForm.direction === "BUY" ? BUY : "var(--bg)", color: sigForm.direction === "BUY" ? "#fff" : "var(--muted)" }}>BUY</button>
                            <button onClick={() => setSigForm((f) => ({ ...f, direction: "SELL" }))} className="flex-1 transition-colors" style={{ background: sigForm.direction === "SELL" ? SELL : "var(--bg)", color: sigForm.direction === "SELL" ? "#fff" : "var(--muted)" }}>SELL</button>
                          </div>
                        </div>
                      </div>
                      {/* Price fields */}
                      <div className="grid grid-cols-3 gap-2">
                        {([["Entry Price", "entryPrice"], ["Stop Loss", "sl"], ["Take Profit", "tp"]] as const).map(([label, key]) => (
                          <div key={key}>
                            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: key === "sl" ? "#f43f5e" : key === "tp" ? BUY : "var(--muted)" }}>{label}</div>
                            <input type="number" step="any" value={(sigForm as any)[key]} onChange={(e) => setSigForm((f) => ({ ...f, [key]: e.target.value }))} placeholder="0.00000" className={fld} />
                          </div>
                        ))}
                      </div>
                      {/* Rationale */}
                      <div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Rationale (optional)</div>
                        <textarea rows={2} value={sigForm.rationale} onChange={(e) => setSigForm((f) => ({ ...f, rationale: e.target.value }))} placeholder="e.g. Bullish breakout above 1.0850 resistance…" className={fld + " resize-none"} />
                      </div>
                      {sigMsg && (
                        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: sigMsg.ok ? `${BUY}18` : `${SELL}18`, color: sigMsg.ok ? BUY : SELL }}>
                          <i className={"fa-solid " + (sigMsg.ok ? "fa-circle-check" : "fa-circle-xmark")} />
                          {sigMsg.text}
                        </div>
                      )}
                      <button
                        disabled={sigSending || !sigForm.symbol.trim() || !sigForm.entryPrice}
                        onClick={async () => {
                          setSigSending(true); setSigMsg(null);
                          const r = await fetch("/api/admin/signals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sigForm.symbol.trim(), direction: sigForm.direction, entryPrice: parseFloat(sigForm.entryPrice), sl: parseFloat(sigForm.sl) || 0, tp: parseFloat(sigForm.tp) || 0, rationale: sigForm.rationale.trim() || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
                          setSigSending(false);
                          if (r.ok) { setSigMsg({ ok: true, text: "Signal published to all clients" }); setSigForm({ symbol: "", direction: "BUY", entryPrice: "", sl: "", tp: "", rationale: "" }); loadSignals(); }
                          else setSigMsg({ ok: false, text: r.error || "Failed" });
                        }}
                        className="rounded-lg py-2 text-[11px] font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
                        style={{ background: sigForm.direction === "BUY" ? `linear-gradient(90deg, ${BUY}, #1565c0)` : `linear-gradient(90deg, ${SELL}, #b71c1c)`, boxShadow: `0 4px 12px -4px ${sigForm.direction === "BUY" ? BUY : SELL}88` }}
                      >
                        <i className="fa-solid fa-satellite-dish mr-1.5" />{sigSending ? "Publishing…" : `Publish ${sigForm.direction} Signal`}
                      </button>
                    </div>
                  </div>

                  {/* ─ Signal list panel ─ */}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto">
                    {/* Active */}
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
                      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2" style={{ background: `${BUY}08` }}>
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text)" }}>Active Signals</span>
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: `${BUY}22`, color: BUY }}>{activeSignals.length}</span>
                      </div>
                      <div className="p-2">
                        {activeSignals.length === 0 ? (
                          <div className="py-4 text-center text-[11px] italic" style={{ color: "var(--muted)" }}>No active signals. Publish one using the form.</div>
                        ) : activeSignals.map((sig: any) => (
                          <div key={sig.id} className="mb-2 last:mb-0 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px]" style={{ background: "var(--soft)" }}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: sig.direction === "BUY" ? BUY : SELL }}>{sig.direction}</span>
                                <span className="font-bold">{sig.symbol}</span>
                                <span className="tabular-nums" style={{ color: "var(--muted)" }}>@ {Number(sig.entryPrice).toFixed(5)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button title="Close signal" onClick={async () => { await fetch("/api/admin/signals/" + sig.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) }); loadSignals(); }} className="rounded-md px-2 py-0.5 text-[9px] font-semibold transition-colors hover:opacity-80" style={{ background: "var(--border)", color: "var(--text)" }}>Close</button>
                                <button title="Delete" onClick={async () => { await fetch("/api/admin/signals/" + sig.id, { method: "DELETE" }); loadSignals(); }} className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] transition-opacity hover:opacity-80" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>
                              </div>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-3 text-[10px]">
                              {Number(sig.sl) > 0 && <span className="flex items-center gap-1"><span style={{ color: "var(--muted)" }}>SL</span> <span className="font-semibold tabular-nums" style={{ color: SELL }}>{Number(sig.sl).toFixed(5)}</span></span>}
                              {Number(sig.tp) > 0 && <span className="flex items-center gap-1"><span style={{ color: "var(--muted)" }}>TP</span> <span className="font-semibold tabular-nums" style={{ color: BUY }}>{Number(sig.tp).toFixed(5)}</span></span>}
                              <span className="ml-auto" style={{ color: "var(--muted)" }}>{new Date(sig.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            {sig.rationale && <div className="mt-1 text-[10px] italic" style={{ color: "var(--muted)" }}>{sig.rationale}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Closed */}
                    {closedSignals.length > 0 && (
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Closed / Expired</span>
                          <span className="rounded-full px-2 py-0.5 text-[9px]" style={{ background: "var(--soft)", color: "var(--muted)" }}>{closedSignals.length}</span>
                        </div>
                        <div className="p-2">
                          {closedSignals.slice(0, 10).map((sig: any) => (
                            <div key={sig.id} className="mb-1.5 last:mb-0 flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] opacity-50">
                              <div className="flex items-center gap-2">
                                <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: sig.direction === "BUY" ? BUY : SELL }}>{sig.direction}</span>
                                <span className="font-semibold">{sig.symbol}</span>
                                <span className="tabular-nums text-[10px]" style={{ color: "var(--muted)" }}>@ {Number(sig.entryPrice).toFixed(5)}</span>
                                <span className="text-[10px]" style={{ color: "var(--muted)" }}>{new Date(sig.createdAt).toLocaleDateString()}</span>
                              </div>
                              <button onClick={async () => { await fetch("/api/admin/signals/" + sig.id, { method: "DELETE" }); loadSignals(); }} className="rounded p-1 text-[10px]" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── REFERRAL tab ── */}
            {tab === "referral" && features.referralProgram !== false && <ReferralPanel />}
            {tab === "referral" && features.referralProgram === false && (
              <div className="flex h-full flex-col items-center justify-center gap-2" style={{ color: "var(--muted)" }}>
                <i className="fa-solid fa-gift text-3xl" />
                <div className="text-[13px] font-semibold">Referral Program Disabled</div>
                <div className="text-[11px]">Enable it in Super Admin → Tenant → Feature Flags.</div>
              </div>
            )}

            {/* ── BROADCAST tab ── */}
            {tab === "broadcast" && (
              <div className="flex h-full gap-4 p-2">
                <div className="flex w-80 flex-col gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Send Announcement to All Clients</div>
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase" style={{ color: "var(--muted)" }}>Title</div>
                    <input value={bcTitle} onChange={(e) => { setBcTitle(e.target.value); setBcMsg(null); }} placeholder="e.g. Scheduled Maintenance" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase" style={{ color: "var(--muted)" }}>Message (optional)</div>
                    <textarea rows={4} value={bcBody} onChange={(e) => { setBcBody(e.target.value); setBcMsg(null); }} placeholder="Message body…" className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-none" />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[["Maintenance", "Scheduled Maintenance", "Our platform will undergo scheduled maintenance. Trading may be briefly unavailable."], ["Promotion", "Special Promotion", "A new promotion is now available. Contact your account manager to learn more."], ["Market News", "Market Update", "Stay informed with the latest market updates and analysis."]].map(([label, title, body]) => (
                      <button key={label} onClick={() => { setBcTitle(title); setBcBody(body); setBcMsg(null); }} className="rounded border px-2 py-0.5 text-[9px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{label}</button>
                    ))}
                  </div>
                  {bcMsg && <div className="text-[11px]" style={{ color: bcMsg.ok ? BUY : SELL }}>{bcMsg.text}</div>}
                  <button
                    disabled={bcSending || !bcTitle.trim()}
                    onClick={async () => {
                      setBcSending(true); setBcMsg(null);
                      const r = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: bcTitle.trim(), body: bcBody.trim() || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
                      setBcSending(false);
                      if (r.ok) { setBcMsg({ ok: true, text: "✓ Announcement sent to all clients" }); setBcTitle(""); setBcBody(""); }
                      else setBcMsg({ ok: false, text: r.error || "Failed to send" });
                    }}
                    className="rounded py-2 text-[11px] font-semibold text-white disabled:opacity-50"
                    style={{ background: BUY }}
                  >
                    <i className="fa-solid fa-bullhorn mr-1.5" />{bcSending ? "Sending…" : "Send to All Clients"}
                  </button>
                </div>
                <div className="flex-1 border-l border-[var(--border)] pl-4">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Recently Sent</div>
                  <div className="space-y-1.5 overflow-auto">
                    {notifs.filter((n: any) => n.type === "BROADCAST" || n.type === "ANNOUNCEMENT" || String(n.type || "").toUpperCase().includes("BROAD")).length === 0
                      ? <div className="text-[11px] italic" style={{ color: "var(--muted)" }}>No broadcasts sent yet. Use the Send Notification modal for a full history.</div>
                      : notifs.filter((n: any) => n.type === "BROADCAST" || n.type === "ANNOUNCEMENT" || String(n.type || "").toUpperCase().includes("BROAD")).slice(0, 20).map((n: any, i: number) => (
                        <div key={i} className="rounded border border-[var(--border)] bg-[var(--soft)] px-2 py-1.5 text-[11px]">
                          <div className="font-semibold">{n.title}</div>
                          {n.body && <div className="text-[10px]" style={{ color: "var(--muted)" }}>{n.body}</div>}
                          <div className="mt-0.5 text-[9px]" style={{ color: "var(--muted)" }}>{new Date(n.createdAt).toLocaleString()}</div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}


          </div>
        </div>
      </>)}

      {mgrModal && <ManagersModal onClose={() => { setMgrModal(false); loadAll(); }} />}
      {pmModal && <PaymentMethodsModal onClose={() => setPmModal(false)} />}

      {/* Admin 2FA setup / disable modal */}
      {adminTotpModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => { setAdminTotpModal(null); setAdminTotpErr(""); setAdminTotpCode(""); }}>
          <div className="ui-pop w-full max-w-sm rounded-2xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            {adminTotpModal === "setup" ? (<>
              <div className="mb-2 font-semibold">Set up Two-Factor Authentication</div>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Scan this QR code with Google Authenticator or Authy, then enter the 6-digit code to confirm.</p>
              {adminTotpQr && <img src={adminTotpQr} alt="QR code" className="mx-auto mb-2 rounded-lg" style={{ width: 160, height: 160 }} />}
              <div className="mb-3 rounded-lg px-3 py-2 text-center text-[10px] font-mono break-all" style={{ background: "var(--soft)", color: "var(--muted)" }}>{adminTotpSecret}</div>
              {adminTotpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{adminTotpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={adminTotpCode} onChange={(e) => setAdminTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setAdminTotpModal(null); setAdminTotpCode(""); setAdminTotpErr(""); }} className="flex-1 rounded-xl border py-2.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={adminConfirmTotpEnable} disabled={adminTotpBusy || adminTotpCode.length < 6} className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: BUY }}>
                  {adminTotpBusy ? "Verifying…" : "Enable 2FA"}
                </button>
              </div>
            </>) : (<>
              <div className="mb-2 font-semibold">Disable Two-Factor Authentication</div>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Enter the 6-digit code from your authenticator app to confirm.</p>
              {adminTotpErr && <div className="mb-2 text-[11px]" style={{ color: SELL }}>{adminTotpErr}</div>}
              <input autoFocus type="text" inputMode="numeric" maxLength={6} value={adminTotpCode} onChange={(e) => setAdminTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" className="mb-3 w-full rounded-xl border px-3 py-2.5 text-center text-sm tracking-[0.4em]" style={{ borderColor: "var(--border)", background: "var(--soft)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button onClick={() => { setAdminTotpModal(null); setAdminTotpCode(""); setAdminTotpErr(""); }} className="flex-1 rounded-xl border py-2.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
                <button onClick={adminConfirmTotpDisable} disabled={adminTotpBusy || adminTotpCode.length < 6} className="flex-[2] rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: SELL }}>
                  {adminTotpBusy ? "Verifying…" : "Disable 2FA"}
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* Symbol settings popup (from market watch right-click) */}
      {symEdit && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-[300px] rounded-xl border p-5 text-[12px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><div className="text-[14px] font-bold">{symEdit.sym}</div><div className="text-[10px] text-[var(--muted)]">Symbol spread settings</div></div>
              <button onClick={() => setSymEdit(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[10px] text-[var(--muted)]">Spread type</div>
                <div className="flex gap-1">
                  {["FIXED","FLOATING"].map((t) => { const active = symEdit.spreadType === t; return (
                    <button key={t} onClick={() => setSymEdit((s) => s ? { ...s, spreadType: t } : s)} className="flex-1 rounded py-1.5 text-[11px] font-semibold border transition-colors" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)", borderColor: active ? "var(--accent)" : "var(--border)" }}>{t.charAt(0) + t.slice(1).toLowerCase()}</button>
                  ); })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] text-[var(--muted)]">{symEdit.spreadType === "FLOATING" ? "Base spread (pips)" : "Spread (pips)"}</div>
                <input type="number" min="0" step="1" value={isNaN(symEdit.spread) ? "" : symEdit.spread} onChange={(e) => { const v = e.target.value; setSymEdit((s) => s ? { ...s, spread: v === "" ? NaN : Math.max(0, parseInt(v) || 0) } : s); }} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                {symEdit.spreadType === "FLOATING" && <div className="mt-1 text-[9px]" style={{ color: "#22c55e" }}>Floating: spread may widen automatically during off-market hours</div>}
              </div>
              {swapEnabled && (
                <div className="border-t border-[var(--border)] pt-3">
                  <div className="mb-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Swap rates (pips/night)</div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="mb-0.5 text-[9px]" style={{ color: "var(--muted)" }}>Long (BUY)</div>
                      <input type="number" step="0.01" value={symEdit.swapLong} onChange={(e) => setSymEdit((s) => s ? { ...s, swapLong: Number(e.target.value) } : s)} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                    </div>
                    <div className="flex-1">
                      <div className="mb-0.5 text-[9px]" style={{ color: "var(--muted)" }}>Short (SELL)</div>
                      <input type="number" step="0.01" value={symEdit.swapShort} onChange={(e) => setSymEdit((s) => s ? { ...s, swapShort: Number(e.target.value) } : s)} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                    </div>
                  </div>
                </div>
              )}
              {swapEnabled && (
                <div>
                  <div className="mb-1 text-[10px] text-[var(--muted)]">Commission per lot ($)</div>
                  <input type="number" min="0" step="0.01" value={symEdit.commissionPerLot} onChange={(e) => setSymEdit((s) => s ? { ...s, commissionPerLot: Number(e.target.value) } : s)} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={async () => { const r = await fetch("/api/admin/symbols/" + symEdit.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spread: isNaN(symEdit.spread) ? 0 : symEdit.spread, spreadType: symEdit.spreadType, spreadMax: 0, swapLong: symEdit.swapLong, swapShort: symEdit.swapShort, commissionPerLot: symEdit.commissionPerLot }) }); const d = await r.json(); if (d.ok) { setAdminSymSpreads((m) => ({ ...m, [symEdit.sym]: isNaN(symEdit.spread) ? 0 : symEdit.spread })); setAdminSymTypes((m) => ({ ...m, [symEdit.sym]: symEdit.spreadType })); setAdminSymMax((m) => ({ ...m, [symEdit.sym]: 0 })); setAdminSymbols((prev) => prev.map((x) => x.id === symEdit.id ? { ...x, spread: isNaN(symEdit.spread) ? 0 : symEdit.spread, spreadType: symEdit.spreadType, swapLong: symEdit.swapLong, swapShort: symEdit.swapShort, commissionPerLot: symEdit.commissionPerLot } : x)); setOk(symEdit.sym + " saved"); setSymEdit(null); } else setErr(d.error || "Failed"); }} className="flex-1 rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Save</button>
              <button onClick={() => setSymEdit(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Category bulk spread popup */}
      {catEdit && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-[320px] rounded-xl border p-5 text-[12px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><div className="text-[14px] font-bold capitalize">{catEdit.cat}</div><div className="text-[10px] text-[var(--muted)]">Set spread for all {catEdit.syms.length} symbols in this category</div></div>
              <button onClick={() => setCatEdit(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="space-y-3">
              <div><div className="mb-1 text-[10px] text-[var(--muted)]">Spread type</div>
                <div className="flex gap-1">
                  {["FIXED","FLOATING"].map((t) => { const active = catEdit.spreadType === t; return (
                    <button key={t} onClick={() => setCatEdit((s) => s ? { ...s, spreadType: t } : s)} className="flex-1 rounded py-1.5 text-[11px] font-semibold border transition-colors" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)", borderColor: active ? "var(--accent)" : "var(--border)" }}>{t.charAt(0) + t.slice(1).toLowerCase()}</button>
                  ); })}
                </div>
              </div>
              {catEdit.spreadType === "FLOATING" ? (
                <div className="rounded border px-3 py-2.5 text-[11px]" style={{ borderColor: "#22c55e", background: "rgba(34,197,94,0.08)" }}>
                  <div className="font-semibold mb-0.5" style={{ color: "#22c55e" }}>Floating spread</div>
                  <div style={{ color: "var(--muted)" }}>Each symbol keeps its current pip value. Type is changed to Floating — spread may vary with market hours.</div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 text-[10px] text-[var(--muted)]">Spread (pips)</div>
                  <input type="number" min="0" step="1" value={isNaN(catEdit.spread) ? "" : catEdit.spread} onChange={(e) => { const v = e.target.value; setCatEdit((s) => s ? { ...s, spread: v === "" ? NaN : Math.max(0, parseInt(v) || 0) } : s); }} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={async () => {
                const { syms, spreadType, spread } = catEdit!;
                await Promise.all(syms.map(async (sym) => {
                  const sid = adminSymIds[sym]; if (!sid) return;
                  // FLOATING: keep each symbol's current spread value; only change the type
                  const pip = spreadType === "FLOATING" ? ((adminSymSpreads[sym] ?? Number(spread)) || 0) : (Number(spread) || 0);
                  await fetch("/api/admin/symbols/" + sid, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spread: pip, spreadType, spreadMax: 0 }) }).catch(() => {});
                  setAdminSymSpreads((m) => ({ ...m, [sym]: pip }));
                  setAdminSymTypes((m) => ({ ...m, [sym]: spreadType }));
                  setAdminSymMax((m) => ({ ...m, [sym]: 0 }));
                }));
                setOk(`Spread set for all ${catEdit!.cat} symbols`); setCatEdit(null);
              }} className="flex-1 rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Apply to all {catEdit!.syms.length} symbols</button>
              <button onClick={() => setCatEdit(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* All Symbols bulk spread modal */}
      {allSymEdit && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-[320px] rounded-xl border p-5 text-[12px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><div className="text-[14px] font-bold">All Symbols</div><div className="text-[10px] text-[var(--muted)]">Apply spread settings to every symbol</div></div>
              <button onClick={() => setAllSymEdit(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="space-y-3">
              <div><div className="mb-1 text-[10px] text-[var(--muted)]">Spread type</div>
                <div className="flex gap-1">
                  {["FIXED","FLOATING"].map((t) => { const active = allSymEdit.type === t; return (
                    <button key={t} onClick={() => setAllSymEdit((s) => s ? { ...s, type: t } : s)} className="flex-1 rounded py-1.5 text-[11px] font-semibold border transition-colors" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)", borderColor: active ? "var(--accent)" : "var(--border)" }}>{t.charAt(0) + t.slice(1).toLowerCase()}</button>
                  ); })}
                </div>
              </div>
              {allSymEdit.type === "FLOATING" ? (
                <div className="rounded border px-3 py-2.5 text-[11px]" style={{ borderColor: "#22c55e", background: "rgba(34,197,94,0.08)" }}>
                  <div className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: "#22c55e" }}><i className="fa-solid fa-wave-square text-[10px]" />Live Market Spread</div>
                  <div style={{ color: "var(--muted)" }}>Spread is calculated from real-time Ask − Bid prices from the exchange feed. No fixed pip value is applied.</div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 text-[10px] text-[var(--muted)]">Spread (pips) — applied to all</div>
                  <input type="number" min="0" step="1" value={isNaN(allSymEdit.pips) ? "" : allSymEdit.pips} onChange={(e) => { const v = e.target.value; setAllSymEdit((s) => s ? { ...s, pips: v === "" ? NaN : Math.max(0, parseInt(v) || 0) } : s); }} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={async () => {
                const body: any = { spreadType: allSymEdit!.type };
                if (allSymEdit!.type === "FIXED") body.spread = Number(allSymEdit!.pips) || 0;
                const r = await fetch("/api/admin/symbols/bulk-spread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                const d = await r.json();
                if (d.ok) {
                  // Reload symbol spread data
                  fetch("/api/admin/symbols").then((r2) => r2.json()).then((asr) => { if (asr.ok) { const m: Record<string, number> = {}; const types: Record<string, string> = {}; const maxes: Record<string, number> = {}; const ids: Record<string, string> = {}; (asr.symbols || []).forEach((s: any) => { m[s.symbol] = Number(s.spread ?? 0); types[s.symbol] = s.spreadType || "FIXED"; maxes[s.symbol] = Number(s.spreadMax ?? 0); ids[s.symbol] = s.id; }); setAdminSymSpreads(m); setAdminSymTypes(types); setAdminSymMax(maxes); setAdminSymIds(ids); } }).catch(() => {});
                  setOk(`Spread applied to all ${d.count} symbols`); setAllSymEdit(null);
                } else setErr(d.error || "Failed");
              }} className="flex-1 rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Apply to all {symPerm ? symPerm.symbols.length : Object.keys(adminSymIds).length} symbols</button>
              <button onClick={() => setAllSymEdit(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Group Symbol Access modal */}
      {grpSymOv && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="flex w-[400px] max-h-[80vh] flex-col rounded-xl border text-[12px]" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold">Symbol Access — {grpSymOv.g.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>Symbols disabled here are hidden for ALL clients in this group only.</div>
                </div>
                <button onClick={() => setGrpSymOv(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
              </div>
              <input value={grpSymOv.q} onChange={(e) => setGrpSymOv((s) => s ? { ...s, q: e.target.value } : s)} placeholder="Search symbol…" className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px]" style={{ color: "var(--text)" }} />
              {grpSymOv.disabled.length > 0 && (
                <div className="mt-1.5 text-[9px] font-semibold" style={{ color: SELL }}>{grpSymOv.disabled.length} symbol{grpSymOv.disabled.length !== 1 ? "s" : ""} disabled for this group</div>
              )}
            </div>
            {/* Symbol list */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {symbols.filter((s: any) => !grpSymOv.q || s.symbol.toLowerCase().includes(grpSymOv.q.toLowerCase())).map((s: any) => {
                const off = grpSymOv.disabled.includes(s.symbol);
                return (
                  <div key={s.symbol} className="flex items-center justify-between border-b py-1.5" style={{ borderColor: "var(--border)" }}>
                    <div><span className="font-semibold">{s.symbol}</span> <span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.display || ""}</span></div>
                    <button onClick={() => {
                      const next = off ? grpSymOv.disabled.filter((x) => x !== s.symbol) : [...grpSymOv.disabled, s.symbol];
                      setGrpSymOv((p) => p ? { ...p, disabled: next } : p);
                    }} className="rounded px-2.5 py-0.5 text-[10px] font-semibold shrink-0" style={off ? { background: "rgba(224,82,96,0.16)", color: SELL } : { background: "rgba(38,166,154,0.16)", color: BUY }}>
                      {off ? "OFF" : "ON"}
                    </button>
                  </div>
                );
              })}
            </div>
            {/* Footer */}
            <div className="shrink-0 border-t px-4 py-3 flex gap-2" style={{ borderColor: "var(--border)" }}>
              <button onClick={async () => {
                const cfg = { ...((grpSymOv.g.config as any) || {}), disabledSymbols: grpSymOv.disabled };
                const r = await fetch("/api/admin/groups/" + grpSymOv.g.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg }) });
                const d = await r.json();
                if (d.ok) { setOk("Symbol access saved for " + grpSymOv.g.name); setGrpSymOv(null); loadAll(); } else setErr(d.error || "Failed");
              }} className="flex-1 rounded-lg py-2 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>Save for group</button>
              <button onClick={() => setGrpSymOv(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-[11px]" style={{ color: "var(--muted)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Group right-click — flyout style matching client context menu */}
      {grpCtx && (() => {
        const g = grpCtx.g;
        const vw2 = typeof window !== "undefined" ? window.innerWidth : 1200;
        const vh2 = typeof window !== "undefined" ? window.innerHeight : 800;
        const left2 = Math.max(6, Math.min(grpCtx.x, vw2 - 246));
        const GMENU_H = 320;
        const top2 = Math.max(8, Math.min(grpCtx.y, vh2 - GMENU_H - 8));
        const members = clients.filter((c: any) => c.groupId === g.id);
        const gmi = "flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] transition-colors hover:bg-[var(--soft)]";
        const gsubi = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--soft)]";
        const ginp = "w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--text)]";
        const gFlyRight = grpCtx.x + 246 + 220 < vw2;
        const gFlyCls = "absolute top-0 ml-1 min-w-[210px] overflow-hidden rounded-xl border py-1 z-[70] " + (gFlyRight ? "left-full" : "right-full mr-1");
        const gFlySty: React.CSSProperties = { background: "color-mix(in srgb, var(--panel) 96%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", boxShadow: "0 20px 50px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)", animation: "menuPop 0.12s cubic-bezier(.16,1,.3,1)" };
        const tog = (k: string) => { setGrpSub(grpSub === k ? "" : k); setGrpForm(grpSub === k ? {} : k === "spread" ? { spread: Number(g.spread || 0), spreadType: g.spreadType || "FIXED", spreadMax: Number(g.spreadMax || 0) } : k === "leverage" ? { leverage: members[0]?.leverage || 100 } : k === "mclevel" ? { mcLevel: members[0] ? Number(members[0].mcLevel) : 50 } : k === "rename" ? { name: g.name } : k === "manager" ? { managerId: g.managerId || "" } : {}); };
        const applyAll = async (body: any) => { await Promise.all(members.map((c: any) => fetch("/api/admin/clients/" + c.id + "/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))); setGrpCtx(null); setOk("Applied to all " + members.length + " members"); loadAll(); };
        const LEVERAGE_OPTIONS = [25, 50, 100, 200, 400, 500, 1000];
        return (<>
          <div className="fixed inset-0 z-40" onClick={() => { setGrpCtx(null); setGrpSub(""); }} />
          <div className="ui-pop fixed z-50 w-60 rounded-2xl border py-1 text-[11px]" style={{ left: left2, top: top2, background: "color-mix(in srgb, var(--panel) 92%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", color: "var(--text)", boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)", animation: "menuPop 0.14s cubic-bezier(.16,1,.3,1)" }}>
            {/* Header */}
            <div className="mx-1.5 mb-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 5%, transparent))" }}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #000))" }}><i className="fa-solid fa-layer-group text-[10px]" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold" style={{ color: "var(--accent)" }}>{g.name}</div>
                <div className="text-[9px]" style={{ color: "var(--muted)" }}>{members.length} members · +{Number(g.spread || 0)}p · {g.managerId ? (managers.find((m: any) => m.id === g.managerId)?.name || "Manager") : "Admin"}</div>
              </div>
            </div>

            {/* Group Leverage flyout */}
            <div className="relative">
              <button onClick={() => tog("leverage")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "leverage" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-gauge-high", "var(--accent)")}<span className="flex-1">Group Leverage</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "leverage" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "leverage" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <div className="text-[9px]" style={{ color: "var(--muted)" }}>Apply to ALL {members.length} members</div>
                    <select className={ginp} value={grpForm.leverage || 100} onChange={(e) => setGrpForm((f) => ({ ...f, leverage: Number(e.target.value) }))}>
                      {LEVERAGE_OPTIONS.map((v) => <option key={v} value={v}>1:{v}</option>)}
                    </select>
                    <button onClick={() => applyAll({ action: "settings", leverage: grpForm.leverage || 100 })} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "var(--accent)" }}>Apply to all members</button>
                  </div>
                </div>
              )}
            </div>

            {/* Group Margin Call flyout */}
            <div className="relative">
              <button onClick={() => tog("mclevel")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "mclevel" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-triangle-exclamation", "#f59e0b")}<span className="flex-1">Group Margin Call</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "mclevel" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "mclevel" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <div className="text-[9px]" style={{ color: "var(--muted)" }}>Set margin call % for ALL {members.length} members</div>
                    <input type="number" min="0" max="500" step="1" className={ginp} value={grpForm.mcLevel ?? 50} onChange={(e) => setGrpForm((f) => ({ ...f, mcLevel: Number(e.target.value) }))} placeholder="e.g. 50 (0 = off)" />
                    <button onClick={() => applyAll({ action: "settings", mcLevel: grpForm.mcLevel ?? 50 })} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "#f59e0b" }}>Apply to all members</button>
                  </div>
                </div>
              )}
            </div>

            {/* Spread Settings flyout */}
            <div className="relative">
              <button onClick={() => tog("spread")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "spread" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-arrows-left-right", "#22c55e")}<span className="flex-1">Spread Settings</span>
                <span className="text-[9px] tabular-nums mr-1" style={{ color: "var(--muted)" }}>+{Number(g.spread || 0)}p</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "spread" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "spread" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <div className="text-[9px]" style={{ color: "var(--muted)" }}>Group markup on top of symbol spread</div>
                    <div className="flex gap-1">
                      {["FLOATING","FIXED"].map((t) => { const active = (grpForm.spreadType ?? g.spreadType ?? "FLOATING") === t; return (
                        <button key={t} onClick={() => setGrpForm((f: any) => ({ ...f, spreadType: t }))} className="flex-1 rounded py-1 text-[10px] font-semibold border transition-colors" style={{ background: active ? "#22c55e" : "var(--bg)", color: active ? "#fff" : "var(--muted)", borderColor: active ? "#22c55e" : "var(--border)" }}>{t.charAt(0) + t.slice(1).toLowerCase()}</button>
                      ); })}
                    </div>
                    {(grpForm.spreadType ?? g.spreadType ?? "FLOATING") === "FLOATING" ? (
                      <div className="rounded border px-2.5 py-2 text-[10px]" style={{ borderColor: "#22c55e", background: "rgba(34,197,94,0.08)" }}>
                        <div className="font-semibold mb-0.5" style={{ color: "#22c55e" }}>Live market spread</div>
                        <div style={{ color: "var(--muted)" }}>No group markup — clients in this group see the raw live feed spread.</div>
                      </div>
                    ) : (
                      <div>
                        <div className="mb-1 text-[9px]" style={{ color: "var(--muted)" }}>Spread markup (pips)</div>
                        <input type="number" min="0" step="1" className={ginp} value={grpForm.spread ?? g.spread ?? ""} onChange={(e) => { const v = e.target.value; setGrpForm((f: any) => ({ ...f, spread: v === "" ? "" : String(Math.max(0, parseInt(v) || 0)) })); }} />
                      </div>
                    )}
                    <button onClick={async () => { const sType = grpForm.spreadType ?? g.spreadType ?? "FLOATING"; const r = await fetch("/api/admin/groups/" + g.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spread: sType === "FLOATING" ? 0 : (Number(grpForm.spread ?? g.spread ?? 0) || 0), spreadType: sType, spreadMax: 0, managerId: g.managerId }) }); const d2 = await r.json(); if (d2.ok) { setOk("Group spread saved"); setGrpCtx(null); setGrpSub(""); loadAll(); } else setErr(d2.error || "Failed"); }} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "#22c55e" }}>Save group spread</button>
                    <button onClick={() => { setGrpCtx(null); setGrpSub(""); openSymPerm(); }} className="w-full rounded py-1 text-[9px] text-center" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }}>Symbol Spread Editor →</button>
                  </div>
                </div>
              )}
            </div>

            {/* Symbol Access — direct action */}
            <button onClick={() => { const dis: string[] = (g.config as any)?.disabledSymbols || []; setGrpSymOv({ g, disabled: dis, q: "" }); setGrpCtx(null); setGrpSub(""); }} className={gmi}>
              {mIco("fa-eye-slash", "var(--accent)")}<span className="flex-1">Symbol Access</span>
              <span className="text-[9px] rounded px-1" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>group</span>
            </button>

            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />

            {/* Members flyout */}
            <div className="relative">
              <button onClick={() => tog("members")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "members" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-users")}<span className="flex-1">Members</span>
                <span className="text-[9px] tabular-nums mr-1" style={{ color: "var(--muted)" }}>{members.length}</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "members" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "members" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {members.map((c: any) => (
                      <button key={c.id} onClick={() => { setSelAcc(c); setGrpCtx(null); setGrpSub(""); }} className={gsubi}>
                        {mIco("fa-user")}{c.login} — {titleCaseName(c.name)}
                      </button>
                    ))}
                    {members.length === 0 && <div className="px-3 py-2 text-[10px]" style={{ color: "var(--muted)" }}>No members assigned</div>}
                  </div>
                </div>
              )}
            </div>

            {/* DNL bulk */}
            <div className="relative">
              <button onClick={() => tog("dnl")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "dnl" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-hand", "#a78bfa")}<span className="flex-1">Do Not Liquidate</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "dnl" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "dnl" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <div className="text-[9px]" style={{ color: "var(--muted)" }}>Apply DNL setting to ALL {members.length} members</div>
                    <button onClick={() => applyAll({ action: "settings", doNotLiquidate: true })} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "#a78bfa" }}>Enable DNL for all members</button>
                    <button onClick={() => applyAll({ action: "settings", doNotLiquidate: false })} className="w-full rounded-lg py-1.5 text-[10px] font-semibold" style={{ background: "var(--soft)", color: "var(--muted)" }}>Disable DNL for all members</button>
                  </div>
                </div>
              )}
            </div>

            {/* Rename Group flyout */}
            <div className="relative">
              <button onClick={() => tog("rename")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "rename" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-pen")}<span className="flex-1">Rename Group</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "rename" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "rename" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <input className={ginp} value={grpForm.name || ""} onChange={(e) => setGrpForm((f) => ({ ...f, name: e.target.value }))} placeholder="Group name" autoFocus />
                    <button onClick={async () => { const r = await fetch("/api/admin/groups/" + g.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: grpForm.name, spread: Number(g.spread || 0), managerId: g.managerId || null }) }); const d = await r.json(); if (d.ok) { setOk("Group renamed"); setGrpCtx(null); setGrpSub(""); loadAll(); } else setErr(d.error || "Failed"); }} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "var(--accent)" }}>Save name</button>
                  </div>
                </div>
              )}
            </div>

            {/* Change Manager flyout */}
            <div className="relative">
              <button onClick={() => tog("manager")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (grpSub === "manager" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-user-tie")}<span className="flex-1">Change Manager</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: grpSub === "manager" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {grpSub === "manager" && (
                <div className={gFlyCls} style={gFlySty}>
                  <div className="px-3 py-2 space-y-2">
                    <select className={ginp} value={grpForm.managerId || ""} onChange={(e) => setGrpForm((f) => ({ ...f, managerId: e.target.value || null }))}>
                      <option value="">Admin-level (no manager)</option>
                      {managers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button onClick={async () => { const r = await fetch("/api/admin/groups/" + g.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: g.name, spread: Number(g.spread || 0), managerId: grpForm.managerId || null }) }); const d = await r.json(); if (d.ok) { setOk("Manager updated"); setGrpCtx(null); setGrpSub(""); loadAll(); } else setErr(d.error || "Failed"); }} className="w-full rounded-lg py-1.5 text-[10px] font-semibold text-white" style={{ background: "var(--accent)" }}>Save manager</button>
                  </div>
                </div>
              )}
            </div>

            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />

            {/* Delete Group */}
            <button onClick={() => { const gg = g; setGrpCtx(null); setGrpSub(""); askDelete(`Delete group "${gg.name}"? All ${members.length} members will be unassigned.`, async () => { const r = await fetch("/api/admin/groups/" + gg.id, { method: "DELETE" }); const d = await r.json(); if (d.ok) { setOk("Group deleted"); loadAll(); } else setErr(d.error || "Failed"); }); }} className={gmi} style={{ color: "#dc2626" }}>
              {mIco("fa-trash", "#dc2626")}Delete Group
            </button>
          </div>
        </>);
      })()}

      {menu && (() => {
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const left = Math.max(6, Math.min(menu.x, vw - 246));
        const MENU_H = 460;
        const top = Math.max(8, Math.min(menu.y, vh - MENU_H - 8));
        const vpos = { top };
        return (<>
        <div className="fixed inset-0 z-40" onClick={() => { setMenu(null); setMenuSub(""); }} />
        <div className="ui-pop fixed z-50 w-60 rounded-2xl border py-1 text-[11px]" style={{ left, ...vpos, background: "color-mix(in srgb, var(--panel) 92%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", color: "var(--text)", boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)", animation: "menuPop 0.14s cubic-bezier(.16,1,.3,1)" }}>
          {/* Header */}
          <div className="mx-1.5 mb-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 5%, transparent))" }}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #000))" }}>{(menu.acc.name || "?").charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold" style={{ color: GOLD }}>{menu.acc.login}</span>
                <span className="rounded px-1 py-px text-[8px] font-semibold" style={{ background: (menu.acc.type === "LIVE" ? BUY : "#6366f1") + "22", color: menu.acc.type === "LIVE" ? BUY : "#818cf8" }}>{menu.acc.type}</span>
              </div>
              <div className="truncate text-[9px]" style={{ color: "var(--muted)" }}>{titleCaseName(menu.acc.name)}</div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              {menu.acc.locked && <span className="rounded px-1 py-px text-[8px] font-bold" style={{ background: SELL + "22", color: SELL }}>LOCKED</span>}
              {menu.acc.deactivated && <span className="rounded px-1 py-px text-[8px] font-bold" style={{ background: GOLD + "22", color: GOLD }}>INACTIVE</span>}
              {menu.acc.doNotLiquidate && <span className="rounded px-1 py-px text-[8px] font-bold" style={{ background: "#a78bfa22", color: "#a78bfa" }}>DNL</span>}
            </div>
          </div>

          {/* Money accordion */}
          {(can("processDeposits") || can("processWithdrawals") || can("creditBonus") || can("editFinancial") || can("transferFunds")) && (
            <div className="relative">
              <button onClick={() => setMenuSub(menuSub === "money" ? "" : "money")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (menuSub === "money" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-sack-dollar", GOLD)}<span className="flex-1">Money</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: menuSub === "money" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {menuSub === "money" && (
                <div className={flyCls} style={flySty}>
                  {can("processDeposits") && <button onClick={() => openAct("money", menu.acc, "DEPOSIT", "Deposit")} className={subi} style={{ color: BUY }}>{mIco("fa-arrow-down-to-bracket", BUY)}Deposit</button>}
                  {can("processWithdrawals") && <button onClick={() => openAct("money", menu.acc, "WITHDRAWAL", "Withdrawal")} className={subi} style={{ color: GOLD }}>{mIco("fa-arrow-up-from-bracket", GOLD)}Withdrawal</button>}
                  {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "CREDIT_IN", "Credit In")} className={subi} style={{ color: BUY }}>{mIco("fa-circle-plus", BUY)}Credit In</button>}
                  {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "CREDIT_OUT", "Credit Out")} className={subi} style={{ color: GOLD }}>{mIco("fa-circle-minus", GOLD)}Credit Out</button>}
                  {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "BONUS", "Bonus")} className={subi} style={{ color: BUY }}>{mIco("fa-gift", BUY)}Bonus</button>}
                  {can("creditBonus") && <button onClick={() => openAct("money", menu.acc, "INSURANCE", "Insurance")} className={subi}>{mIco("fa-umbrella")}Insurance</button>}
                  {can("editFinancial") && <button onClick={() => openAct("manualpnl", menu.acc)} className={subi}>{mIco("fa-money-bill-trend-up")}Manual P/L</button>}
                  {can("editFinancial") && <button onClick={() => reconcileAcc(menu.acc)} className={subi}>{mIco("fa-scale-balanced")}Recalculate Balance</button>}
                  {can("transferFunds") && <button onClick={() => openAct("transfer", menu.acc)} className={subi}>{mIco("fa-money-bill-transfer")}Transfer Between Accounts</button>}
                </div>
              )}
            </div>
          )}

          {can("manualTrade") && <button onClick={() => openMT(menu.acc)} className={mi}>{mIco("fa-bolt", "var(--accent)")}Manual Trade</button>}
          <button onClick={() => openAct("subaccount", menu.acc)} className={mi}>{mIco("fa-code-branch")}Create Sub-Account</button>

          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />

          {/* Edit Client / KYC — available on every account (live or demo). Detail
              edits propagate to all of the client's connected accounts server-side. */}
          {(<>
            {/* Edit Client flyout */}
            <div className="relative">
              <button onClick={() => setMenuSub(menuSub === "edit" ? "" : "edit")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (menuSub === "edit" ? "bg-[var(--soft)]" : "")}>
                {mIco("fa-pen-to-square")}<span className="flex-1">Edit Client</span>
                <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: menuSub === "edit" ? "var(--accent)" : "var(--muted)" }} />
              </button>
              {menuSub === "edit" && (
                <div className={flyCls} style={flySty}>
                  <button onClick={() => openAct("rename", menu.acc)} className={subi}>{mIco("fa-user-pen")}Edit Details</button>
                  <button onClick={() => openAct("accountid", menu.acc)} className={subi}>{mIco("fa-id-card")}Change Account ID</button>
                  <button onClick={() => openAct("assign", menu.acc)} className={subi}>{mIco("fa-user-tie")}Assign Manager &amp; Group</button>
                  <button onClick={() => doClearPin(menu.acc)} className={subi}>{mIco("fa-unlock-keyhole")}Reset PIN</button>
                </div>
              )}
            </div>

            {/* KYC */}
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
          </>)}

          {/* Settings flyout */}
          <div className="relative">
            <button onClick={() => setMenuSub(menuSub === "settings" ? "" : "settings")} className={"flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-[var(--soft)] " + (menuSub === "settings" ? "bg-[var(--soft)]" : "")}>
              {mIco("fa-gear")}<span className="flex-1">Settings</span>
              <i className="fa-solid fa-chevron-right text-[8px]" style={{ color: menuSub === "settings" ? "var(--accent)" : "var(--muted)" }} />
            </button>
            {menuSub === "settings" && (
              <div className={flyCls} style={flySty}>
                <button onClick={() => openAct("leverage", menu.acc)} className={subi}>{mIco("fa-gauge-high")}Change Leverage</button>
                <button onClick={() => openAct("mclevel", menu.acc)} className={subi}>{mIco("fa-triangle-exclamation")}Set Margin Call Level</button>
                <button onClick={() => { openSymOv(menu.acc); }} className={subi}>{mIco("fa-eye-slash", "var(--accent)")}Symbol Settings</button>
                <button onClick={() => doPool(menu.acc)} className={subi}>{mIco(menu.acc.isPool ? "fa-circle-minus" : "fa-circle-plus", "#a78bfa")}{menu.acc.isPool ? "Demote from Pool" : "Promote to Pool"}</button>
              </div>
            )}
          </div>

          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />

          {/* Status section — this account */}
          <div className="px-2.5 pb-1 pt-0.5">
            <div className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>This Account</div>
            <div className="flex gap-1.5">
              <button onClick={() => doStatus(menu.acc)} className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: menu.acc.locked ? BUY + "20" : SELL + "20", color: menu.acc.locked ? BUY : SELL }}>
                <i className={"fa-solid text-[9px] " + (menu.acc.locked ? "fa-lock-open" : "fa-lock")} />
                {menu.acc.locked ? "Unlock" : "Lock"}
              </button>
              <button onClick={() => doDeactivate(menu.acc)} className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: menu.acc.deactivated ? BUY + "20" : GOLD + "20", color: menu.acc.deactivated ? BUY : GOLD }}>
                <i className={"fa-solid text-[9px] " + (menu.acc.deactivated ? "fa-circle-check" : "fa-ban")} />
                {menu.acc.deactivated ? "Activate" : "Deactivate"}
              </button>
              <button onClick={() => doDNL(menu.acc)} title={menu.acc.doNotLiquidate ? "Disable Do-Not-Liquidate" : "Enable Do-Not-Liquidate"} className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: menu.acc.doNotLiquidate ? "#a78bfa20" : "var(--soft)", color: menu.acc.doNotLiquidate ? "#a78bfa" : "var(--muted)" }}>
                <i className="fa-solid fa-hand text-[9px]" />
                DNL
              </button>
            </div>
          </div>

          {/* Status section — all accounts of this user */}
          {menu.acc.userId && (<div className="px-2.5 pb-2 pt-0.5">
            <div className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>All Accounts (This User)</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => doStatusAll(menu.acc, true)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: SELL + "20", color: SELL }}>
                <i className="fa-solid fa-lock text-[9px]" />Lock All
              </button>
              <button onClick={() => doStatusAll(menu.acc, false)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: BUY + "20", color: BUY }}>
                <i className="fa-solid fa-lock-open text-[9px]" />Unlock All
              </button>
              <button onClick={() => doDeactivateAll(menu.acc, true)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: GOLD + "20", color: GOLD }}>
                <i className="fa-solid fa-ban text-[9px]" />Deactivate All
              </button>
              <button onClick={() => doDeactivateAll(menu.acc, false)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-opacity hover:opacity-75"
                style={{ background: BUY + "20", color: BUY }}>
                <i className="fa-solid fa-circle-check text-[9px]" />Activate All
              </button>
            </div>
          </div>)}

          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {can("deleteClients") && <button onClick={() => delClient(menu.acc)} className={mi} style={{ color: SELL }}>{mIco("fa-trash", SELL)}Delete Client</button>}
        </div>
      </>);
      })()}

      {ticket && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">Order - {ticket}</div>
            <div className={lab}>Type</div>
            <select className={inp} value={tform.type} onChange={(e) => setTform({ ...tform, type: e.target.value })}><option>Market</option><option>Buy Limit</option><option>Sell Limit</option><option>Buy Stop</option><option>Sell Stop</option></select>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div><div className={lab}>Volume</div><input type="number" step="0.01" className={inp} value={tform.vol} onChange={(e) => setTform({ ...tform, vol: Number(e.target.value) })} /></div>
              <div><div className={lab}>S/L</div><input type="number" className={inp} value={tform.sl} onChange={(e) => setTform({ ...tform, sl: Number(e.target.value) })} /></div>
              <div><div className={lab}>T/P</div><input type="number" className={inp} value={tform.tp} onChange={(e) => setTform({ ...tform, tp: Number(e.target.value) })} /></div>
            </div>
            {tform.type !== "Market" && (<div className="mt-2"><div className={lab}>Trigger price</div><input type="number" className={inp} value={tform.price} onChange={(e) => setTform({ ...tform, price: Number(e.target.value) })} /></div>)}
            {tform.type === "Market" && (<div className="mt-2"><div className={lab}>Trailing Stop (pips, 0=off)</div><input type="number" min="0" step="1" className={inp} value={tform.trail || ""} placeholder="0" onChange={(e) => setTform({ ...tform, trail: e.target.value })} /></div>)}
            <div className="mt-2"><div className={lab}>Comment (optional)</div><input type="text" maxLength={128} className={inp} value={tform.comment || ""} placeholder="" onChange={(e) => setTform({ ...tform, comment: e.target.value })} /></div>
            <div className="mt-2 text-center text-[10px] text-[var(--muted)]">{prices[ticket] != null ? gpx(ticket, prices[ticket]) : "..."}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => placeTicket("SELL")} className="flex-1 rounded py-2 text-xs" style={{ background: "rgba(224,82,96,0.16)", color: SELL, border: "0.5px solid rgba(224,82,96,0.4)" }}>Sell {prices[ticket] != null ? gnum(prices[ticket] * 0.9999, dg(ticket)) : ""}</button>
              <button onClick={() => placeTicket("BUY")} className="flex-1 rounded py-2 text-xs" style={{ background: "rgba(47,129,247,0.18)", color: "#6ab0ff", border: "0.5px solid rgba(47,129,247,0.4)" }}>Buy {prices[ticket] != null ? gnum(prices[ticket] * 1.0001, dg(ticket)) : ""}</button>
            </div>
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <button onClick={() => setTicket(null)} className="mt-2 w-full rounded border border-[var(--border)] py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}

      {posMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setPosMenu(null)} />
        <div className="ui-pop fixed z-50 w-44 overflow-hidden rounded-xl border text-[11px]" style={{ left: posMenu.x, top: posMenu.y, background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <div className="border-b px-3 py-1.5 text-[10px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>{posMenu.t.symbol} {posMenu.t.type} {posMenu.t.lots}</div>
          <button onClick={() => openPos("modify", posMenu.t)} className={mi}>Modify S/L - T/P</button>
          <button onClick={() => openPos("partial", posMenu.t)} className={mi}>Partial Close</button>
          <button onClick={() => { const id = posMenu.t.id; setPosMenu(null); close(id); }} className={mi} style={{ color: SELL }}>Close</button>
        </div>
      </>)}
      {pos && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">{pos.kind === "modify" ? "Modify S/L - T/P" : pos.kind === "manual" ? "Manual Close" : "Partial Close"}</div>
            <div className="mb-2 text-[10px] text-[var(--muted)]">#{pos.t.ticket} · {pos.t.symbol} · {pos.t.type} · {Number(pos.t.lots).toFixed(2)}L</div>
            {pos.kind === "modify" ? (<>
              <div className={lab}>Stop Loss</div><input type="number" className={inp} value={pform.sl} onChange={(e) => setPform({ ...pform, sl: e.target.value })} autoFocus />
              <div className={lab + " mt-2"}>Take Profit</div><input type="number" className={inp} value={pform.tp} onChange={(e) => setPform({ ...pform, tp: e.target.value })} />
            </>) : pos.kind === "manual" ? (() => {
              const live = prices[pos.t.symbol];
              const cp = Number(pform.closePrice) || live || Number(pos.t.openPrice);
              const est = pnlOf({ symbol: pos.t.symbol, type: pos.t.type, lots: Number(pos.t.lots), openPrice: Number(pos.t.openPrice) }, cp, csz(pos.t.symbol));
              return (<>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--soft)] px-3 py-2 text-center"><div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">Live Price</div><div className="text-sm font-bold" style={{ color: "var(--accent)" }}>{live != null ? gpx(pos.t.symbol, live) : "…"}</div></div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--soft)] px-3 py-2 text-center"><div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">Est. P/L</div><div className="text-sm font-bold" style={{ color: est >= 0 ? BUY : SELL }}>{est >= 0 ? "+" : ""}{gnum(est, 2)}</div></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="flex items-center justify-between"><span className={lab}>Close Price *</span>{pform.follow ? <span className="text-[9px]" style={{ color: GOLD }}>live</span> : <button onClick={() => setPform({ ...pform, follow: true, closePrice: live ?? pform.closePrice })} className="text-[9px] underline" style={{ color: "var(--accent)" }}>use live</button>}</div><input type="number" className={inp} value={pform.follow ? (live != null ? live.toFixed(dg(pos.t.symbol)) : pform.closePrice) : pform.closePrice} onChange={(e) => setPform({ ...pform, closePrice: e.target.value, follow: false })} autoFocus /></div>
                  <div><div className={lab}>Close Date & Time</div><input type="datetime-local" className={inp} value={pform.closedAt} onChange={(e) => setPform({ ...pform, closedAt: e.target.value })} /></div>
                </div>
              </>);
            })() : (<>
              <div className={lab}>Lots to close (max {pos.t.lots})</div><input type="number" step="0.01" className={inp} value={pform.lots} onChange={(e) => setPform({ ...pform, lots: e.target.value })} autoFocus />
              <div className="mt-1 text-[10px] text-[var(--muted)]">At price {prices[pos.t.symbol] != null ? gpx(pos.t.symbol, prices[pos.t.symbol]) : pos.t.openPrice}</div>
            </>)}
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setPos(null)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button>
              <button onClick={submitPos} className="flex-1 rounded py-2 text-xs font-semibold" style={{ background: pos.kind === "manual" ? SELL : BUY, color: "#fff" }}>{pos.kind === "manual" ? "Close Trade" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
      {act && (() => {
        const pr = actPrimary();
        const linked = clients.filter((c: any) => act.acc.user?.email && c.user?.email === act.acc.user?.email);
        const LEVS = [50, 100, 200, 300, 500, 1000];
        return (
        actMin ? (
          <div className="fixed bottom-3 right-3 z-[60] flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
            <i className={"fa-solid " + actIcon()} style={{ color: "var(--accent)" }} />
            <span className="font-semibold">{actTitle()} — {act.acc.login}</span>
            <button onClick={() => setActMin(false)} title="Restore" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-up-right-and-down-left-from-center" /></button>
            <button onClick={() => setAct(null)} title="Close" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
          </div>
        ) : (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop desk-modal w-[420px] max-w-[95vw] max-h-[90vh] overflow-auto rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent2)" }}><i className={"fa-solid " + actIcon()} /></span>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{actTitle()}</div><div className="truncate text-[11px] text-[var(--muted)]">{act.acc.login} - {titleCaseName(act.acc.name)}</div></div>
              <button onClick={() => setActMin(true)} title="Minimize" className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-window-minimize text-[10px]" /></button>
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
              {act.finType === "CREDIT_IN" && (<div>
                <div className={flab}>Due Date (optional)</div><input type="date" className={inp} value={aform.settleTo || ""} onChange={(e) => af("settleTo", e.target.value)} />
              </div>)}
              {act.finType === "BONUS" && (<div>
                <div className={flab}>Bonus Expiry Date (optional)</div><input type="date" className={inp} value={aform.bonusExpiryAt || ""} onChange={(e) => af("bonusExpiryAt", e.target.value)} />
              </div>)}
            </>)}
            {act.kind === "manualpnl" && (<>
              <div><div className={flab}>Amount (use - for a loss)</div><input type="number" className={inp} value={aform.amount || ""} onChange={(e) => af("amount", e.target.value)} autoFocus /></div>
              <div><div className={flab}>Note</div><input className={inp} value={aform.note || ""} onChange={(e) => af("note", e.target.value)} /></div>
            </>)}
            {act.kind === "transfer" && (<>
              <div><div className={flab}>From Account</div><select className={inp} value={aform.fromId || act.acc.id} onChange={(e) => af("fromId", e.target.value)}>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.login} — {c.name} (${gmoney(acctBal(c))})</option>)}</select></div>
              <div><div className={flab}>To Account</div><select className={inp} value={aform.toId || ""} onChange={(e) => af("toId", e.target.value)}><option value="">- select -</option>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.login} — {c.name} (${gmoney(acctBal(c))})</option>)}</select></div>
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
                <div><div className={flab}>Country</div><CountrySelect className={inp} value={aform.country ?? (act.acc.country || "")} onChange={(v) => af("country", v)} /></div>
                <div><div className={flab}>New Password (blank = keep)</div><PasswordInput className={inp} value={aform.password || ""} onChange={(e) => af("password", e.target.value)} placeholder="Enter new password" /></div>
                <div><div className={flab}>Account Type</div><input className={inp} value={act.acc.type} disabled /></div>
                <div><div className={flab}>Leverage</div><input className={inp} value={"1:" + act.acc.leverage} disabled /></div>
                <div><div className={flab}>Manager / Group</div><input className={inp} value={(act.acc.manager?.name || "Unassigned") + (act.acc.group?.name ? " / " + act.acc.group.name : "")} disabled /></div>
              </div>
              {linked.length > 0 && (<div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-[var(--muted)]"><span><i className="fa-solid fa-link mr-1" />LINKED ACCOUNTS ({linked.length})</span><span>TOTAL: ${gmoney(linked.reduce((s: number, c: any) => s + acctBal(c), 0))}</span></div>
                {linked.map((c: any) => (<div key={c.id} className="flex items-center justify-between gap-2 border-t px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", background: c.id === act.acc.id ? "var(--soft)" : undefined }}>
                  <span style={{ color: "var(--accent2)" }}>#{c.login} <span className="rounded px-1 text-[8px]" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}>{c.type}</span>{c.parentId ? <span className="ml-1 rounded px-1 text-[8px] text-[var(--muted)]" style={{ background: "var(--soft)" }}>sub</span> : null}{c.id === act.acc.id ? " · current" : ""}</span>
                  <span className="flex items-center gap-2"><span className="font-medium">${gmoney(acctBal(c))}</span>{c.parentId && !isManager && <button title="Unlink from parent" onClick={() => unlinkSub(c)} className="rounded px-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-link-slash" /></button>}</span>
                </div>))}
              </div>)}
              <div className="grid grid-cols-3 gap-2 rounded-lg border p-2 text-[10px]" style={{ borderColor: "var(--border)" }}>
                <div><div className="text-[var(--muted)]">Deposit</div><div className="font-semibold" style={{ color: BUY }}>+{gmoney(act.acc.deposit || 0)}</div></div>
                <div><div className="text-[var(--muted)]">Withdrawal</div><div className="font-semibold" style={{ color: SELL }}>-{gmoney(act.acc.withdrawal || 0)}</div></div>
                <div><div className="text-[var(--muted)]">Closed P/L</div><div className="font-semibold">{gmoney(act.acc.pnl || 0)}</div></div>
                <div><div className="text-[var(--muted)]">Credit</div><div className="font-semibold">{gmoney(act.acc.credit || 0)}</div></div>
                <div><div className="text-[var(--muted)]">Balance</div><div className="font-semibold">{gmoney(acctBal(act.acc))}</div></div>
                <div><div className="text-[var(--muted)]">MC Level</div><div className="font-semibold">{Number(act.acc.mcLevel || 0).toFixed(2)}%</div></div>
              </div>
            </>)}
            {act.kind === "accountid" && (<>
              <div className="text-[11px] text-[var(--muted)]">Current ID: <span className="font-semibold text-[var(--text)]">{act.acc.login}</span> — {act.acc.name}</div>
              <div><div className={flab}>Enter new Account ID</div><input className={inp} value={aform.login ?? act.acc.login} onChange={(e) => af("login", e.target.value)} autoFocus /></div>
            </>)}
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
            {act.kind === "spreadmarkup" && (<>
              <div className="mb-2 text-[10px] text-[var(--muted)]">Extra markup added on top of symbol + group spread for this account only.</div>
              <div className="mb-3"><div className={flab}>Spread Type</div>
                <div className="flex gap-1 mt-1">
                  {["FLOATING","FIXED"].map((t) => { const active = (aform.spreadMarkupType ?? act.acc.spreadMarkupType ?? "FLOATING") === t; return (
                    <button key={t} onClick={() => af("spreadMarkupType", t)} className="flex-1 rounded-lg py-1.5 text-[11px] font-semibold border transition-colors" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)", borderColor: active ? "var(--accent)" : "var(--border)" }}>{t.charAt(0) + t.slice(1).toLowerCase()}</button>
                  ); })}
                </div>
              </div>
              {(aform.spreadMarkupType ?? act.acc.spreadMarkupType ?? "FLOATING") === "FLOATING" ? (
                <div className="rounded-lg border px-3 py-2.5 text-[11px]" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
                  <div className="font-semibold mb-0.5" style={{ color: "var(--accent)" }}>Live market spread</div>
                  <div style={{ color: "var(--muted)" }}>No extra markup — this account sees the raw live market spread (no account markup added).</div>
                </div>
              ) : (
                <div><div className={flab}>Spread Markup (pips)</div>
                  <input type="number" min="0" step="1" className={inp} value={aform.spreadMarkup ?? Number(act.acc.spreadMarkup ?? 0)} onChange={(e) => { const v = e.target.value; af("spreadMarkup", v === "" ? "" : String(Math.max(0, parseInt(v) || 0))); }} autoFocus />
                </div>
              )}
              <div className="mt-1 text-[10px] text-[var(--muted)]">Current: <b>{Number(act.acc.spreadMarkup ?? 0)} pips</b> · {act.acc.spreadMarkupType || "FLOATING"}</div>
            </>)}
            {act.kind === "settings" && (<>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={flab}>Leverage</div><input type="number" className={inp} value={aform.leverage ?? act.acc.leverage} onChange={(e) => af("leverage", e.target.value)} /></div>
                <div><div className={flab}>MC Level %</div><input type="number" className={inp} value={aform.mcLevel ?? act.acc.mcLevel} onChange={(e) => af("mcLevel", e.target.value)} /></div>
              </div>
              <div><div className={flab}>Currency</div><select className={inp} value={aform.currency ?? act.acc.currency} onChange={(e) => af("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={!!(aform.doNotLiquidate ?? act.acc.doNotLiquidate)} onChange={(e) => af("doNotLiquidate", e.target.checked)} /> Do not liquidate (disable stop-out)</label>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={!!(aform.swapFree ?? act.acc.swapFree)} onChange={(e) => af("swapFree", e.target.checked)} /> Swap-free (Islamic account — no overnight charges)</label>
            </>)}
            {err && <div className="text-[11px]" style={{ color: SELL }}>{err}</div>}
            </div>
            <div className="flex gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setAct(null)} className="flex-1 rounded-lg border py-2 text-xs font-medium" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button onClick={submitAct} className="flex-1 rounded-lg py-2 text-xs font-semibold" style={{ background: pr.color, color: pr.fg }}>{pr.label}</button>
            </div>
          </div>
        </div>
        )
        );
      })()}

      {modal && modalMin && (
        <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <span className="font-semibold">{modal === "client" ? "New Client" : modal === "manager" ? "New Manager" : modal === "group" ? "Manage Groups" : "Send Notification"}</span>
          <button onClick={() => setModalMin(false)} title="Restore" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-up-right-and-down-left-from-center" /></button>
          <button onClick={() => { setModal(""); setModalMin(false); }} title="Close" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
        </div>
      )}
      {modal && !modalMin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className={"ui-pop desk-modal rounded-xl border p-4 " + (modal === "notify" ? "w-[660px] max-w-[94vw]" : "w-[420px]")} style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{modal === "client" && "New Client"}{modal === "manager" && "New Manager"}{modal === "group" && "Manage Groups"}{modal === "notify" && "Send Notification"}</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModalMin(true)} title="Minimize" className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-window-minimize text-[10px]" /></button>
                <button onClick={() => setModal("")} title="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
              </div>
            </div>
            {modal === "client" && (<>
              <div className="flex gap-1">
                <button onClick={() => { f("type", "LIVE"); if (form.isPool) fetchNextLogin("LIVE"); }} className="flex-1 rounded py-1.5 text-xs" style={form.type === "LIVE" ? { background: BUY, color: "#04140e" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Live</button>
                <button onClick={() => { f("type", "DEMO"); if (form.isPool) fetchNextLogin("DEMO"); }} className="flex-1 rounded py-1.5 text-xs" style={form.type === "DEMO" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--muted)" }}>Demo</button>
              </div>
              {/* Pool account — at the top; hides Email/Phone/Country (pool logs in by Live ID, no email/KYC) */}
              <label className="mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: form.isPool ? "var(--accent)" : "var(--border)", background: form.isPool ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent", color: "var(--text)" }}>
                <input type="checkbox" checked={!!form.isPool} onChange={(e) => { f("isPool", e.target.checked); if (e.target.checked) fetchNextLogin(form.type); }} />
                <span className="font-semibold">Pool account</span>
                <span className="text-[var(--muted)]">— shared account, logs in with Live ID (no email / KYC)</span>
              </label>
              {form.isPool && (<><div className={lab + " mt-2"}>Live ID (auto-assigned)</div><input className={inp + " font-mono opacity-90 cursor-not-allowed"} value={poolLogin || "…"} readOnly /></>)}
              <div className={lab + " mt-2"}>Name <span className="font-normal normal-case text-[var(--muted)]">{form.isPool ? "(person who will use this pool account)" : ""}</span></div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              {!form.isPool && (<><div className={lab + " mt-2"}>Phone</div><input className={inp} value={form.phone || ""} onChange={(e) => f("phone", e.target.value)} /></>)}
              {!form.isPool && (<>
                <div className={lab + " mt-2"}>Email</div>
                <input className={inp} value={form.email || ""} autoComplete="off" data-lpignore="true" onChange={(e) => f("email", e.target.value)} />
                {dupWarn && (
                  <div className="mt-1.5 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ background: "rgba(234,179,8,0.10)", border: "1px solid rgba(234,179,8,0.35)", color: "#b45309" }}>
                    <i className="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" />
                    <span><b>{dupWarn.name}</b> already has {dupWarn.accounts} account{dupWarn.accounts !== 1 ? "s" : ""} with this email. The new account will be added as a <b>sub-account</b> under their profile.</span>
                  </div>
                )}
              </>)}
              <div className={lab + " mt-2"}>Password</div><PasswordInput className={inp} value={form.password || ""} autoComplete="new-password" onChange={(e) => f("password", e.target.value)} />
              {!form.isPool && (<><div className={lab + " mt-2"}>Country</div><CountrySelect className={inp} value={form.country || ""} onChange={(v) => f("country", v)} /></>)}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><div className={lab}>Leverage</div><input type="number" className={inp} value={form.leverage} onChange={(e) => f("leverage", Number(e.target.value))} /></div>
                <div><div className={lab}>Currency</div><select className={inp} value={form.currency} onChange={(e) => f("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
              </div>
              <div className={lab + " mt-2"}>Manager (optional)</div>
              <select className={inp} value={form.managerId || ""} onChange={(e) => f("managerId", e.target.value || null)}><option value="">- none -</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              {err && modal === "client" && <div className="mt-2 rounded border px-2 py-1.5 text-[10px]" style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.3)", color: SELL }}><i className="fa-solid fa-circle-exclamation mr-1" />{err}</div>}
              <button onClick={() => submit("/api/admin/clients", { name: form.name, email: form.isPool ? "" : form.email, password: form.password, type: form.type, leverage: Number(form.leverage) || 100, currency: form.currency, managerId: form.managerId || null, phone: form.phone, country: form.country, isPool: !!form.isPool }, "Client")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Create {form.type} Client</button>
            </>)}
            {modal === "manager" && (<>
              <div className={lab + " mt-1"}>Name</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              <div className={lab + " mt-2"}>Email</div><input className={inp} value={form.email || ""} onChange={(e) => f("email", e.target.value)} />
              <div className={lab + " mt-2"}>Password</div><PasswordInput className={inp} value={form.password || ""} onChange={(e) => f("password", e.target.value)} />
              {err && modal === "manager" && <div className="mt-2 rounded border px-2 py-1.5 text-[10px]" style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.3)", color: SELL }}><i className="fa-solid fa-circle-exclamation mr-1" />{err}</div>}
              <button onClick={() => submit("/api/admin/managers", { name: form.name, email: form.email, password: form.password }, "Manager")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Create Manager</button>
            </>)}
            {modal === "group" && (<>
              {tradeGroups.length > 0 && (<div className="mb-2 max-h-40 overflow-auto rounded border border-[var(--border)]">
                {tradeGroups.map((g: any) => { const mgr = managers.find((m) => m.id === g.managerId); return (
                  <div key={g.id} className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1 text-[11px] last:border-0" style={form.editId === g.id ? { background: "var(--soft)" } : undefined}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{g.name}</div>
                      <div className="truncate text-[9px] text-[var(--muted)]">{mgr ? mgr.name : "Admin-level"}</div>
                    </div>
                    <button title="Edit" onClick={() => editGroup(g)} className="rounded px-1.5 py-0.5" style={{ color: "var(--accent)" }}><i className="fa-solid fa-pen" /></button>
                    <button title="Delete" onClick={() => delGroup(g)} className="rounded px-1.5 py-0.5" style={{ color: SELL }}><i className="fa-solid fa-trash" /></button>
                  </div>); })}
              </div>)}
              <div className={lab + " mt-1"}>{form.editId ? "Edit group name" : "New group name"}</div><input className={inp} value={form.name || ""} onChange={(e) => f("name", e.target.value)} />
              <div className={lab + " mt-2"}>Manager (owns this group)</div>
              <select className={inp} value={form.managerId || ""} onChange={(e) => f("managerId", e.target.value || null)}><option value="">Admin-level (no manager)</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <div className="mt-3 flex gap-2">
                <button onClick={saveGroup} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>{form.editId ? "Save Changes" : "Create Group"}</button>
                {form.editId && <button onClick={() => setForm({ type: "LIVE", leverage: 100, currency: "USD" })} className="rounded border border-[var(--border)] px-3 py-2 text-xs">New</button>}
              </div>
            </>)}
            {modal === "notify" && (
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 230px" }}>
                {/* LEFT — compose */}
                <div className="min-w-0">
                  <div className={lab + " mt-1"}>Template</div>
                  <div className="flex flex-wrap gap-1">{Object.keys(NOTI_TEMPLATES).map((k) => (<button key={k} onClick={() => { const t = NOTI_TEMPLATES[k]; setForm((pp: any) => ({ ...pp, title: t.title, body: t.body, template: k })); }} className="rounded border px-2 py-1 text-[10px]" style={{ borderColor: "var(--border)", color: form.template === k ? "var(--text)" : "var(--muted)", background: form.template === k ? "var(--soft)" : "transparent" }}>{k}</button>))}</div>
                  <div className={lab + " mt-2"}>Target</div>
                  <select className={inp} value={form.ntarget || "all_clients"} onChange={(e) => f("ntarget", e.target.value)}><option value="all_clients">All clients</option><option value="managers">All managers</option><option value="client">Specific client</option></select>
                  {form.ntarget === "client" && (<><div className={lab + " mt-2"}>Client</div><select className={inp} value={form.naccountId || ""} onChange={(e) => f("naccountId", e.target.value)}><option value="">- select -</option>{(() => { const seen = new Set<string>(); const logN = (cl: any) => { const n = parseInt(cl.login, 10); return isNaN(n) ? Number.MAX_SAFE_INTEGER : n; }; const sorted = [...clients].sort((a: any, b: any) => { const ap = a.parentId ? 1 : 0, bp = b.parentId ? 1 : 0; if (ap !== bp) return ap - bp; return logN(a) - logN(b); }); return sorted.filter((cl: any) => { const key = String(cl.user?.email || cl.email || cl.userId || cl.name || cl.id).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).map((cl: any) => <option key={cl.id} value={cl.id}>{cl.login} {cl.type} — {cl.name}</option>); })()}</select></>)}
                  <div className={lab + " mt-2"}>Title</div><input className={inp} value={form.title || ""} onChange={(e) => f("title", e.target.value)} />
                  <div className={lab + " mt-2"}>Message</div><textarea className={inp} rows={3} value={form.body || ""} onChange={(e) => f("body", e.target.value)} />
                  <div className={lab + " mt-2"}>Image URL (optional)</div><input className={inp} value={form.image || ""} onChange={(e) => f("image", e.target.value)} placeholder="https://..." />
                  <button onClick={() => submit("/api/admin/notify", { title: form.title, body: form.body, image: form.image, target: form.ntarget || "all_clients", accountId: form.naccountId }, "Notification")} className="mt-3 w-full rounded py-2 text-xs" style={{ background: BUY, color: "#04140e" }}>Send notification</button>
                </div>
                {/* RIGHT — recently sent (own scroll, keeps modal height fixed) */}
                <div className="min-w-0 border-l pl-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1 text-[10px] font-semibold text-[var(--muted)]">Recently sent</div>
                  <div className="space-y-1.5 overflow-auto pr-1" style={{ maxHeight: 360 }}>
                    {nrecent.length === 0 ? <div className="text-[10px] text-[var(--muted)]">Nothing yet.</div> : nrecent.map((n: any, i: number) => { const ic = iconForNotification(n); return (
                      <div key={i} className="flex items-start gap-1.5 text-[10px]">
                        <i className={"fa-solid " + ic.icon + " mt-0.5"} style={{ color: ic.color, fontSize: 10, width: 12, textAlign: "center" }} />
                        <div className="min-w-0"><div className="truncate text-[var(--text)]">{n.title}</div><div className="text-[9px] text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</div></div>
                      </div>
                    ); })}
                  </div>
                </div>
              </div>
            )}
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
        const saveSpreadOverride = async (sym: string, val: string) => {
          const trimmed = val.trim();
          const payload = trimmed === "" ? { symbol: sym, spreadOverride: null } : { symbol: sym, spreadOverride: Number(trimmed) };
          await fetch("/api/admin/clients/" + symOv.acc.id + "/symbols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        };
        const q = (symOv.q || "").toLowerCase();
        const grouped: Record<string, any[]> = {};
        symbols.filter((s) => !q || (s.symbol + " " + (s.display || "")).toLowerCase().includes(q)).forEach((s) => { const c = s.category || "other"; (grouped[c] || (grouped[c] = [])).push(s); });
        const cats = Object.entries(grouped).sort((a, b) => (CAT_ORDER.indexOf(a[0]) === -1 ? 99 : CAT_ORDER.indexOf(a[0])) - (CAT_ORDER.indexOf(b[0]) === -1 ? 99 : CAT_ORDER.indexOf(b[0])));
        const catName = (c: string) => c === "metals" ? "PREC. METALS" : c.toUpperCase();
        const spreadOvCount = Object.keys(symOv.spreadOverrides || {}).filter((k) => (symOv.spreadOverrides[k] ?? "") !== "").length;
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop flex max-h-[88vh] w-[580px] max-w-[95vw] flex-col rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}><i className="fa-solid fa-sliders" /></span>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">Symbol Settings — {symOv.acc.name}</div><div className="truncate text-[11px] text-[var(--muted)]">ID: {symOv.acc.login}</div></div>
              <button onClick={() => setSymOv(null)} className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
            </div>
            {/* Tabs */}
            <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
              {(["access", "spread"] as const).map((tab) => (
                <button key={tab} onClick={() => setSymOvTab(tab)} className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors" style={{ borderColor: symOvTab === tab ? "var(--accent)" : "transparent", color: symOvTab === tab ? "var(--accent)" : "var(--muted)" }}>
                  <i className={"fa-solid " + (tab === "access" ? "fa-ban" : "fa-arrows-left-right")} style={{ fontSize: 9 }} />
                  {tab === "access" ? "Symbol Access" : "Spread Override"}
                  {tab === "spread" && spreadOvCount > 0 && <span className="rounded-full px-1.5 text-[9px]" style={{ background: "var(--accent)", color: "#fff" }}>{spreadOvCount}</span>}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
              <input value={symOv.q || ""} onChange={(e) => setSymOv((o: any) => ({ ...o, q: e.target.value }))} placeholder="Search symbols…" className={inp + " mt-0"} />
              {symOvTab === "access" && <div className="mt-1 text-[10px] text-[var(--muted)]">Turning a symbol <span style={{ color: "#e05260" }}>off</span> hides it from <b>this client only</b>.</div>}
              {symOvTab === "spread" && <div className="mt-1 text-[10px] text-[var(--muted)]">Enter pips to override spread for this client. <b>0</b> = zero spread. Leave blank = use default symbol spread.</div>}
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto px-4 py-2">
              {symOvTab === "access" && (<>
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
              </>)}
              {symOvTab === "spread" && (<>
                {cats.map(([cat, list]) => (
                  <div key={cat} className="mb-3">
                    <div className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">{catName(cat)}</div>
                    <div className="space-y-1">
                      {list.map((s) => {
                        const val = (symOv.spreadOverrides || {})[s.symbol];
                        const hasOv = val !== undefined && val !== "";
                        return (
                          <div key={s.symbol} className="flex items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: hasOv ? "var(--accent)" : "var(--border)", background: "var(--bg)" }}>
                            <span className="w-[90px] shrink-0 text-[11px] font-semibold">{s.display || s.symbol}</span>
                            <input
                              type="number" min="0" step="0.1"
                              placeholder="default"
                              value={val ?? ""}
                              onChange={(e) => setSymOv((o: any) => ({ ...o, spreadOverrides: { ...o.spreadOverrides, [s.symbol]: e.target.value } }))}
                              onBlur={(e) => saveSpreadOverride(s.symbol, e.target.value)}
                              className="w-[70px] rounded border px-2 py-1 text-[11px] font-mono"
                              style={{ borderColor: "var(--border)", background: "var(--bg2)", color: "var(--text)" }}
                            />
                            <span className="text-[10px] text-[var(--muted)]">pips</span>
                            {hasOv && (
                              <button onClick={() => { setSymOv((o: any) => { const ov = { ...o.spreadOverrides }; delete ov[s.symbol]; return { ...o, spreadOverrides: ov }; }); saveSpreadOverride(s.symbol, ""); }} className="ml-auto text-[10px]" style={{ color: "#e05260" }} title="Reset to default">
                                <i className="fa-solid fa-rotate-left" />
                              </button>
                            )}
                            {!hasOv && <span className="ml-auto text-[9px] text-[var(--muted)]">default</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {cats.length === 0 && <div className="py-6 text-center text-[var(--muted)]">No symbols match.</div>}
              </>)}
            </div>
            <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setSymOv(null)} className="w-full rounded-lg py-2 text-xs font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>Done</button>
            </div>
          </div>
        </div>
        );
      })()}
      {mt && mtMin && (
        <div className="fixed bottom-3 right-3 z-[60] flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
          <i className="fa-solid fa-bolt" style={{ color: "var(--accent)" }} />
          <span className="font-semibold">Manual Trade — {mt.acc.login}</span>
          <button onClick={() => setMtMin(false)} title="Restore" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-up-right-and-down-left-from-center" /></button>
          <button onClick={() => { setMt(null); setMtMin(false); }} title="Close" className="rounded px-1.5 py-0.5 text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
        </div>
      )}
      {mt && !mtMin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">Manual Trade - <span style={{ color: "var(--accent)" }}>{mt.acc.login} - {mt.acc.name}</span></div>
              <div className="flex items-center gap-1">
                <button onClick={() => setMtMin(true)} title="Minimize" className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-window-minimize text-[10px]" /></button>
                <button onClick={() => setMt(null)} title="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button>
              </div>
            </div>
            <div className={lab}>Symbol</div>
            <SymbolPicker className={inp} symbols={symbols} value={mt.symbol} onChange={(sym) => setMt({ ...mt, symbol: sym, openPrice: mt.follow ? (prices[sym] ?? 0) : mt.openPrice })} />
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
              <div><div className="flex items-center justify-between"><span className={lab}>{mt.kind && mt.kind !== "MARKET" ? "Trigger Price" : "Open Price"}</span>{mt.follow ? <span className="text-[9px]" style={{ color: GOLD }}><i className="fa-solid fa-circle mr-1 text-[6px] align-middle" />Following live</span> : <button onClick={() => setMt({ ...mt, follow: true, openPrice: prices[mt.symbol] ?? mt.openPrice })} className="text-[9px] underline" style={{ color: "var(--accent)" }}>Follow live</button>}</div><input type="number" className={inp} value={mt.follow ? (prices[mt.symbol] != null ? prices[mt.symbol].toFixed(dg(mt.symbol)) : mt.openPrice) : mt.openPrice} onChange={(e) => setMt({ ...mt, openPrice: e.target.value, follow: false })} /></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><div className={lab}>Stop Loss (0=OFF)</div><input type="number" className={inp} value={mt.sl} onChange={(e) => setMt({ ...mt, sl: e.target.value })} /></div>
              <div><div className={lab}>Take Profit (0=OFF)</div><input type="number" className={inp} value={mt.tp} onChange={(e) => setMt({ ...mt, tp: e.target.value })} /></div>
            </div>
            <div className="mt-2 rounded bg-[var(--soft)] px-2 py-1.5 text-[10px] text-[var(--muted)]">{(() => {
              const cur = prices[mt.symbol];
              const op = mt.follow ? (cur ?? Number(mt.openPrice)) : Number(mt.openPrice);
              const pv = (cur != null && op) ? pnlOf({ symbol: mt.symbol, type: mt.type, lots: Number(mt.lots) || 0, openPrice: op }, cur, csz(mt.symbol)) : 0;
              return <>Live: {cur != null ? gpx(mt.symbol, cur) : "..."} | PnL Preview: <span style={{ color: pv >= 0 ? BUY : SELL, fontWeight: 700 }}>{gnum(pv, 2)}</span></>;
            })()}</div>
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMt(null)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button>
              <button onClick={placeMT} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>{mt.kind && mt.kind !== "MARKET" ? "Place Pending Order" : "Place Trade"}</button>
            </div>
          </div>
        </div>
      )}
      {hEdit && (() => { const isFin = String(hEdit.id).startsWith("F"); return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.18)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">Edit {isFin ? "Transaction" : "Trade"} {hEdit.ticket}</div>
            {isFin ? (<>
              <div className={lab}>Amount</div><input type="number" className={inp} value={hEdit.amt} onChange={(e) => setHEdit({ ...hEdit, amt: e.target.value })} />
              <div className={lab}>Description</div><input className={inp} value={hEdit.desc || ""} onChange={(e) => setHEdit({ ...hEdit, desc: e.target.value })} />
            </>) : (<>
              <div className={lab}>Close Price</div><input type="number" className={inp} value={hEdit.closePrice} onChange={(e) => {
                const cp = Number(e.target.value);
                const auto = cp > 0 ? pnlFor(hEdit.symbol, hEdit.side, Number(hEdit.openPrice), cp, Number(hEdit.lots)) : Number(hEdit.pnl);
                setHEdit({ ...hEdit, closePrice: e.target.value, pnl: Number(auto.toFixed(2)), _pnlAuto: true });
              }} />
              <div className={lab}>P&amp;L <span style={{fontSize:"10px",opacity:0.5}}>{hEdit._pnlAuto ? "(auto)" : ""}</span></div><input type="number" className={inp} value={hEdit.pnl} onChange={(e) => setHEdit({ ...hEdit, pnl: e.target.value, _pnlAuto: false })} />
              <div className="grid grid-cols-2 gap-2"><div><div className={lab}>S/L</div><input type="number" className={inp} value={hEdit.sl} onChange={(e) => setHEdit({ ...hEdit, sl: e.target.value })} /></div><div><div className={lab}>T/P</div><input type="number" className={inp} value={hEdit.tp} onChange={(e) => setHEdit({ ...hEdit, tp: e.target.value })} /></div></div>
            </>)}
            {err && <div className="mt-2 text-[11px]" style={{ color: SELL }}>{err}</div>}
            <div className="mt-3 flex gap-2"><button onClick={() => setHEdit(null)} className="flex-1 rounded border border-[var(--border)] py-2 text-xs">Cancel</button><button onClick={submitHEdit} className="flex-1 rounded py-2 text-xs" style={{ background: "var(--accent)", color: "#fff" }}>Save</button></div>
          </div>
        </div>
      ); })()}
      {confirmBox && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold" style={{ color: confirmBox.danger ? SELL : "var(--text)" }}>
              <i className={"fa-solid " + (confirmBox.danger ? "fa-triangle-exclamation" : "fa-circle-question")} /> Please confirm
            </div>
            <div className="mb-3 text-[12px] text-[var(--muted)]">{confirmBox.msg}</div>
            {confirmBox.requireWord && (
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] text-[var(--muted)]">To confirm, type this word:</div>
                <div className="mb-2 flex items-center gap-2">
                  <code className="select-all rounded-md px-2 py-1 text-[13px] font-bold tracking-wider" style={{ background: "rgba(239,68,68,0.12)", color: SELL, border: "1px solid rgba(239,68,68,0.35)" }}>{confirmBox.requireWord}</code>
                  <button onClick={() => { try { navigator.clipboard.writeText(confirmBox.requireWord!); } catch {} }} className="rounded px-1.5 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--soft)]" title="Copy"><i className="fa-solid fa-copy" /></button>
                </div>
                <input autoFocus value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder="Type the word here" className="w-full rounded-lg border bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none" style={{ borderColor: confirmInput && confirmInput.trim().toUpperCase() === confirmBox.requireWord ? BUY : "var(--border)" }} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmBox(null); setConfirmInput(""); }} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">Cancel</button>
              {(() => { const ok = !confirmBox.requireWord || confirmInput.trim().toUpperCase() === confirmBox.requireWord; return (
                <button disabled={!ok} onClick={() => { if (!ok) return; const fn = confirmBox.onYes; setConfirmBox(null); setConfirmInput(""); fn(); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style={{ background: confirmBox.danger ? SELL : "var(--accent)" }}>Confirm</button>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" onClick={() => setToasts([])}>
          {toasts.map((t) => t.notif ? (
            <div key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[11px] shadow-xl" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", minWidth: 230, maxWidth: 300, borderLeft: `3px solid ${t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : t.st === "login" ? "#a78bfa" : BUY}` }}>
              <i className={"fa-solid mt-0.5 " + (t.st === "trade" ? "fa-chart-line" : t.st === "funds" ? "fa-money-bill" : t.st === "login" ? "fa-right-to-bracket" : "fa-bell")} style={{ color: t.st === "trade" ? "#2f81f7" : t.st === "funds" ? GOLD : t.st === "login" ? "#a78bfa" : BUY, fontSize: 12 }} />
              <div className="min-w-0"><div className="font-semibold">{t.title}</div>{t.body && <div className="mt-0.5 text-[10px] text-[var(--muted)]">{t.body}</div>}</div>
            </div>
          ) : (
            <div key={t.id} className="cursor-pointer rounded-md border px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--panel)", borderColor: t.kind === "err" ? SELL : BUY, color: "var(--text)", minWidth: 180 }}><span style={{ color: t.kind === "err" ? SELL : BUY }}>{t.kind === "err" ? "Error" : "Success"}</span> {t.msg}</div>
          ))}
        </div>
      )}

      {/* Symbol Access Modal */}
      {symPerm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop desk-modal flex max-h-[82vh] w-[420px] flex-col rounded-xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Symbol Access</div>
            <div className="mb-2 text-[10px]" style={{ color: "var(--muted)" }}>
              {symPerm.scope === "manager"
                ? "Switching a symbol OFF hides it only for YOUR assigned clients."
                : "Switching a symbol OFF hides it across the ENTIRE tenant (all clients, managers, desk). Other tenants are unaffected."}
            </div>
            <input value={symPerm.q || ""} onChange={(e) => setSymPerm((p: any) => ({ ...p, q: e.target.value }))} placeholder="Search symbol" className="mb-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]" />
            {/* Category-level bulk spread rows + All Symbols */}
            {!symPerm.q && (() => {
              const cats: Record<string, string[]> = {};
              symPerm.symbols.forEach((s: any) => { const c = s.category || "other"; (cats[c] || (cats[c] = [])).push(s.symbol); });
              return (
                <div className="mb-3 rounded-lg border border-[var(--border)] p-2">
                  <div className="mb-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Set spread by category</span>
                  </div>
                  {/* All Symbols row */}
                  <div className="flex items-center gap-2 py-1 border-b border-[var(--border)]">
                    <span className="capitalize text-[10px] font-semibold w-20 shrink-0">All Symbols</span>
                    <span className="text-[9px] shrink-0" style={{ color: "var(--muted)" }}>{symPerm.symbols.length} sym</span>
                    <button onClick={() => setAllSymEdit({ type: "FLOATING", pips: 0 })}
                      className="ml-auto rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                      Set spread
                    </button>
                  </div>
                  {Object.entries(cats).map(([cat, syms]) => {
                    const fixedCnt = syms.filter((s) => (adminSymTypes[s] ?? "FLOATING") === "FIXED").length;
                    return (
                    <div key={cat} className="flex items-center gap-2 py-1 border-b border-[var(--border)] last:border-0">
                      <span className="capitalize text-[10px] font-semibold w-20 shrink-0">{cat}</span>
                      <span className="text-[9px] shrink-0" style={{ color: "var(--muted)" }}>{syms.length} sym</span>
                      <span className="text-[9px] shrink-0 font-semibold tabular-nums" style={{ color: fixedCnt > 0 ? "var(--accent)" : "var(--muted)" }}>{fixedCnt}/{syms.length}</span>
                      <button onClick={() => setCatEdit({ cat, syms, spread: adminSymSpreads[syms[0]] ?? 0, spreadType: adminSymTypes[syms[0]] ?? "FLOATING", spreadMax: adminSymMax[syms[0]] ?? 0 })}
                        className="ml-auto rounded px-2 py-0.5 text-[9px] font-semibold" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                        Set spread
                      </button>
                    </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="flex-1 overflow-auto">
              {symPerm.symbols.filter((s: any) => s.symbol.toLowerCase().includes((symPerm.q || "").toLowerCase())).map((s: any) => {
                const off = symPerm.disabled.includes(s.symbol);
                return (
                  <div key={s.symbol} className="flex flex-col gap-1 border-b border-[var(--border)] py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1"><span className="font-medium">{s.symbol}</span> <span style={{ color: "var(--muted)" }}>{s.display}</span></div>
                      <button onClick={() => toggleSymPerm(s.symbol, !off)} className="rounded px-2 py-0.5 text-[10px] font-semibold shrink-0" style={off ? { background: "rgba(224,82,96,0.16)", color: SELL } : { background: "rgba(38,166,154,0.16)", color: BUY }}>
                        {off ? "OFF" : "ON"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {(adminSymTypes[s.symbol] || "FLOATING") === "FIXED" ? (
                        <span className="text-[9px] rounded px-1.5 py-0.5 font-semibold" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
                          Fixed · {adminSymSpreads[s.symbol] ?? 0} pips
                        </span>
                      ) : (
                        <span className="text-[9px] rounded px-1.5 py-0.5 font-semibold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>Auto spread</span>
                      )}
                      <button title="Spread, swap & commission settings" onClick={() => { const sid = adminSymIds[s.symbol]; if (sid) setSymEdit({ sym: s.symbol, id: sid, spread: adminSymSpreads[s.symbol] ?? 0, spreadType: adminSymTypes[s.symbol] ?? "FLOATING", spreadMax: adminSymMax[s.symbol] ?? 0, swapLong: Number(s.swapLong ?? 0), swapShort: Number(s.swapShort ?? 0), commissionPerLot: Number(s.commissionPerLot ?? 0) }); }} className="ml-auto rounded p-1 text-[10px]" style={{ color: "var(--muted)" }}>
                        <i className="fa-solid fa-gear" />
                      </button>
                    </div>
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop desk-modal w-[420px] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold">Upload KYC Document</div>
            <div className="mb-3 text-[10px]" style={{ color: "var(--muted)" }}>{kycUploadFor.login} — {kycUploadFor.name}</div>
            {kycUploadFor.kycStatus === "APPROVED" ? (
              <div className="rounded-xl px-4 py-5 text-center" style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)" }}>
                <i className="fa-solid fa-circle-check text-2xl mb-2" style={{ color: BUY }} />
                <div className="text-sm font-semibold" style={{ color: BUY }}>Already Verified</div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>This client's identity has been verified. No further documents are required.</div>
              </div>
            ) : (
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
            )}
            {err && <div className="mt-2 text-[10px]" style={{ color: SELL }}>{err}</div>}
            {kycUpMsg && <div className="mt-2 text-[10px]" style={{ color: BUY }}>{kycUpMsg}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setKycUploadFor(null)} className="flex-1 rounded border py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Close</button>
              {kycUploadFor.kycStatus !== "APPROVED" && (
                <button onClick={uploadKyc} className="flex-1 rounded py-2 text-[11px] font-semibold" style={{ background: BUY, color: "#04140e" }}>Upload</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Statement Date Filter Modal */}
      {stmtModal && selAcc && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop desk-modal w-[420px] max-w-[95vw] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold">Export PDF Statement</div>
            <div className="mb-4 text-[10px]" style={{ color: "var(--muted)" }}>{selAcc.login} — {selAcc.name}</div>
            <div className="mb-3 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Date Range</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["day","month","year","all","custom"] as const).map((p) => (
                <button key={p} onClick={() => {
                  setStmtPreset(p);
                  if (p !== "custom") {
                    const now = new Date();
                    if (p === "day") { const d = now.toISOString().slice(0,10); setStmtFrom(d); setStmtTo(d); }
                    else if (p === "month") { const y = now.getFullYear(), m = now.getMonth(); setStmtFrom(new Date(y,m,1).toISOString().slice(0,10)); setStmtTo(new Date(y,m+1,0).toISOString().slice(0,10)); }
                    else if (p === "year") { const y = now.getFullYear(); setStmtFrom(`${y}-01-01`); setStmtTo(`${y}-12-31`); }
                    else { setStmtFrom(""); setStmtTo(""); }
                  }
                }} className="rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors" style={{ background: stmtPreset === p ? "var(--accent, #3b82f6)" : "var(--soft)", color: stmtPreset === p ? "#fff" : "var(--text)", border: "1px solid " + (stmtPreset === p ? "transparent" : "var(--border)") }}>
                  {p === "all" ? "All Time" : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            {stmtPreset === "custom" && (
              <div className="mb-3 flex gap-2">
                <div className="flex-1">
                  <div className="mb-1 text-[10px]" style={{ color: "var(--muted)" }}>From</div>
                  <input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="w-full rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-[10px]" style={{ color: "var(--muted)" }}>To</div>
                  <input type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} className="w-full rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setStmtModal(false)} className="flex-1 rounded border py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button onClick={() => {
                const params = new URLSearchParams({ accountId: selAcc.id });
                if (stmtFrom) params.set("from", stmtFrom);
                if (stmtTo) params.set("to", stmtTo);
                window.open("/api/desk/statement?" + params.toString(), "_blank");
                setStmtModal(false);
              }} className="flex-1 rounded py-2 text-[11px] font-semibold" style={{ background: "#ef4444", color: "#fff" }}>
                <i className="fa-solid fa-file-pdf mr-1" /> Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Statement Modal (separate from download). The visible recipient is
          the confirmation — no browser dialog. */}
      {stmtEmailModal && selAcc && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="ui-pop desk-modal w-[420px] max-w-[95vw] rounded-xl border p-5" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-semibold">Email Statement</div>
            <div className="mb-3 text-[10px]" style={{ color: "var(--muted)" }}>{selAcc.login} — {selAcc.name}</div>
            <div className="mb-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Date Range</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["day", "month", "year", "all", "custom"] as const).map((p) => (
                <button key={p} onClick={() => { setStmtPreset(p); if (p !== "custom") { const now = new Date(); if (p === "day") { const dd = now.toISOString().slice(0, 10); setStmtFrom(dd); setStmtTo(dd); } else if (p === "month") { const y = now.getFullYear(), m = now.getMonth(); setStmtFrom(new Date(y, m, 1).toISOString().slice(0, 10)); setStmtTo(new Date(y, m + 1, 0).toISOString().slice(0, 10)); } else if (p === "year") { const y = now.getFullYear(); setStmtFrom(`${y}-01-01`); setStmtTo(`${y}-12-31`); } else { setStmtFrom(""); setStmtTo(""); } } }} className="rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize" style={{ background: stmtPreset === p ? "#3b82f6" : "var(--soft)", color: stmtPreset === p ? "#fff" : "var(--text)", border: "1px solid " + (stmtPreset === p ? "transparent" : "var(--border)") }}>{p === "all" ? "All Time" : p}</button>
              ))}
            </div>
            {stmtPreset === "custom" && (
              <div className="mb-3 flex gap-2">
                <input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="flex-1 rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                <input type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} className="flex-1 rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
            )}
            <div className="mb-1 text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Send statement (PDF) to</div>
            <input type="email" value={stmtEmail} onChange={(e) => { setStmtEmail(e.target.value); setStmtMsg(""); }} placeholder="Leave blank to use client's registered email" className="mb-1 w-full rounded border px-2 py-1.5 text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
            <div className="mb-2 text-[9px]" style={{ color: "var(--muted)" }}>Sent from the broker's email as no-reply.</div>
            {stmtMsg && <div className="mb-2 text-[10px]" style={{ color: stmtMsg.startsWith("✓") ? "#16a34a" : "#ef4444" }}>{stmtMsg}</div>}
            <div className="flex gap-2">
              <button onClick={() => setStmtEmailModal(false)} className="flex-1 rounded border py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
              <button disabled={stmtSending} onClick={async () => {
                setStmtSending(true); setStmtMsg("");
                const r = await fetch("/api/desk/statement/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: selAcc.id, email: stmtEmail.trim() || undefined, from: stmtFrom || undefined, to: stmtTo || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false }));
                setStmtSending(false);
                if (r.ok) setStmtMsg("✓ Sent to " + r.to); else setStmtMsg(r.error || "Failed to send");
              }} className="flex-1 rounded py-2 text-[11px] font-semibold disabled:opacity-60" style={{ background: "#3b82f6", color: "#fff" }}>
                <i className="fa-solid fa-envelope mr-1" /> {stmtSending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}