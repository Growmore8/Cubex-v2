"use client";
import { useEffect, useState } from "react";

// Shared deposit / withdraw / KYC panel used by the full wallet page, the client
// desktop terminal modal, and the mobile app. Premium method-list -> QR-detail
// deposit flow, tabbed withdraw, and a separate Requests section.
export default function WalletPanel({ initialTab = "deposit", onClose, tabs }: { initialTab?: "deposit" | "withdraw" | "kyc"; onClose?: () => void; tabs?: ("deposit" | "withdraw" | "kyc")[] }) {
  const shown: ("deposit" | "withdraw" | "kyc")[] = tabs && tabs.length ? tabs : ["deposit", "withdraw", "kyc"];
  const panelTitle = shown.length === 1
    ? (shown[0] === "kyc" ? "KYC Verification" : shown[0] === "deposit" ? "Deposit Funds" : "Withdraw Funds")
    : "Wallet";
  const [tab, setTab] = useState<"deposit" | "withdraw" | "kyc">(initialTab);
  const [crypto, setCrypto] = useState<any[]>([]);
  const [upi, setUpi] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [reqs, setReqs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [withdrawable, setWithdrawable] = useState<number | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  // Deposit: which method is open (null = list view)
  const [depSel, setDepSel] = useState<{ kind: "crypto" | "upi"; id: string } | null>(null);
  const [dAmount, setDAmount] = useState("");

  // Withdraw: inline destination
  const [wType, setWType] = useState<"CRYPTO" | "BANK" | "UPI">("CRYPTO");
  const [wNetwork, setWNetwork] = useState("TRC20");
  const [wAddress, setWAddress] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [wNote, setWNote] = useState("");

  async function load() {
    const [pm, p, k, ac] = await Promise.all([
      fetch("/api/client/payment-methods").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/payments").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/kyc").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/account").then((r) => r.json()).catch(() => ({})),
    ]);
    if (pm.ok) { setCrypto(pm.crypto || pm.wallets || []); setUpi(pm.upi || []); setLinks(pm.links || []); }
    if (p.ok) setReqs(p.requests || []);
    if (k.ok) setDocs(k.docs || []);
    if (ac.ok && ac.account) setWithdrawable(typeof ac.withdrawable === "number" ? ac.withdrawable : Math.max(0, Number(ac.account.pnl || 0)));
  }
  useEffect(() => { load(); }, []);

  const fmtUsd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const netColor = (n: string) => /BEP/i.test(n) ? "#f0b90b" : /ERC/i.test(n) ? "#627eea" : /TRC/i.test(n) ? "#ef4444" : "#3b82f6";
  const depWallet = depSel?.kind === "crypto" ? crypto.find((w) => w.id === depSel.id) : null;
  const depUpi = depSel?.kind === "upi" ? upi.find((u) => u.id === depSel.id) : null;

  async function submitDeposit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(dAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    const fd = new FormData(e.target as HTMLFormElement);
    fd.set("kind", "DEPOSIT"); fd.set("amount", String(amt));
    const label = depWallet ? (depWallet.asset + " " + depWallet.network) : depUpi ? ("UPI " + (depUpi.label || "")) : "Crypto";
    fd.set("method", label);
    const dest = depWallet ? (depWallet.network + " " + depWallet.address) : depUpi ? depUpi.address : "";
    if (!(fd.get("note") as string)) fd.set("note", "Deposit to " + dest);
    setSending(true);
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); setSending(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    (e.target as HTMLFormElement).reset(); setDAmount(""); setDepSel(null); setMsg("Deposit request submitted"); load();
  }

  async function submitWithdraw(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(wAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    if (!wAddress.trim()) { setErr("Enter your destination address / account"); return; }
    const methodLabel = wType === "CRYPTO" ? `Crypto (${wNetwork})` : wType === "UPI" ? "UPI" : "Bank Transfer";
    const fd = new FormData();
    fd.set("kind", "WITHDRAWAL"); fd.set("amount", String(amt));
    fd.set("method", methodLabel);
    fd.set("note", `Withdraw to ${wType === "CRYPTO" ? wNetwork + " " : ""}${wAddress}${wNote ? " — " + wNote : ""}`);
    setSending(true);
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); setSending(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setWAmount(""); setWAddress(""); setWNote(""); setMsg("Withdrawal request submitted"); load();
  }

  async function uploadKyc(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const fd = new FormData(e.target as HTMLFormElement); fd.set("docType", "Identity & Address");
    const r = await fetch("/api/client/kyc", { method: "POST", body: fd });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Upload failed"); return; }
    (e.target as HTMLFormElement).reset(); setMsg("Submitted for review"); load();
  }

  const input = "ui-input w-full px-3 py-2 text-sm";
  const lbl = "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1";
  const badge = (s: string) => "rounded-full px-2 py-0.5 text-xs font-medium " + (s === "APPROVED" ? "bg-green-100 text-green-700" : s === "REJECTED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700");
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

  return (<div className="space-y-4 text-[var(--text)]">
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold">{tab === "deposit" ? "↓ Deposit Funds" : tab === "withdraw" ? "↑ Withdraw Funds" : panelTitle}</h1>
      {onClose ? <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]"><i className="fa-solid fa-xmark" /></button> : <a href="/client" className="text-sm text-blue-600 hover:text-blue-700">&larr; Back to terminal</a>}
    </div>
    {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}{msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">{msg}</p>}
    {shown.length > 1 && (
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {shown.includes("deposit") && <button className={tabBtn("deposit")} onClick={() => { setTab("deposit"); setDepSel(null); }}>Deposit</button>}
        {shown.includes("withdraw") && <button className={tabBtn("withdraw")} onClick={() => setTab("withdraw")}>Withdraw</button>}
        {shown.includes("kyc") && <button className={tabBtn("kyc")} onClick={() => setTab("kyc")}>KYC</button>}
      </div>
    )}

    {/* ── DEPOSIT ── */}
    {tab === "deposit" && (depSel ? (
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
        <div className="grid grid-cols-2 gap-3">
          <div><div className={lbl}>Amount (USD)</div><input className={input} type="number" step="0.01" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="0.00" required /></div>
          <div><div className={lbl}>Slip (image or PDF)</div><input className={input} type="file" name="file" accept="image/*,application/pdf" /></div>
        </div>
        <div><div className={lbl}>Note (optional)</div><textarea name="note" rows={2} className={input} placeholder="Reference, transaction hash…" /></div>
        <div className="flex gap-2"><button type="button" onClick={() => setDepSel(null)} className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>Cancel</button><button disabled={sending} className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-60"><i className="fa-solid fa-paper-plane mr-1" /> {sending ? "Submitting…" : "Submit"}</button></div>
      </form>
    ) : (
      <div className="ui-card ui-fade-up space-y-3 p-4">
        {crypto.length === 0 && upi.length === 0 && links.length === 0 ? <p className="text-sm text-[var(--muted)]">No payment methods configured yet. Please contact support.</p> : (<>
          {crypto.length > 0 && (<><div className={lbl}>Crypto (USDT)</div><div className="space-y-2">{crypto.map((w) => methodRow(w.id, netBadge(w.network), w.asset, w.address, () => { setDepSel({ kind: "crypto", id: w.id }); setMsg(""); setErr(""); }))}</div></>)}
          {upi.length > 0 && (<><div className={lbl}>UPI</div><div className="space-y-2">{upi.map((u) => methodRow(u.id, <span className="rounded bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-white">UPI</span>, u.label || "UPI", u.address, () => { setDepSel({ kind: "upi", id: u.id }); setMsg(""); setErr(""); }))}</div></>)}
          {links.length > 0 && (<><div className={lbl}>Local Payment</div><div className="space-y-2">{links.map((l) => (<a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="ui-transition flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-[var(--soft)]" style={{ borderColor: "var(--border)", background: "var(--card)" }}><span className="rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">{(l.label || "Pay").split(" ")[0]}</span><div className="flex-1 text-sm font-semibold">{l.label}</div><i className="fa-solid fa-chevron-right text-[var(--muted)]" /></a>))}</div></>)}
        </>)}
      </div>
    ))}

    {/* ── WITHDRAW ── */}
    {tab === "withdraw" && (<form onSubmit={submitWithdraw} className="ui-card ui-fade-up space-y-3 p-4">
      <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)", background: "var(--soft)" }}>
        <div className={lbl + " text-center"}>Available Profit To Withdraw</div>
        <div className="text-xl font-bold" style={{ color: "#22d3ee" }}>{withdrawable != null ? fmtUsd(withdrawable) : "—"}</div>
        <div className="text-[10px] text-[var(--muted)]">Closed PnL only — deposit cannot be withdrawn</div>
      </div>
      <div><div className={lbl}>Method</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["CRYPTO", "BANK", "UPI"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setWType(m)} className="rounded-lg border py-1.5 text-xs font-semibold" style={{ borderColor: wType === m ? "transparent" : "var(--border)", background: wType === m ? "#3b82f6" : "var(--card)", color: wType === m ? "#fff" : "var(--text)" }}>{m === "CRYPTO" ? "Crypto" : m === "BANK" ? "Bank Transfer" : "UPI"}</button>
          ))}
        </div>
      </div>
      {wType === "CRYPTO" && (<div><div className={lbl}>Network</div><select className={input} value={wNetwork} onChange={(e) => setWNetwork(e.target.value)}>{["TRC20", "BEP20", "ERC20"].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>)}
      <div><div className={lbl}>{wType === "CRYPTO" ? "Your Wallet Address" : wType === "UPI" ? "Your UPI ID" : "Bank Account / IBAN"}</div><input className={input} value={wAddress} onChange={(e) => setWAddress(e.target.value)} placeholder={wType === "CRYPTO" ? "Paste your USDT wallet address" : wType === "UPI" ? "name@bank" : "Account number / IBAN"} required />
        {wType === "CRYPTO" && <div className="mt-1 text-[10px] font-medium" style={{ color: "#f0b829" }}>⚠ Wrong network = lost funds. Double-check.</div>}
      </div>
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
        {canUpload && (<form onSubmit={uploadKyc} className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div><div className="mb-1 text-xs font-medium text-[var(--muted)]">Identity Document <span className="text-red-500">*</span></div><input className={input} type="file" name="file" accept="image/*,application/pdf" required /></div>
            <div><div className="mb-1 text-xs font-medium text-[var(--muted)]">Address Proof <span className="text-red-500">*</span></div><input className={input} type="file" name="back" accept="image/*,application/pdf" required /></div>
          </div>
          <p className="text-xs text-[var(--muted)]">Upload a clear photo/scan of your identity document and a proof of address.</p>
          <button className="ui-btn ui-btn-primary px-4 py-2 text-sm">Submit for review</button>
        </form>)}
      </div>);
    })()}

    {/* ── REQUESTS (separate section) ── */}
    {tab !== "kyc" && (
      <div className="ui-card ui-fade-up p-4">
        <div className="mb-2 flex items-center justify-between"><div className="text-sm font-semibold">My Requests</div><span className="text-[10px] text-[var(--muted)]">{reqs.length} total</span></div>
        <div className="space-y-1.5">{reqs.length === 0 ? <div className="py-2 text-center text-sm text-[var(--muted)]">No requests yet.</div> : reqs.map((p) => (
          <div key={p.id} className="ui-row flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2"><i className={"fa-solid " + (p.kind === "DEPOSIT" ? "fa-arrow-down text-emerald-500" : "fa-arrow-up text-red-500")} /><span className="font-medium">{p.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"} {Number(p.amount).toFixed(2)}</span><span className="text-[10px] text-[var(--muted)]">{p.method}</span></div>
            <span className={badge(p.status)}>{p.status}</span>
          </div>))}</div>
      </div>
    )}
  </div>);
}
