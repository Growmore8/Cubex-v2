"use client";
import { useEffect, useState } from "react";

// Shared deposit / withdraw / KYC panel used by the full wallet page and the
// in-app wallet modal on the client desktop terminal.
export default function WalletPanel({ initialTab = "deposit", onClose }: { initialTab?: "deposit" | "withdraw" | "kyc"; onClose?: () => void }) {
  const [tab, setTab] = useState<"deposit" | "withdraw" | "kyc">(initialTab);
  const [crypto, setCrypto] = useState<any[]>([]);
  const [upi, setUpi] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [reqs, setReqs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [selWallet, setSelWallet] = useState<string>("");
  const [dAmount, setDAmount] = useState("");
  const [wAmount, setWAmount] = useState(""); const [selMethod, setSelMethod] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [newM, setNewM] = useState<any>({ type: "CRYPTO", network: "BEP20", asset: "USDT", address: "", label: "" });
  const [docType, setDocType] = useState("national_id");

  async function load() {
    const [pm, p, k, wm] = await Promise.all([
      fetch("/api/client/payment-methods").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/payments").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/kyc").then((r) => r.json()).catch(() => ({})),
      fetch("/api/client/withdrawal-methods").then((r) => r.json()).catch(() => ({})),
    ]);
    if (pm.ok) {
      setCrypto(pm.crypto || pm.wallets || []); setUpi(pm.upi || []); setLinks(pm.links || []);
      setSelWallet((prev) => prev || ((pm.crypto && pm.crypto[0]) ? pm.crypto[0].id : ""));
    }
    if (p.ok) setReqs(p.requests || []);
    if (k.ok) setDocs(k.docs || []);
    if (wm.ok) { setMethods(wm.methods || []); setSelMethod((prev) => prev || (wm.methods && wm.methods[0] ? wm.methods[0].id : "")); }
  }
  useEffect(() => { load(); }, []);

  const wallet = crypto.find((w) => w.id === selWallet);
  const method = methods.find((m) => m.id === selMethod);

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
    if (!method) { setErr("Add and select a withdrawal method"); return; }
    const dest = method.type === "CRYPTO" ? (method.network + " " + method.address) : method.address;
    const fd = new FormData();
    fd.set("kind", "WITHDRAWAL"); fd.set("amount", String(amt));
    fd.set("method", method.label + (method.network ? " (" + method.network + ")" : ""));
    fd.set("note", "Withdraw to " + dest);
    const r = await fetch("/api/client/payments", { method: "POST", body: fd });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    setWAmount(""); setMsg("Withdrawal request submitted"); load();
  }
  async function methodAction(body: any) {
    setErr("");
    const r = await fetch("/api/client/withdrawal-methods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; }
    if (body.action !== "delete" && body.action !== "default") { setAddOpen(false); setNewM({ type: "CRYPTO", network: "BEP20", asset: "USDT", address: "", label: "" }); }
    load();
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

  return (<div className="space-y-4 text-gray-800">
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-bold">Wallet</h1>
      {onClose ? <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700"><i className="fa-solid fa-xmark" /> Close</button> : <a href="/client" className="text-sm text-blue-600">&larr; Back to terminal</a>}
    </div>
    {err && <p className="text-sm text-red-600">{err}</p>}{msg && <p className="text-sm text-green-600">{msg}</p>}
    <div className="flex gap-1 border-b">
      <button className={tabBtn("deposit")} onClick={() => setTab("deposit")}>Deposit</button>
      <button className={tabBtn("withdraw")} onClick={() => setTab("withdraw")}>Withdraw</button>
      <button className={tabBtn("kyc")} onClick={() => setTab("kyc")}>KYC</button>
    </div>

    {tab === "deposit" && (<div className="space-y-3 rounded-lg border bg-white p-4">
      {crypto.length === 0 && upi.length === 0 && links.length === 0 ? <p className="text-sm text-gray-500">No payment methods configured yet. Please contact support.</p> : (<>
        {crypto.length > 0 && (<>
          <div className="text-xs text-gray-500">Choose crypto network</div>
          <div className="flex flex-wrap gap-2">{crypto.map((w) => (<button key={w.id} onClick={() => setSelWallet(w.id)} className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: selWallet === w.id ? "#2563eb" : "#e2e8f0", background: selWallet === w.id ? "#eff6ff" : "#fff" }}>{w.asset} · {w.network}</button>))}</div>
          {wallet && (<div className="rounded-md border bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Send {wallet.asset} ({wallet.network}) to this address:</div>
            <div className="mt-1 flex items-center gap-2"><code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{wallet.address}</code><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => { navigator.clipboard.writeText(wallet.address); setMsg("Address copied"); }}>Copy</button></div>
          </div>)}
        </>)}
        {upi.length > 0 && (<div className="rounded-md border p-3">
          <div className="mb-1 text-sm font-medium">UPI</div>
          <div className="space-y-1">{upi.map((u) => (<div key={u.id} className="flex items-center gap-2 text-xs"><span className="rounded bg-cyan-50 px-2 py-0.5 text-cyan-700">{u.label}</span><code className="flex-1 break-all rounded bg-gray-50 px-2 py-1">{u.address}</code><button type="button" className="rounded border px-2 py-0.5" onClick={() => { navigator.clipboard.writeText(u.address); setMsg("UPI id copied"); }}>Copy</button></div>))}</div>
        </div>)}
        <form onSubmit={submitDeposit} className="space-y-2">
          <div><div className="text-xs text-gray-500">Amount (USD)</div><input className={input + " w-full"} type="number" step="0.01" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="0.00" required /></div>
          <div><div className="text-xs text-gray-500">Payment slip / screenshot (optional)</div><input className={input + " w-full"} type="file" name="file" accept="image/*,application/pdf" /></div>
          <button className="rounded-md bg-green-600 px-4 py-2 text-sm text-white">Submit deposit request</button>
        </form>
        {links.map((l) => (<div key={l.id} className="rounded-md border p-3"><div className="text-sm font-medium">{l.label}</div><p className="mb-2 text-xs text-gray-500">Pay via our payment partner.</p><a href={l.url} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Open {l.label}</a></div>))}
      </>)}
    </div>)}

    {tab === "withdraw" && (<div className="space-y-3 rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Saved withdrawal methods</div>
        <button className="rounded border px-2 py-1 text-xs" onClick={() => setAddOpen(true)}>+ Add method</button>
      </div>
      {methods.length === 0 ? <p className="text-sm text-gray-500">No saved methods. Add one to withdraw.</p> : (
        <div className="space-y-2">{methods.map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded border p-2" style={{ borderColor: selMethod === m.id ? "#2563eb" : "#eef2f7", background: selMethod === m.id ? "#eff6ff" : "#fff" }}>
            <input type="radio" name="wm" checked={selMethod === m.id} onChange={() => setSelMethod(m.id)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{m.label} {m.isDefault && <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">Default</span>}</div>
              <div className="break-all text-xs text-gray-400">{m.type === "CRYPTO" ? (m.network + " · ") : (m.type + " · ")}{m.address}</div>
            </div>
            {!m.isDefault && <button className="text-xs text-blue-600" onClick={() => methodAction({ action: "default", id: m.id })}>Set default</button>}
            <button title="Delete" className="rounded px-2 py-1 text-red-600" onClick={() => methodAction({ action: "delete", id: m.id })}><i className="fa-solid fa-trash"></i></button>
          </div>))}</div>
      )}
      <form onSubmit={submitWithdraw} className="space-y-2 border-t pt-3">
        <div><div className="text-xs text-gray-500">Amount (USD)</div><input className={input + " w-full"} type="number" step="0.01" value={wAmount} onChange={(e) => setWAmount(e.target.value)} placeholder="0.00" required /></div>
        <p className="text-xs text-gray-400">Only profit (PNL) balance may be withdrawable depending on your account settings.</p>
        <button className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white" disabled={!method}>Submit withdrawal request</button>
      </form>
    </div>)}

    {tab === "kyc" && (<div className="space-y-3 rounded-lg border bg-white p-4">
      <form onSubmit={uploadKyc} className="space-y-2">
        <select className={input + " w-full"} value={docType} onChange={(e) => setDocType(e.target.value)}><option value="national_id">National ID</option><option value="passport">Passport</option><option value="proof_of_address">Proof of Address</option></select>
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-xs text-gray-500">Front side <span className="text-red-500">*</span></div><input className={input + " w-full"} type="file" name="file" accept="image/*,application/pdf" required /></div>
          <div><div className="text-xs text-gray-500">Back side <span className="text-red-500">*</span></div><input className={input + " w-full"} type="file" name="back" accept="image/*,application/pdf" required /></div>
        </div>
        <p className="text-xs text-gray-400">Both front and back are required — documents without a back side cannot be verified.</p>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white">Upload</button>
      </form>
      <div className="space-y-2">{docs.map((d) => (<div key={d.id} className="flex items-center justify-between text-sm"><span>{d.docType}</span><span className={badge(d.status)}>{d.status}</span></div>))}{docs.length === 0 && <div className="text-sm text-gray-400">No documents uploaded.</div>}</div>
    </div>)}

    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 text-sm font-semibold">Recent requests</div>
      <div className="space-y-1">{reqs.map((p) => (<div key={p.id} className="flex items-center justify-between text-sm"><span>{p.kind} {Number(p.amount).toFixed(2)} <span className="text-xs text-gray-400">({p.method})</span></span><span className={badge(p.status)}>{p.status}</span></div>))}{reqs.length === 0 && <div className="text-sm text-gray-400">No requests yet.</div>}</div>
    </div>

    {addOpen && (<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-6" onClick={() => setAddOpen(false)}>
      <div className="w-[400px] rounded-lg bg-white p-4 text-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-semibold">Add withdrawal method</div>
        <div className="space-y-2">
          <select className={input + " w-full"} value={newM.type} onChange={(e) => setNewM({ ...newM, type: e.target.value })}>
            <option value="CRYPTO">Crypto</option><option value="UPI">UPI</option><option value="BANK">Bank</option>
          </select>
          <input className={input + " w-full"} placeholder="Name (e.g. My Binance USDT)" value={newM.label} onChange={(e) => setNewM({ ...newM, label: e.target.value })} />
          {newM.type === "CRYPTO" && (<>
            <select className={input + " w-full"} value={newM.network} onChange={(e) => setNewM({ ...newM, network: e.target.value })}>{["BEP20", "ERC20", "TRC20"].map((n) => <option key={n}>{n}</option>)}</select>
            <input className={input + " w-full"} placeholder="Asset (USDT)" value={newM.asset} onChange={(e) => setNewM({ ...newM, asset: e.target.value })} />
            <input className={input + " w-full"} placeholder="Wallet address" value={newM.address} onChange={(e) => setNewM({ ...newM, address: e.target.value })} />
          </>)}
          {newM.type === "UPI" && <input className={input + " w-full"} placeholder="UPI id (name@bank)" value={newM.address} onChange={(e) => setNewM({ ...newM, address: e.target.value })} />}
          {newM.type === "BANK" && <input className={input + " w-full"} placeholder="Account number / IBAN" value={newM.address} onChange={(e) => setNewM({ ...newM, address: e.target.value })} />}
        </div>
        <div className="mt-3 flex justify-end gap-2"><button className="rounded border px-3 py-1.5 text-sm" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={() => methodAction({ action: "add", ...newM })}>Save method</button></div>
      </div>
    </div>)}
  </div>);
}
