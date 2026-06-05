"use client";
import { useEffect, useRef, useState } from "react";
import LWChart from "@/components/LWChart";

const INDS: [string, string][] = [["RSI", "RSI@tv-basicstudies"], ["MACD", "MACD@tv-basicstudies"], ["Stoch", "Stochastic@tv-basicstudies"], ["BBands", "BB@tv-basicstudies"], ["MA", "MASimple@tv-basicstudies"], ["ROC", "ROC@tv-basicstudies"]];

const DARK: any = { "--bg": "#0b0e14", "--panel": "#131722", "--card": "#1a1f2b", "--border": "#242a38", "--text": "#e8eaed", "--muted": "#8a93a6", "--soft": "#1e2433" };
const LIGHT: any = { "--bg": "#f1f5f9", "--panel": "#ffffff", "--card": "#ffffff", "--border": "#e2e8f0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f7" };
const BUY = "#16a34a", SELL = "#dc2626", GOLD = "#e3a855", BLUE = "#2563eb";
const LOTS = [0.01, 0.05, 0.1, 0.5, 1];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const acctBal = (a: any) => Number(a?.deposit || 0) - Number(a?.withdrawal || 0) + Number(a?.credit || 0) + Number(a?.bonus || 0) + Number(a?.pnl || 0);

const ORDER_KINDS: [string, string, string][] = [
  ["MARKET", "BUY", "Market"],
  ["LIMIT", "BUY", "Buy Limit"], ["LIMIT", "SELL", "Sell Limit"],
  ["STOP", "BUY", "Buy Stop"], ["STOP", "SELL", "Sell Stop"],
];

export default function ClientMobile({ t }: { t: any }) {
  const [noOpen, setNoOpen] = useState(false);
  const [noForm, setNoForm] = useState<any>({ idx: 0, lots: 0.01, trigger: "", sl: "", tp: "" });
  const [balOpen, setBalOpen] = useState(false);
  const {
    theme, brand, account, accts, accId, needKyc, positions, pending, history, financials, notis, symbols, prices, dirs,
    selSym, vol, sl, tp, err,
    balance, equity, floating, free, used, level, price, bid, ask, tf, TFS,
    setSelSym, setVol, setSl, setTp, setTf,
    place, quickTrade, placePending, close, cancelPending, switchAcc, openAccount, topUp, doTopUp, doTransfer, xfer, setXfer, xferModal, setXferModal, xferErr,
    toggleTheme, enablePush, addPasskey, openPin, favs, toggleFav, avatarUrl, uploadAvatar,
    fmt, csz, pnlOf, dg, logout, pin,
  } = t;

  const [tab, setTab] = useState<"dashboard" | "quotes" | "chart" | "trades" | "history" | "profile">("dashboard");
  const [mInd, setMInd] = useState<string[]>([]);
  const [histTab, setHistTab] = useState<"trades" | "financial">("trades");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [qcat, setQcat] = useState<string>("favs");
  const [modifyId, setModifyId] = useState<string | null>(null);
  const [mSl, setMSl] = useState("");
  const [mTp, setMTp] = useState("");
  const avatarRef = useRef<HTMLInputElement>(null);
  const baselineRef = useRef<Record<string, number>>({});

  // capture a session baseline price for % change movers
  useEffect(() => {
    const b = baselineRef.current;
    Object.keys(prices || {}).forEach((s) => { if (b[s] == null && prices[s] != null) b[s] = prices[s]; });
  }, [prices]);

  const unread = (notis || []).filter((n: any) => !n.read).length;
  const initial = (account?.ownerName || account?.name || "U").charAt(0).toUpperCase();

  // categories — ordered Crypto, Forex, Indices, then the rest
  const CAT_ORDER = ["crypto", "forex", "indices", "metals", "stocks", "energy", "agriculture", "other"];
  const cats: string[] = [];
  (symbols || []).forEach((s: any) => { const c = cap(s.category || "Other"); if (!cats.includes(c)) cats.push(c); });
  cats.sort((a, b) => { const ia = CAT_ORDER.indexOf(a.toLowerCase()); const ib = CAT_ORDER.indexOf(b.toLowerCase()); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });

  const quoteList = (symbols || []).filter((s: any) => {
    if (search && !(`${s.display || s.symbol}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (qcat === "favs") return (favs || []).includes(s.symbol);
    return cap(s.category || "Other") === qcat;
  });

  const pctOf = (sym: string) => {
    const b = baselineRef.current[sym]; const p = prices[sym];
    if (b == null || p == null || !b) return 0;
    return ((p - b) / b) * 100;
  };

  // movers
  const priced = (symbols || []).filter((s: any) => prices[s.symbol] != null);
  const gainers = priced.filter((s: any) => (dirs?.[s.symbol] || 0) > 0).slice(0, 3);
  const losers = priced.filter((s: any) => (dirs?.[s.symbol] || 0) < 0).slice(0, 3);

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

  const Stepper = ({ small }: { small?: boolean }) => (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2">
        <button onClick={() => setVol((v: number) => Math.max(0.01, +(v - 0.01).toFixed(2)))} className="flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--soft)]" style={{ width: small ? 30 : 34, height: small ? 30 : 34 }}>−</button>
        <span className="font-semibold tabular-nums" style={{ minWidth: 44, textAlign: "center" }}>{Number(vol).toFixed(2)}</span>
        <button onClick={() => setVol((v: number) => +(v + 0.01).toFixed(2))} className="flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--soft)]" style={{ width: small ? 30 : 34, height: small ? 30 : 34 }}>+</button>
      </div>
      <span className="mt-0.5 text-[9px] text-[var(--muted)]">Lots</span>
    </div>
  );

  return (
    <div style={{ ...(theme === "dark" ? DARK : LIGHT), fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", height: "100dvh", paddingTop: "env(safe-area-inset-top)" }} className="flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <input type="file" accept="image/*" style={{ display: "none" }} ref={avatarRef} onChange={uploadAvatar} />

      {/* TOP HEADER */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar size={38} />
          <div className="leading-tight">
            <div className="text-sm font-bold">{account?.ownerName || account?.name || "Trader"}</div>
            <div className="text-[10px] text-[var(--muted)]">{account?.type === "LIVE" ? "Live" : "Demo"} #{account?.login} · 1:{account?.leverage}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: "var(--soft)", color: GOLD }}>{brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="h-3.5 w-3.5 rounded object-contain" /> : <i className="fa-solid fa-cube" />} {brand?.name || ""}</span>
          <button className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[var(--soft)]">
            <i className="fa-solid fa-bell text-[var(--muted)]" />
            {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: SELL }} />}
          </button>
        </div>
      </div>

      {/* Read-only banner */}
      {t.readOnly && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(220,38,38,0.16)", color: SELL }}>
          <i className="fa-solid fa-lock" /> READ ONLY ACCESS — all actions disabled
        </div>
      )}

      {/* CONTENT */}
      <div className="min-h-0 flex-1 overflow-auto">

        {/* ───────── DASHBOARD ───────── */}
        {tab === "dashboard" && (
          <div className="space-y-4 p-3">
            {/* account card */}
            <div className="relative overflow-hidden rounded-2xl p-4" style={{
              background: "linear-gradient(135deg,#10141d 0%,#1a2230 100%)",
              border: `1px solid ${account?.type === "LIVE" ? "rgba(22,163,74,.4)" : "rgba(227,168,85,.4)"}`,
              boxShadow: `0 0 30px ${account?.type === "LIVE" ? "rgba(22,163,74,.12)" : "rgba(227,168,85,.12)"}`,
            }}>
              <div className="flex items-start justify-between">
                <div className="text-[11px] font-bold tracking-widest text-white/80">{(brand?.name || "").toUpperCase() || "TRADING"}</div>
                <div className="flex gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: account?.type === "LIVE" ? "rgba(22,163,74,.25)" : "rgba(227,168,85,.25)", color: account?.type === "LIVE" ? "#4ade80" : GOLD }}>{account?.type}</span>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: "rgba(22,163,74,.2)", color: "#4ade80" }}>● ACTIVE</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-white/70">
                <i className="fa-solid fa-microchip" /><i className="fa-solid fa-wifi text-[11px]" />
              </div>
              <div className="mt-2 font-mono text-lg tracking-[0.3em] text-white">{fmtLogin(account?.login)}</div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <div className="text-[8px] tracking-widest text-white/40">CARDHOLDER</div>
                  <div className="text-[11px] font-semibold uppercase text-white/90">{account?.ownerName || account?.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[8px] tracking-widest text-white/40">BALANCE</div>
                  <div className="text-sm font-bold text-white">${fmt(balance)}</div>
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
                <button onClick={() => { window.location.href = "/client/wallet?action=deposit"; }} className="flex flex-col items-center gap-1 rounded-xl py-3 text-white" style={{ background: BUY }}><i className="fa-solid fa-arrow-down" /><span className="text-[11px] font-semibold">Deposit</span></button>
                <button onClick={() => { window.location.href = "/client/wallet?action=withdraw"; }} className="flex flex-col items-center gap-1 rounded-xl py-3 text-white" style={{ background: SELL }}><i className="fa-solid fa-arrow-up" /><span className="text-[11px] font-semibold">Withdraw</span></button>
                <button onClick={() => { setXfer({ ...(xfer || {}), fromId: accId }); setXferModal(true); }} className="flex flex-col items-center gap-1 rounded-xl py-3 text-white" style={{ background: BLUE }}><i className="fa-solid fa-right-left" /><span className="text-[11px] font-semibold">Transfer</span></button>
              </div>
            ) : (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">Top up your demo balance</div>
                <div className="grid grid-cols-3 gap-2">
                  {[1000, 5000, 10000].map((amt) => (
                    <button key={amt} onClick={() => doTopUp(amt)} className="flex flex-col items-center gap-0.5 rounded-xl py-3 font-semibold" style={{ background: "rgba(240,180,41,0.14)", color: GOLD, border: "1px solid rgba(240,180,41,0.4)" }}>
                      <i className="fa-solid fa-coins" /><span className="text-[12px]">${amt.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* market movers */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide">📈 MARKET MOVERS</div>
                <span className="text-[9px] text-[var(--muted)]">LIVE</span>
              </div>
              {priced.length === 0 ? <div className="py-4 text-center text-[11px] text-[var(--muted)]">Waiting for live prices…</div> : (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[9px] font-semibold text-[var(--muted)]">TOP GAINERS</div>
                    {(gainers.length ? gainers : priced.slice(0, 3)).map((s: any) => {
                      const p = pctOf(s.symbol);
                      return (
                        <button key={"g" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 py-1.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] text-white" style={{ background: BUY }}><i className="fa-solid fa-arrow-up" /></span>
                          <div className="flex-1 text-left"><div className="text-[12px] font-semibold">{s.display || s.symbol}</div><div className="text-[10px] text-[var(--muted)]">{prices[s.symbol]?.toFixed(dg(s.symbol))}</div></div>
                          <span className="text-[12px] font-semibold" style={{ color: BUY }}>{(p >= 0 ? "+" : "") + p.toFixed(2)}%</span>
                        </button>
                      );
                    })}
                  </div>
                  <div>
                    <div className="mb-1 text-[9px] font-semibold text-[var(--muted)]">TOP LOSERS</div>
                    {(losers.length ? losers : priced.slice(3, 6)).map((s: any) => {
                      const p = pctOf(s.symbol);
                      return (
                        <button key={"l" + s.symbol} onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="flex w-full items-center gap-2 py-1.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] text-white" style={{ background: SELL }}><i className="fa-solid fa-arrow-down" /></span>
                          <div className="flex-1 text-left"><div className="text-[12px] font-semibold">{s.display || s.symbol}</div><div className="text-[10px] text-[var(--muted)]">{prices[s.symbol]?.toFixed(dg(s.symbol))}</div></div>
                          <span className="text-[12px] font-semibold" style={{ color: SELL }}>{p.toFixed(2)}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───────── QUOTES ───────── */}
        {tab === "quotes" && (
          <div className="p-3">
            <div className="relative mb-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbols" className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm text-[var(--text)]" />
            </div>
            <div className="mb-3 flex gap-4 overflow-x-auto pb-1 text-[12px]" style={{ scrollbarWidth: "none" }}>
              <button onClick={() => setQcat("favs")} className="whitespace-nowrap pb-1 font-semibold" style={{ color: qcat === "favs" ? BLUE : "var(--muted)", borderBottom: qcat === "favs" ? `2px solid ${BLUE}` : "2px solid transparent" }}>★ Favourites</button>
              {cats.map((c) => (
                <button key={c} onClick={() => setQcat(c)} className="whitespace-nowrap pb-1 font-semibold" style={{ color: qcat === c ? BLUE : "var(--muted)", borderBottom: qcat === c ? `2px solid ${BLUE}` : "2px solid transparent" }}>{c}</button>
              ))}
            </div>
            <div className="space-y-2.5">
              {quoteList.length === 0 ? <div className="py-6 text-center text-[12px] text-[var(--muted)]">No symbols.</div> : quoteList.map((s: any) => {
                const dd = dg(s.symbol); const p = prices[s.symbol]; const isFav = (favs || []).includes(s.symbol);
                const sBid = p != null ? p * 0.9999 : null; const sAsk = p;
                const spread = p != null ? Math.max(1, Math.round((p - sBid!) / Math.pow(10, -dd))) : 0;
                const dr = dirs?.[s.symbol] || 0;
                return (
                  <div key={s.symbol} className="rounded-xl border bg-[var(--card)] p-3" style={{ borderColor: dr > 0 ? BUY : dr < 0 ? SELL : "var(--border)", transition: "border-color 0.4s ease" }}>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleFav(s.symbol)} style={{ color: isFav ? GOLD : "var(--muted)" }}>★</button>
                        <button onClick={() => { setSelSym(s.symbol); setTab("chart"); }} className="text-sm font-bold underline-offset-2 active:underline">{s.display || s.symbol}</button>
                        {dr !== 0 && <i className={"fa-solid " + (dr > 0 ? "fa-caret-up" : "fa-caret-down")} style={{ fontSize: 11, color: dr > 0 ? BUY : SELL }} />}
                      </div>
                      <span className="text-[10px] text-[var(--muted)]">Sprd: {spread} · <span style={{ color: "var(--accent,#5aa9ff)" }} onClick={() => { setSelSym(s.symbol); setTab("chart"); }}>chart</span></span>
                    </div>
                    <div className="grid grid-cols-3 items-center gap-2">
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "SELL"); }} className="rounded-lg py-2 text-center text-white" style={{ background: SELL }}>
                        <div className="text-[10px] opacity-80">SELL</div><div className="text-sm font-bold tabular-nums">{sBid != null ? sBid.toFixed(dd) : "…"}</div>
                      </button>
                      <Stepper small />
                      <button onClick={() => { setSelSym(s.symbol); quickTrade(s.symbol, "BUY"); }} className="rounded-lg py-2 text-center text-white" style={{ background: BUY }}>
                        <div className="text-[10px] opacity-80">BUY</div><div className="text-sm font-bold tabular-nums">{sAsk != null ? sAsk.toFixed(dd) : "…"}</div>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ───────── CHART ───────── */}
        {tab === "chart" && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2">
              <button onClick={() => setTab("quotes")} className="text-sm font-bold underline">{selSym || "--"}</button>
              <span className="text-[12px] font-semibold" style={{ color: BUY }}>{price != null ? price.toFixed(dg(selSym)) : "…"}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <select value={tf} onChange={(e) => setTf(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--text)]">
                  {(TFS || []).map((x: string) => <option key={x} value={x}>{x}</option>)}
                </select>
                <select value="" onChange={(e) => { if (e.target.value) setMInd((a) => a.includes(e.target.value) ? a : [...a, e.target.value]); }} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--text)]">
                  <option value="">+ Indicator</option>
                  {INDS.map(([label, id]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <button onClick={() => setMInd([])} className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--muted)]"><i className="fa-solid fa-trash text-[11px]" /></button>
                <button onClick={() => setMInd([])} className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--muted)]"><i className="fa-solid fa-xmark" /></button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 bg-[var(--bg)]">
              <LWChart symbol={selSym} tf={tf} theme={theme} digits={dg(selSym)}
                positions={[
                  ...(positions || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: o.id, type: o.type, lots: o.lots, openPrice: Number(o.openPrice), sl: o.sl ? Number(o.sl) : undefined, tp: o.tp ? Number(o.tp) : undefined, pnl: pnlOf(o, prices[o.symbol] ?? o.openPrice, csz(o.symbol)) })),
                  ...(t.pending || []).filter((o: any) => o.symbol === selSym).map((o: any) => ({ id: "pnd-" + o.id, type: o.side, lots: o.lots, openPrice: Number(o.price), sl: o.sl || undefined, tp: o.tp || undefined, kind: o.kind })),
                ]}
                onClose={(id: string) => { if (id.startsWith("pnd-")) { t.cancelPending && t.cancelPending(id.slice(4)); } else close(id); }} />
            </div>
            <div className="flex items-stretch gap-2 border-t border-[var(--border)] bg-[var(--panel)] p-2.5">
              <button onClick={() => quickTrade(selSym, "SELL", vol)} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white disabled:opacity-50" style={{ background: SELL }}>
                <div className="text-[10px] opacity-80">SELL</div><div className="text-base font-bold tabular-nums">{price != null ? bid.toFixed(dg(selSym)) : "…"}</div>
              </button>
              <div className="flex items-center"><Stepper /></div>
              <button onClick={() => quickTrade(selSym, "BUY", vol)} disabled={!account || account?.locked} className="flex-1 rounded-xl py-2.5 text-center text-white disabled:opacity-50" style={{ background: BUY }}>
                <div className="text-[10px] opacity-80">BUY</div><div className="text-base font-bold tabular-nums">{price != null ? ask.toFixed(dg(selSym)) : "…"}</div>
              </button>
            </div>
            {err && <div className="bg-[var(--panel)] pb-1 text-center text-[11px]" style={{ color: SELL }}>{err}</div>}
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
                  <div className="flex items-center justify-between p-3">
                    <div>
                      <div className="text-sm font-bold">{p.symbol} <span className="text-[12px] font-semibold" style={{ color: p.type === "BUY" ? BLUE : SELL }}>{p.type} {p.lots}</span></div>
                      <div className="text-[10px] text-[var(--muted)]">{Number(p.openPrice).toFixed(dd)} → {cur.toFixed(dd)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right text-sm font-bold" style={{ color: plv >= 0 ? BUY : SELL }}>{(plv >= 0 ? "+" : "") + fmt(plv)}</div>
                      <button onClick={() => close(p.id)} className="flex h-7 w-7 items-center justify-center rounded-full border" style={{ borderColor: SELL, color: SELL }}><i className="fa-solid fa-xmark" /></button>
                      <button onClick={() => setExpanded(open ? null : p.id)} className="text-[var(--muted)]"><i className={`fa-solid fa-chevron-${open ? "up" : "down"}`} /></button>
                    </div>
                  </div>
                  {open && (
                    <div className="border-t border-[var(--border)] p-3">
                      <div className="mb-2 text-[10px] text-[var(--muted)]">#{p.ticket} · opened {p.openedAt ? new Date(p.openedAt).toLocaleString() : "—"}</div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div><div className="text-[var(--muted)]">LOTS</div><div className="font-semibold">{p.lots}</div></div>
                        <div><div className="text-[var(--muted)]">OPEN</div><div className="font-semibold">{Number(p.openPrice).toFixed(dd)}</div></div>
                        <div><div className="text-[var(--muted)]">CURRENT</div><div className="font-semibold">{cur.toFixed(dd)}</div></div>
                        <div><div className="text-[var(--muted)]">S/L</div><div className="font-semibold">{p.sl ? Number(p.sl).toFixed(dd) : "—"}</div></div>
                        <div><div className="text-[var(--muted)]">T/P</div><div className="font-semibold">{p.tp ? Number(p.tp).toFixed(dd) : "—"}</div></div>
                        <div><div className="text-[var(--muted)]">TYPE</div><div className="font-semibold">{p.type}</div></div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => { setModifyId(p.id); setMSl(p.sl ? String(p.sl) : ""); setMTp(p.tp ? String(p.tp) : ""); }} className="rounded-lg border border-[var(--border)] bg-[var(--soft)] py-2 text-[12px] font-semibold">✎ Modify TP/SL</button>
                        <button onClick={() => close(p.id)} className="rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: SELL }}>✕ Close</button>
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
                    <div><div className="text-[var(--muted)]">TRIGGER</div><div className="font-semibold">{trig.toFixed(dd)}</div></div>
                    <div><div className="text-[var(--muted)]">CURRENT</div><div className="font-semibold">{cur != null ? cur.toFixed(dd) : "…"}</div></div>
                    <div><div className="text-[var(--muted)]">DISTANCE</div><div className="font-semibold">{dist != null ? dist.toFixed(dd) : "—"}</div></div>
                    <div><div className="text-[var(--muted)]">S/L</div><div className="font-semibold">{o.sl ? Number(o.sl).toFixed(dd) : "—"}</div></div>
                    <div><div className="text-[var(--muted)]">T/P</div><div className="font-semibold">{o.tp ? Number(o.tp).toFixed(dd) : "—"}</div></div>
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
                        </div>
                        <div className="text-sm font-bold" style={{ color: Number(h.pnl) >= 0 ? BUY : SELL }}>{(Number(h.pnl) >= 0 ? "+" : "") + fmt(Number(h.pnl))}</div>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">{Number(h.openPrice).toFixed(dd)} → {Number(h.closePrice).toFixed(dd)}</div>
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
                  const credit = ["DEPOSIT", "CREDIT_IN", "BONUS", "TRANSFER_IN", "INSURANCE"].includes(f.type);
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
                <button onClick={() => { window.location.href = "/client/wallet?action=kyc"; }} className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{ background: "#f0b829" }}>Upload KYC</button>
                {demoAccts.length > 0 && <button onClick={() => { const d = demoAccts.find((a: any) => a.id !== accId) || demoAccts[0]; if (d) switchAcc(d.id); }} className="mt-2 w-full rounded-xl border py-2 text-[12px] font-semibold" style={{ borderColor: "var(--border)" }}>Switch to demo account</button>}
              </div>
            )}
            {/* header block */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-wide">BALANCE SUMMARY</div>
                <select value={accId} onChange={(e) => switchAcc(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)]">
                  {(accts || []).map((a: any) => <option key={a.id} value={a.id}>{a.id === accId ? `Active (${a.login})` : a.login}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between py-1 text-[12px]">
                <span>{account?.login} {account?.type} ●</span>
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">RUNNING TRADE SUMMARY</div>
              <div className="mb-2 text-[10px] text-[var(--muted)]">Showing: {account?.login} · {account?.type} · {(positions || []).length} open</div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Floating P/L</span><span style={{ color: floating >= 0 ? BUY : SELL }}>${fmt(floating)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Equity</span><span>${fmt(equity)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Used Margin</span><span>${fmt(used)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Free Margin</span><span>${fmt(free)}</span></div>
              <div className="flex justify-between py-0.5 text-[12px]"><span className="text-[var(--muted)]">Margin Level</span><span>{level ? level.toFixed(2) : "0.00"}%</span></div>
            </div>

            {/* by direction */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
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
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">⚡ LIVE ACCOUNTS {liveAccts.length}</div>
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
              <button onClick={() => openAccount("LIVE")} className="mt-2 w-full rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: BUY }}><i className="fa-solid fa-plus mr-1" /> Create New Live Account</button>
            </div>

            {/* demo accounts */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">🧪 DEMO ACCOUNTS {demoAccts.length}</div>
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="mb-2 text-[11px] font-bold tracking-wide">SECURITY & SIGN-IN</div>
              <button onClick={openPin} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className="fa-solid fa-shield-halved text-[var(--muted)]" />
                <div className="flex-1"><div className="text-[12px] font-semibold">PIN Access</div><div className="text-[10px] text-[var(--muted)]">{pin?.pinHasPin ? "PIN is set — tap to change or remove" : "Set a PIN"}</div></div>
                {pin?.pinHasPin && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(22,163,74,.15)", color: BUY }}>ENABLED</span>}
                <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
              </button>
              <button onClick={addPasskey} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className="fa-solid fa-fingerprint text-[var(--muted)]" />
                <div className="flex-1"><div className="text-[12px] font-semibold">Face ID / Fingerprint</div><div className="text-[10px] text-[var(--muted)]">Tap to enable a passkey</div></div>
                <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
              </button>
              <button onClick={enablePush} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className="fa-solid fa-bell text-[var(--muted)]" />
                <div className="flex-1"><div className="text-[12px] font-semibold">Push Notifications</div><div className="text-[10px] text-[var(--muted)]">Tap to enable alerts</div></div>
                <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
              </button>
              <button onClick={toggleTheme} className="flex w-full items-center gap-3 py-2.5 text-left">
                <i className={`fa-solid fa-${theme === "dark" ? "sun" : "moon"} text-[var(--muted)]`} />
                <div className="flex-1"><div className="text-[12px] font-semibold">{theme === "dark" ? "Light mode" : "Dark mode"}</div></div>
                <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
              </button>
            </div>

            {/* export */}
            <button onClick={() => { try { window.open("/api/client/statement", "_blank"); } catch { window.print(); } }} className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-left">
              <i className="fa-solid fa-file-pdf" style={{ color: SELL }} />
              <div className="flex-1"><div className="text-[12px] font-semibold">Export PDF Statement</div><div className="text-[10px] text-[var(--muted)]">Download account history</div></div>
              <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
            </button>

            {/* logout */}
            <button onClick={logout} className="w-full rounded-xl py-3 text-sm font-semibold text-white" style={{ background: SELL }}><i className="fa-solid fa-right-from-bracket mr-1.5" /> Logout</button>
          </div>
        )}
      </div>

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
            <div className="w-full rounded-t-2xl p-4" style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
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
              {tab === "pending" && <div className="mb-2"><div className="mb-1 text-[10px] text-[var(--muted)]">Trigger price</div><input type="number" className={inp} style={ist} placeholder={price ? price.toFixed(dd) : "price"} value={noForm.trigger} onChange={(e) => setNoForm({ ...noForm, trigger: e.target.value })} /></div>}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div><div className="mb-1 text-[10px] text-[var(--muted)]">Stop Loss</div><input type="number" className={inp} style={ist} value={noForm.sl} onChange={(e) => setNoForm({ ...noForm, sl: e.target.value })} /></div>
                <div><div className="mb-1 text-[10px] text-[var(--muted)]">Take Profit</div><input type="number" className={inp} style={ist} value={noForm.tp} onChange={(e) => setNoForm({ ...noForm, tp: e.target.value })} /></div>
              </div>
              {err && <div className="mb-2 text-center text-[11px]" style={{ color: SELL }}>{err}</div>}
              {tab === "trade" ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => place("SELL", "MARKET")} className="flex flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white active:scale-[0.98]" style={{ background: SELL }}><span className="text-[11px] uppercase tracking-wide opacity-90">Sell</span><span className="text-[15px] tabular-nums">{price != null ? bid.toFixed(dd) : "…"}</span></button>
                  <button onClick={() => place("BUY", "MARKET")} className="flex flex-col items-center gap-0.5 rounded-xl py-3 font-bold text-white active:scale-[0.98]" style={{ background: BLUE }}><span className="text-[11px] uppercase tracking-wide opacity-90">Buy</span><span className="text-[15px] tabular-nums">{price != null ? ask.toFixed(dd) : "…"}</span></button>
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
      <button onClick={() => setBalOpen((v: boolean) => !v)} className="flex w-full items-center justify-between border-t border-[var(--border)] bg-[var(--panel)] px-4 py-1.5">
        <span className="text-[11px] text-[var(--muted)]">💼 Balance {balOpen ? "⌄" : "⌃"}</span>
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

      {/* BOTTOM NAV */}
      <div className="flex border-t border-[var(--border)] bg-[var(--panel)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.map(([k, icon, label]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k as any)} className="relative flex flex-1 flex-col items-center gap-0.5 py-2" style={{ color: active ? BLUE : "var(--muted)" }}>
              {active && <span className="absolute left-1/4 top-0 h-0.5 w-1/2 rounded-full" style={{ background: BLUE }} />}
              <i className={`fa-solid ${icon} text-[15px]`} />
              <span className="text-[9px] font-semibold">{label}</span>
            </button>
          );
        })}
      </div>

      {/* TRANSFER MODAL */}
      {xferModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-[340px] rounded-2xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
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
      {pin?.pinModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-[320px] rounded-2xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-semibold">{pin.pinHasPin ? "Change PIN" : "Set PIN"}</div>
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
  );
}
