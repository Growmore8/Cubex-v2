"use client";
import { useEffect, useState } from "react";

// Shared deposit / withdraw / KYC panel used by the full wallet page, the client
// desktop terminal modal, and the mobile app. Premium method-list -> QR-detail
// deposit flow and tabbed withdraw. My Requests is shown in the Profile section.
export default function WalletPanel({ initialTab = "deposit", onClose, tabs, accountId }: { initialTab?: "deposit" | "withdraw" | "kyc"; onClose?: () => void; tabs?: ("deposit" | "withdraw" | "kyc")[]; accountId?: string }) {
  const shown: ("deposit" | "withdraw" | "kyc")[] = tabs && tabs.length ? tabs : ["deposit", "withdraw", "kyc"];
  const panelTitle = shown.length === 1
    ? (shown[0] === "kyc" ? "KYC Verification" : shown[0] === "deposit" ? "Deposit Funds" : "Withdraw Funds")
    : "Wallet";
  const [tab, setTab] = useState<"deposit" | "withdraw" | "kyc">(initialTab);
  const [crypto, setCrypto] = useState<any[]>([]);
  const [upi, setUpi] = useState<any[]>([]);
  const [bank, setBank] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [withdrawable, setWithdrawable] = useState<number | null>(null);
  const [pnlOnly, setPnlOnly] = useState(false);
  const [acctName, setAcctName] = useState("");
  const [acctType, setAcctType] = useState(""); // DEMO accounts can't deposit/withdraw/transfer
  const [acctCredit, setAcctCredit] = useState(0); // outstanding credit balance
  // Bank Transfer fields
  const [bankAcctNo, setBankAcctNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  // Deposit: which method is open (null = list view)
  const [depSel, setDepSel] = useState<{ kind: "crypto" | "upi" | "bank" | "credit_clear"; id: string } | null>(null);
  const [dAmount, setDAmount] = useState("");

  // Withdraw: inline destination
  const [wType, setWType] = useState<"CRYPTO" | "BANK" | "UPI">("CRYPTO");
  const [wNetwork, setWNetwork] = useState("TRC20");
  const [wAddress, setWAddress] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [wNote, setWNote] = useState("");

  async function load() {
    const [pm, k, ac] = await Promise.all([
      fetch("/api/client/payment-methods").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/kyc").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/account" + (accountId ? "?accountId=" + encodeURIComponent(accountId) : "")).then((r) => r.json()).catch(() => ({})),
    ]);
    if (pm.ok) { setCrypto(pm.crypto || pm.wallets || []); setUpi(pm.upi || []); setBank(pm.bank || []); setLinks(pm.links || []); }
    if (k.ok) setDocs(k.docs || []);
    if (ac.ok && ac.account) {
      setWithdrawable(typeof ac.withdrawable === "number" ? ac.withdrawable : Math.max(0, Number(ac.account.pnl || 0)));
      setPnlOnly(!!ac.pnlOnly);
      setAcctName(ac.account.name || ac.account.ownerName || "");
      setAcctType(ac.account.type || "");
      setAcctCredit(Number(ac.account.credit || 0));
    }
  }
  useEffect(() => { load(); }, []);

  const fmtUsd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const netColor = (n: string) => /BEP/i.test(n) ? "#f0b90b" : /ERC/i.test(n) ? "#627eea" : /TRC/i.test(n) ? "#ef4444" : "#3b82f6";
  const depWallet = depSel?.kind === "crypto" ? crypto.find((w) => w.id === depSel.id) : null;
  const depUpi = depSel?.kind === "upi" ? upi.find((u) => u.id === depSel.id) : null;
  const depBank = depSel?.kind === "bank" ? bank.find((b) => b.id === depSel.id) : null;
  const copy = (text: string, what: string) => { navigator.clipboard.writeText(text); setMsg(what + " copied"); };

  async function submitCreditClear(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(dAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    const fd = new FormData(e.target as HTMLFormElement);
    fd.set("kind", "CREDIT_CLEAR"); fd.set("amount", String(amt));
    if (accountId) fd.set("accountId", accountId);
    setSending(true);
    let d: any;
    try { d = await fetch("/api/client/payments", { method: "POST", body: fd }).then((r) => r.json()); } catch { setSending(false); setErr("Network error — please try again"); return; }
    setSending(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    (e.target as HTMLFormElement).reset(); setDAmount(""); setDepSel(null);
    setMsg("Credit clearance request submitted — admin will review and clear your credit."); load();
  }

  async function submitDeposit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(dAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    const fd = new FormData(e.target as HTMLFormElement);
    fd.set("kind", "DEPOSIT"); fd.set("amount", String(amt));
    const label = depWallet ? (depWallet.asset + " " + depWallet.network) : depUpi ? ("UPI " + (depUpi.label || "")) : depBank ? "Bank Transfer" : "Crypto";
    fd.set("method", label);
    const dest = depWallet ? (depWallet.network + " " + depWallet.address) : depUpi ? depUpi.address : depBank ? `${depBank.bankName} A/C ${depBank.accountNumber}${depBank.ifsc ? " IFSC " + depBank.ifsc : ""}` : "";
    if (!(fd.get("note") as string)) fd.set("note", "Deposit to " + dest);
    // Attribute the request to the account the client is on (else the server
    // would fall back to their first/primary account — often the demo).
    if (accountId) fd.set("accountId", accountId);
    setSending(true);
    let d: any;
    try { d = await fetch("/api/client/payments", { method: "POST", body: fd }).then((r) => r.json()); } catch { setSending(false); setErr("Network error — please try again"); return; }
    setSending(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    (e.target as HTMLFormElement).reset(); setDAmount(""); setMsg("Deposit request submitted — we will review and credit your account."); load();
  }

  async function submitWithdraw(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(wAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    if (withdrawable != null && amt > withdrawable + 1e-6) { setErr(`Max ${fmtUsd(withdrawable)} (${pnlOnly ? "profit only" : "available balance"})`); return; }
    let methodLabel = ""; let note = "";
    if (wType === "BANK") {
      if (!bankAcctNo.trim() || !bankName.trim()) { setErr("Enter account number and bank name"); return; }
      methodLabel = "Bank Transfer";
      note = `Bank Transfer — ${(acctName || "Account holder").toUpperCase()} · A/C ${bankAcctNo} · ${bankName}${ifsc ? " · IFSC " + ifsc : ""}${wNote ? " — " + wNote : ""}`;
    } else {
      if (!wAddress.trim()) { setErr("Enter your destination address / account"); return; }
      methodLabel = wType === "CRYPTO" ? `Crypto (${wNetwork})` : "UPI";
      note = `Withdraw to ${wType === "CRYPTO" ? wNetwork + " " : ""}${wAddress}${wNote ? " — " + wNote : ""}`;
    }
    const fd = new FormData();
    fd.set("kind", "WITHDRAWAL"); fd.set("amount", String(amt));
    fd.set("method", methodLabel); fd.set("note", note);
    if (accountId) fd.set("accountId", accountId);
    setSending(true);
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); setSending(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setWAmount(""); setWAddress(""); setWNote(""); setBankAcctNo(""); setBankName(""); setIfsc(""); setMsg("Withdrawal request submitted"); load();
  }

  const [kycDocType, setKycDocType] = useState("Passport");

  async function uploadKyc(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg(""); setSending(true);
    let d: any;
    try { d = await fetch("/api/client/kyc", { method: "POST", body: new FormData(e.target as HTMLFormElement) }).then((r) => r.json()); } catch { setSending(false); setErr("Network error — please try again"); return; }
    setSending(false);
    if (!d.ok) { setErr(d.error || "Upload failed"); return; }
    (e.target as HTMLFormElement).reset(); setMsg("Documents submitted for review. We will notify you once verified."); load();
  }

  const input = "ui-input w-full px-3 py-2 text-sm";
  const lbl = "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1";
  const tabBtn = (t: string) => "px-4 py-2 text-sm transition-colors duration-200 " + (tab === t ? "border-b-2 border-blue-600 font-semibold text-blue-600" : "text-[var(--muted)] hover:text-[var(--text)]");
  const netBadge = (n: string) => (<span className="rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: netColor(n) }}>{n}</span>);

  // Premium row used in the deposit method picker
  const methodRow = (key: string, badgeEl: React.ReactNode, title: string, sub: string, onClick: () => void) => (
    <button key={key} onClick={onClick} className="ui-transition flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:bg-[var(--soft)]" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      {badgeEl}
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div>{sub && <div className="truncate text-[10px] text-[var(--muted)]">{sub}</div>}</div>
      <i className="fa-solid fa-chevron-right text-[var(--muted)]" />
    </button>
  );

  // Demo accounts have no real funds — block deposit / withdraw / transfer.
  const isDemo = acctType === "DEMO";
  const demoNotice = (
    <div className="ui-card ui-fade-up p-6 text-center">
      <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(245,158,11,.14)" }}><i className="fa-solid fa-vial text-xl" style={{ color: "#f59e0b" }} /></div>
      <div className="text-sm font-semibold">Not available for demo accounts</div>
      <p className="mt-1 text-xs text-[var(--muted)]">Deposits, withdrawals and transfers are for live accounts only. Switch to a live account to manage funds.</p>
    </div>
  );

  return (<div className="space-y-4 text-[var(--text)]">
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold">{tab === "deposit" ? "↓ Deposit Funds" : tab === "withdraw" ? "↑ Withdraw Funds" : panelTitle}</h1>
      {onClose ? <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button> : <a href="/client" className="text-sm text-blue-600 hover:text-blue-700">&larr; Back to terminal</a>}
    </div>
    {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}{msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">{msg}</p>}
    {shown.length > 1 && (
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {shown.includes("deposit") && <button className={tabBtn("deposit")} onClick={() => { setTab("deposit"); setDepSel(null); }}>Deposit</button>}
        {shown.includes("withdraw") && (
          acctCredit > 0
            ? <button className={tabBtn("withdraw")} onClick={() => setTab("withdraw")} title="Withdrawal locked — clear outstanding credit first" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                <i className="fa-solid fa-lock mr-1 text-[10px]" />Withdraw
              </button>
            : <button className={tabBtn("withdraw")} onClick={() => setTab("withdraw")}>Withdraw</button>
        )}
        {shown.includes("kyc") && <button className={tabBtn("kyc")} onClick={() => setTab("kyc")}>KYC</button>}
      </div>
    )}

    {/* ── DEPOSIT ── */}
    {tab === "deposit" && isDemo && demoNotice}
    {tab === "deposit" && !isDemo && (depSel?.kind === "credit_clear" ? (
      <form onSubmit={submitCreditClear} className="ui-card ui-fade-up space-y-3 p-4">
        <button type="button" onClick={() => setDepSel(null)} className="text-sm font-medium text-blue-600 hover:text-blue-700"><i className="fa-solid fa-chevron-left mr-1" />Back</button>
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(239,83,80,0.4)", background: "rgba(239,83,80,0.07)" }}>
          <div className="text-xs font-semibold" style={{ color: "#ef5350" }}>Outstanding Credit</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: "#ef5350" }}>${acctCredit.toFixed(2)}</div>
          <div className="text-[10px] text-[var(--muted)]">Upload your payment slip to clear this credit.</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className={lbl}>Amount (USD)</div><input className={input} type="number" step="0.01" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder={acctCredit.toFixed(2)} required /></div>
          <div><div className={lbl}>Payment Slip *</div><input className={input} type="file" name="file" accept="image/*,application/pdf" required /></div>
        </div>
        <div><div className={lbl}>Note (optional)</div><textarea name="note" rows={2} className={input} placeholder="Reference, transaction hash…" /></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDepSel(null)} className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button>
          <button disabled={sending} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#ef5350" }}><i className="fa-solid fa-paper-plane mr-1" /> {sending ? "Submitting…" : "Submit Clearance"}</button>
        </div>
      </form>
    ) : depSel ? (
      <form onSubmit={submitDeposit} className="ui-card ui-fade-up space-y-3 p-4">
        <button type="button" onClick={() => setDepSel(null)} className="text-sm font-medium text-blue-600 hover:text-blue-700"><i className="fa-solid fa-chevron-left mr-1" />Back</button>
        {depWallet && (<>
          <div className="flex items-center gap-2">{netBadge(depWallet.network)}<span className="font-semibold">{depWallet.asset}</span></div>
          <div className="flex justify-center"><img alt="QR" width={150} height={150} className="rounded-lg bg-white p-1.5" src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(depWallet.address)}`} /></div>
          <div><div className={lbl}>Wallet Address</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depWallet.address}</code><button type="button" className="ui-btn ui-btn-primary px-2.5 py-1.5" onClick={() => { navigator.clipboard.writeText(depWallet.address); setMsg("Address copied"); }}><i className="fa-solid fa-copy" /></button></div></div>
          <div className="text-[11px] font-medium" style={{ color: "#f0b829" }}>Send only {depWallet.asset} on the {depWallet.network} network.</div>
        </>)}
        {depUpi && (<>
          <div className="font-semibold">{depUpi.label || "UPI"}</div>
          <div><div className={lbl}>UPI ID</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depUpi.address}</code><button type="button" className="ui-btn ui-btn-primary px-2.5 py-1.5" onClick={() => { navigator.clipboard.writeText(depUpi.address); setMsg("UPI id copied"); }}><i className="fa-solid fa-copy" /></button></div></div>
        </>)}
        {depBank && (<>
          <div className="flex items-center gap-2"><span className="rounded bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">BANK</span><span className="font-semibold">{depBank.bankName}</span></div>
          <div><div className={lbl}>Account Number</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depBank.accountNumber}</code><button type="button" className="ui-btn ui-btn-primary px-2.5 py-1.5" onClick={() => copy(depBank.accountNumber, "Account number")}><i className="fa-solid fa-copy" /></button></div></div>
          {depBank.accountName && <div><div className={lbl}>Account Name</div><div className="rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depBank.accountName}</div></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><div className={lbl}>Bank Name</div><div className="rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depBank.bankName}</div></div>
            {depBank.ifsc && <div><div className={lbl}>IFSC Code</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--soft)] px-2 py-1.5 text-xs">{depBank.ifsc}</code><button type="button" className="ui-btn ui-btn-primary px-2.5 py-1.5" onClick={() => copy(depBank.ifsc, "IFSC code")}><i className="fa-solid fa-copy" /></button></div></div>}
          </div>
          <div className="text-[11px] font-medium" style={{ color: "#f0b829" }}>Transfer to the account above, then enter the amount and upload your slip.</div>
        </>)}
        <div className="grid grid-cols-2 gap-3">
          <div><div className={lbl}>Amount (USD)</div><input className={input} type="number" step="0.01" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="0.00" required /></div>
          <div><div className={lbl}>Slip (image or PDF)</div><input className={input} type="file" name="file" accept="image/*,application/pdf" /></div>
        </div>
        <div><div className={lbl}>Note (optional)</div><textarea name="note" rows={2} className={input} placeholder="Reference, transaction hash…" /></div>
        <div className="flex gap-2"><button type="button" onClick={() => setDepSel(null)} className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button><button disabled={sending} className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-60"><i className="fa-solid fa-paper-plane mr-1" /> {sending ? "Submitting…" : "Submit"}</button></div>
      </form>
    ) : (
      <div className="ui-card ui-fade-up space-y-3 p-4">
        {crypto.length === 0 && upi.length === 0 && bank.length === 0 && links.length === 0 ? <p className="text-sm text-[var(--muted)]">No payment methods configured yet. Please contact support.</p> : (<>
          {crypto.length > 0 && (<><div className={lbl}>Crypto (USDT)</div><div className="space-y-2">{crypto.map((w) => methodRow(w.id, netBadge(w.network), w.asset, w.address, () => { setDepSel({ kind: "crypto", id: w.id }); setMsg(""); setErr(""); }))}</div></>)}
          {upi.length > 0 && (<><div className={lbl}>UPI</div><div className="space-y-2">{upi.map((u) => methodRow(u.id, <span className="rounded bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-white">UPI</span>, u.label || "UPI", u.address, () => { setDepSel({ kind: "upi", id: u.id }); setMsg(""); setErr(""); }))}</div></>)}
          {bank.length > 0 && (<><div className={lbl}>Bank Transfer</div><div className="space-y-2">{bank.map((b) => methodRow(b.id, <span className="rounded bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">BANK</span>, b.bankName || "Bank Transfer", "A/C " + b.accountNumber, () => { setDepSel({ kind: "bank", id: b.id }); setMsg(""); setErr(""); }))}</div></>)}
          {links.length > 0 && (<><div className={lbl}>Local Payment</div><div className="space-y-2">{links.map((l) => (<a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="ui-transition flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-[var(--soft)]" style={{ borderColor: "var(--border)", background: "var(--card)" }}><span className="rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">{(l.label || "Pay").split(" ")[0]}</span><div className="flex-1 text-sm font-semibold">{l.label}</div><i className="fa-solid fa-chevron-right text-[var(--muted)]" /></a>))}</div></>)}
          {acctCredit > 0 && (<><div className={lbl} style={{ color: "#ef5350" }}>Clear Outstanding Credit</div><div className="space-y-2">{methodRow("credit_clear", <span className="rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: "#ef5350" }}>CREDIT</span>, "Clear Instant Credit", "$" + acctCredit.toFixed(2) + " outstanding — upload payment slip", () => { setDepSel({ kind: "credit_clear", id: "credit_clear" }); setDAmount(acctCredit.toFixed(2)); setMsg(""); setErr(""); })}</div></>)}
        </>)}
      </div>
    ))}

    {/* ── WITHDRAW ── */}
    {tab === "withdraw" && isDemo && demoNotice}
    {tab === "withdraw" && !isDemo && acctCredit > 0 && (
      <div className="ui-card ui-fade-up space-y-3 p-4">
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "rgba(239,83,80,0.4)", background: "rgba(239,83,80,0.08)", color: "#ef5350" }}>
          <i className="fa-solid fa-lock mr-2" /><b>Withdrawal Disabled</b>
          <p className="mt-1 text-xs">Please clear your outstanding credit of <b>${acctCredit.toFixed(2)}</b> before making a withdrawal. Use the <b>Deposit</b> tab → <b>Clear Instant Credit</b> to settle.</p>
        </div>
      </div>
    )}
    {tab === "withdraw" && !isDemo && acctCredit <= 0 && (<form onSubmit={submitWithdraw} className="ui-card ui-fade-up space-y-3 p-4">
      <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)", background: "var(--soft)" }}>
        <div className={lbl + " text-center"}>{pnlOnly ? "Available Profit To Withdraw" : "Available Balance To Withdraw"}</div>
        <div className="text-xl font-bold" style={{ color: "#22d3ee" }}>{withdrawable != null ? fmtUsd(withdrawable) : "—"}</div>
        <div className="text-[10px] text-[var(--muted)]">{pnlOnly ? "Closed PnL only — deposit cannot be withdrawn" : "Full available balance of this account"}</div>
      </div>
      <div><div className={lbl}>Method</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["CRYPTO", "BANK", "UPI"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setWType(m)} className="rounded-lg border py-1.5 text-xs font-semibold" style={{ borderColor: wType === m ? "transparent" : "var(--border)", background: wType === m ? "#3b82f6" : "var(--card)", color: wType === m ? "#fff" : "var(--text)" }}>{m === "CRYPTO" ? "Crypto" : m === "BANK" ? "Bank Transfer" : "UPI"}</button>
          ))}
        </div>
      </div>
      {wType === "CRYPTO" && (<>
        <div><div className={lbl}>Network</div><select className={input} value={wNetwork} onChange={(e) => setWNetwork(e.target.value)}>{["TRC20", "BEP20", "ERC20"].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <div><div className={lbl}>Your Wallet Address</div><input className={input} value={wAddress} onChange={(e) => setWAddress(e.target.value)} placeholder="Paste your USDT wallet address" required />
          <div className="mt-1 text-[10px] font-medium" style={{ color: "#f0b829" }}>⚠ Wrong network = lost funds. Double-check.</div>
        </div>
      </>)}
      {wType === "UPI" && (<div><div className={lbl}>Your UPI ID</div><input className={input} value={wAddress} onChange={(e) => setWAddress(e.target.value)} placeholder="name@bank" required /></div>)}
      {wType === "BANK" && (<>
        <div><div className={lbl}>Account Name <span className="font-normal normal-case text-[var(--muted)]">(locked — must match your registered name)</span></div>
          <div className="relative">
            <input className={input + " pr-8 uppercase opacity-90 cursor-not-allowed"} value={acctName} readOnly title="The bank account name must match your registered name and cannot be changed." placeholder="Account holder name" />
            <i className="fa-solid fa-lock absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]" />
          </div></div>
        <div><div className={lbl}>Account Number</div><input className={input} value={bankAcctNo} onChange={(e) => setBankAcctNo(e.target.value)} placeholder="Account number" required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className={lbl}>Bank Name</div><input className={input} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" required /></div>
          <div><div className={lbl}>IFSC Code</div><input className={input} value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="IFSC" /></div>
        </div>
        <div className="rounded-lg border px-2.5 py-2 text-[10px] leading-snug" style={{ borderColor: "rgba(240,184,41,0.4)", background: "rgba(240,184,41,0.08)", color: "#d99a1e" }}>
          <i className="fa-solid fa-triangle-exclamation mr-1" />Third-party accounts are not allowed. The bank account name <b>must match your own registered name</b>. Withdrawals to a mismatched name will be rejected.
        </div>
      </>)}
      <div className="grid grid-cols-2 gap-3">
        <div><div className={lbl}>Amount (USD)</div><input className={input} type="number" step="0.01" value={wAmount} onChange={(e) => setWAmount(e.target.value)} placeholder="0.00" required /></div>
        <div className="flex items-end"><button type="button" onClick={() => withdrawable != null && setWAmount(String(withdrawable))} className="w-full rounded-lg border py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Use max: {withdrawable != null ? fmtUsd(withdrawable) : "$0.00"}</button></div>
      </div>
      <div><div className={lbl}>Note (optional)</div><textarea rows={2} className={input} value={wNote} onChange={(e) => setWNote(e.target.value)} placeholder="Anything you want admin to know" /></div>
      <div className="flex gap-2"><button type="button" onClick={() => onClose?.()} className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button><button disabled={sending} className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white disabled:opacity-60"><i className="fa-solid fa-paper-plane mr-1" /> {sending ? "Submitting…" : "Submit"}</button></div>
    </form>)}

    {/* ── KYC ── */}
    {tab === "kyc" && (() => {
      const latest = docs[0]; const st = latest?.status;
      const canUpload = !latest || st === "REJECTED";
      return (<div className="ui-card ui-fade-up space-y-3 p-4">
        {st === "APPROVED" && <div className="flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700"><i className="fa-solid fa-circle-check" /> Your identity is verified.</div>}
        {st === "PENDING" && <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700"><i className="fa-solid fa-clock" /> Your documents are under review.</div>}
        {st === "REJECTED" && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><i className="fa-solid fa-circle-xmark mr-1" /> Your KYC was rejected{latest?.note ? ": " + latest.note : ""}. Please upload again.</div>}
        {canUpload && (<form onSubmit={uploadKyc} className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted)]">Document Type <span className="text-red-500">*</span></div>
            <select className={input} value={kycDocType} onChange={(e) => setKycDocType(e.target.value)}>
              {["Passport", "National ID", "Driver's License", "Residence Permit"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="mb-1 text-xs font-medium text-[var(--muted)]">ID Front <span className="text-red-500">*</span></div><input className={input} type="file" name="file" accept="image/*,application/pdf" required /></div>
            <div><div className="mb-1 text-xs font-medium text-[var(--muted)]">Address Proof <span className="text-red-500">*</span></div><input className={input} type="file" name="back" accept="image/*,application/pdf" required /></div>
          </div>
          <p className="text-xs text-[var(--muted)]">Upload a clear photo/scan of your ID (front) and a recent utility bill or bank statement as address proof.</p>
          <button className="ui-btn ui-btn-primary px-4 py-2 text-sm" disabled={sending}>{sending ? "Uploading…" : "Submit for review"}</button>
        </form>)}
      </div>);
    })()}

  </div>);
}
