"use client";
import { useEffect, useState } from "react";

export default function WalletPage() {
  const [tab, setTab] = useState<"deposit" | "withdraw" | "kyc">("deposit");
  const [wallets, setWallets] = useState<any[]>([]);
  const [xynder, setXynder] = useState<any>({ url: "", active: false });
  const [reqs, setReqs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [selWallet, setSelWallet] = useState<string>("");
  const [dAmount, setDAmount] = useState("");
  const [wAmount, setWAmount] = useState(""); const [wDest, setWDest] = useState(""); const [wNet, setWNet] = useState("");
  const [docType, setDocType] = useState("national_id");

  async function load() {
    const [pm, p, k] = await Promise.all([
      fetch("/api/client/payment-methods").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/payments").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/kyc").then((r) => r.json()).catch(() => ({})),
    ]);
    if (pm.ok) { setWallets(pm.wallets || []); setXynder(pm.xynder || { url: "", active: false }); setSelWallet((prev) => prev || (pm.wallets && pm.wallets[0] ? pm.wallets[0].id : "")); }
    if (p.ok) setReqs(p.requests || []);
    if (k.ok) setDocs(k.docs || []);
  }
  useEffect(() => { load(); }, []);

  const wallet = wallets.find((w) => w.id === selWallet);

  async function submitDeposit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(dAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    const fd = new FormData(e.target as HTMLFormElement);
    fd.set("kind", "DEPOSIT"); fd.set("amount", String(amt));
    fd.set("method", wallet ? (wallet.asset + " " + wallet.network) : "Crypto");
    fd.set("note", wallet ? ("Deposit to " + wallet.network + " " + wallet.address) : "Crypto deposit");
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    (e.target as HTMLFormElement).reset(); setDAmount(""); setMsg("Deposit request submitted"); load();
  }
  async function submitWithdraw(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const amt = Number(wAmount); if (!(amt > 0)) { setErr("Enter an amount"); return; }
    if (!wDest) { setErr("Enter destination address"); return; }
    const fd = new FormData();
    fd.set("kind", "WITHDRAWAL"); fd.set("amount", String(amt));
    fd.set("method", wNet || "Crypto"); fd.set("note", "Withdraw to " + wDest);
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setWAmount(""); setWDest(""); setMsg("Withdrawal request submitted"); load();
  }
  async function uploadKyc(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const fd = new FormData(e.target as HTMLFormElement); fd.set("docType", docType);
    const r = await fetch("/api/client/kyc", { method: "POST", body: fd });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Upload failed"); return; }
    (e.target as HTMLFormElement).reset(); setMsg("Document uploaded"); load();
  }

  const input = "rounded-md border px-3 py-2 text-sm";
  const badge = (s: string) => "rounded px-2 py-0.5 text-xs " + (s === "APPROVED" ? "bg-green-100 text-green-700" : s === "REJECTED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700");
  const tabBtn = (t: string) => "px-4 py-2 text-sm " + (tab === t ? "border-b-2 border-blue-600 font-medium text-blue-600" : "text-gray-500");

  return (<div className="mx-auto max-w-3xl space-y-4 p-4">
    <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Wallet</h1><a href="/client" className="text-sm text-blue-600">&larr; Back to terminal</a></div>
    {err && <p className="text-sm text-red-600">{err}</p>}{msg && <p className="text-sm text-green-600">{msg}</p>}
    <div className="flex gap-1 border-b">
      <button className={tabBtn("deposit")} onClick={() => setTab("deposit")}>Deposit</button>
      <button className={tabBtn("withdraw")} onClick={() => setTab("withdraw")}>Withdraw</button>
      <button className={tabBtn("kyc")} onClick={() => setTab("kyc")}>KYC</button>
    </div>

    {tab === "deposit" && (<div className="space-y-3 rounded-lg border bg-white p-4">
      {wallets.length === 0 ? <p className="text-sm text-gray-500">No crypto wallets configured yet. Please contact support.</p> : (<>
        <div className="text-xs text-gray-500">Choose network</div>
        <div className="flex flex-wrap gap-2">{wallets.map((w) => (<button key={w.id} onClick={() => setSelWallet(w.id)} className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: selWallet === w.id ? "#2563eb" : "#e2e8f0", background: selWallet === w.id ? "#eff6ff" : "#fff" }}>{w.asset} · {w.network}</button>))}</div>
        {wallet && (<div className="rounded-md border bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Send {wallet.asset} ({wallet.network}) to this address:</div>
          <div className="mt-1 flex items-center gap-2"><code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{wallet.address}</code><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => { navigator.clipboard.writeText(wallet.address); setMsg("Address copied"); }}>Copy</button></div>
        </div>)}
        <form onSubmit={submitDeposit} className="space-y-2">
          <div><div className="text-xs text-gray-500">Amount (USD)</div><input className={input + " w-full"} type="number" step="0.01" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="0.00" required /></div>
          <div><div className="text-xs text-gray-500">Payment slip / screenshot (optional)</div><input className={input + " w-full"} type="file" name="file" accept="image/*,application/pdf" /></div>
          <button className="rounded-md bg-green-600 px-4 py-2 text-sm text-white">Submit deposit request</button>
        </form>
      </>)}
      {xynder.active && (<div className="rounded-md border p-3"><div className="text-sm font-medium">Local Payment</div><p className="mb-2 text-xs text-gray-500">Pay locally via our payment partner.</p><a href={xynder.url} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Open Local Payment</a></div>)}
    </div>)}

    {tab === "withdraw" && (<div className="space-y-2 rounded-lg border bg-white p-4">
      <form onSubmit={submitWithdraw} className="space-y-2">
        <div><div className="text-xs text-gray-500">Amount (USD)</div><input className={input + " w-full"} type="number" step="0.01" value={wAmount} onChange={(e) => setWAmount(e.target.value)} placeholder="0.00" required /></div>
        <div><div className="text-xs text-gray-500">Network</div><select className={input + " w-full"} value={wNet} onChange={(e) => setWNet(e.target.value)}><option value="">Select</option>{["BEP20", "ERC20", "TRC20"].map((n) => <option key={n}>{n}</option>)}</select></div>
        <div><div className="text-xs text-gray-500">Destination wallet address</div><input className={input + " w-full"} value={wDest} onChange={(e) => setWDest(e.target.value)} placeholder="Your USDT address" required /></div>
        <button className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white">Submit withdrawal request</button>
      </form>
    </div>)}

    {tab === "kyc" && (<div className="space-y-3 rounded-lg border bg-white p-4">
      <form onSubmit={uploadKyc} className="flex flex-wrap items-center gap-2">
        <select className={input} value={docType} onChange={(e) => setDocType(e.target.value)}><option value="national_id">National ID</option><option value="passport">Passport</option><option value="proof_of_address">Proof of Address</option></select>
        <input className={input} type="file" name="file" accept="image/*,application/pdf" required />
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Upload</button>
      </form>
      <div className="space-y-2">{docs.map((d) => (<div key={d.id} className="flex items-center justify-between text-sm"><span>{d.docType}</span><span className={badge(d.status)}>{d.status}</span></div>))}{docs.length === 0 && <div className="text-sm text-gray-400">No documents uploaded.</div>}</div>
    </div>)}

    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 text-sm font-semibold">Recent requests</div>
      <div className="space-y-1">{reqs.map((p) => (<div key={p.id} className="flex items-center justify-between text-sm"><span>{p.kind} {Number(p.amount).toFixed(2)} <span className="text-xs text-gray-400">({p.method})</span></span><span className={badge(p.status)}>{p.status}</span></div>))}{reqs.length === 0 && <div className="text-sm text-gray-400">No requests yet.</div>}</div>
    </div>
  </div>);
}