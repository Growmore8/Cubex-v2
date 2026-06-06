"use client";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";

export default function SAKyc() {
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState("All"); const [q, setQ] = useState(""); const [img, setImg] = useState<string | null>(null); const [err, setErr] = useState("");
  const { confirm, prompt, node } = useDialog();
  async function load() { try { const d = await fetch("/api/superadmin/kyc").then((r) => r.json()); if (d.ok) setItems(d.items); } catch (e) {} }
  useEffect(() => { load(); }, []);
  async function act(id: string, action: string, note?: string) { setErr(""); const r = await fetch("/api/superadmin/kyc/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }); const d = await r.json(); if (!d.ok) { setErr(d.error || "Failed"); return; } load(); }
  async function doReject(id: string) { const reason = await prompt({ title: "Reject KYC", message: "Reason for rejection (shown to the client)", placeholder: "e.g. document blurry / expired", confirmLabel: "Reject" }); if (reason) act(id, "reject", reason); }
  async function doReverse(id: string) { if (await confirm({ title: "Reverse decision", message: "Send this back to PENDING? The client will be asked to upload again.", confirmLabel: "Reverse" })) act(id, "reverse"); }
  const filtered = items.filter((i: any) => (tab === "All" || i.status === tab) && (!q || (i.accountId + i.name + i.email).toLowerCase().includes(q.toLowerCase())));
  const inp = "ui-input rounded-md border px-2 py-1.5 text-sm";
  return (<div className="space-y-4 ui-fade-up">
    {node}
    <div><h1 className="text-2xl font-bold">KYC</h1><p className="text-sm text-gray-500">All KYC submissions across every outsource</p></div>
    {err && <div className="text-sm text-red-600">{err}</div>}
    <div className="ui-card bg-white p-4" style={{ borderColor: "#e2e8f0" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {["All", "PENDING", "APPROVED", "REJECTED"].map((t) => <button key={t} onClick={() => setTab(t)} className="rounded-full px-3 py-1 text-xs transition-colors duration-200" style={tab === t ? { background: "var(--accent2)", color: "#fff" } : { background: "var(--bg2)", color: "var(--text2)", border: "1px solid var(--border)" }}>{t}</button>)}
        <input className={inp + " min-w-[180px] flex-1"} placeholder="Search name / email / account" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500"><tr><th className="px-2 py-1 font-normal">Date</th><th className="px-2 py-1 font-normal">Account</th><th className="px-2 py-1 font-normal">Name</th><th className="px-2 py-1 font-normal">Email</th><th className="px-2 py-1 font-normal">Doc</th><th className="px-2 py-1 font-normal">Image</th><th className="px-2 py-1 font-normal">Status</th><th className="px-2 py-1 font-normal text-right">Action</th></tr></thead>
          <tbody>
            {filtered.map((i: any) => (<tr key={i.id} className="ui-row border-t" style={{ borderColor: "#eef2f7" }}>
              <td className="px-2 py-2 text-xs text-gray-500">{new Date(i.date).toLocaleString()}</td>
              <td className="px-2 py-2 font-medium">{i.accountId}</td>
              <td className="px-2 py-2">{i.name}</td>
              <td className="px-2 py-2 text-xs text-gray-500">{i.email}</td>
              <td className="px-2 py-2">{i.docType}</td>
              <td className="px-2 py-2 whitespace-nowrap">
                <button title="View front" className="mx-0.5 rounded px-2 py-1" style={{ background: "var(--accent2)", color: "#fff" }} onClick={() => setImg("/api/files/kyc/" + i.id)}><i className="fa-solid fa-eye"></i> F</button>
                {i.hasBack && <button title="View back" className="mx-0.5 rounded px-2 py-1" style={{ background: "var(--accent2)", color: "#fff" }} onClick={() => setImg("/api/files/kyc/" + i.id + "?side=back")}><i className="fa-solid fa-eye"></i> B</button>}
                {!i.hasBack && <span className="ml-1 text-[10px] text-amber-600" title="No back side — cannot verify">no back</span>}
              </td>
              <td className="px-2 py-2"><span className={"sab " + (i.status === "APPROVED" ? "sab-green" : i.status === "PENDING" ? "sab-amber" : "sab-red")}>{i.status}</span>{i.status === "REJECTED" && i.note && <div className="text-[10px] text-red-500" title="Rejection reason">{i.note}</div>}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap">{i.status === "PENDING" ? (<span className="space-x-1"><button title="Approve" className="mx-0.5 rounded px-2 py-1" style={{ background: "var(--green)", color: "#fff" }} onClick={() => act(i.id, "approve")}><i className="fa-solid fa-check"></i></button><button title="Reject" className="mx-0.5 rounded px-2 py-1" style={{ background: "var(--red)", color: "#fff" }} onClick={() => doReject(i.id)}><i className="fa-solid fa-xmark"></i></button></span>) : <button title="Reverse to pending" className="mx-0.5 rounded px-2 py-1" style={{ background: "var(--bg2)", color: "var(--text2)", border: "1px solid var(--border)" }} onClick={() => doReverse(i.id)}><i className="fa-solid fa-rotate-left"></i> Reverse</button>}</td>
            </tr>))}
            {filtered.length === 0 && <tr><td className="px-2 py-4 text-gray-400" colSpan={8}>No submissions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    {img && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"><button onClick={() => setImg(null)} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg text-white hover:bg-white/30">✕</button><img src={img} alt="" className="ui-pop max-h-[85vh] max-w-[90vw] rounded-xl" /></div>}
  </div>);
}