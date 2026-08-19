"use client";
import { useEffect, useState, useCallback } from "react";

const catColor = (c: string) =>
  c === "TRADE" ? "#16a34a" : c === "CLIENT" ? "#b45309" : c === "ADMIN" ? "#2563eb" :
  c === "SUPERADMIN" ? "#7c3aed" : c === "MANAGER" ? "#0891b2" : "#64748b";

const CSS = `
.aud-wrap{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.aud-row{display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);transition:background .12s;}
.aud-row:last-child{border-bottom:none;}
.aud-row:hover{background:var(--bg2);}
.aud-row:hover .aud-del-btn{opacity:1;}
.aud-cat{flex-shrink:0;margin-top:2px;border-radius:5px;padding:2px 7px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap;}
.aud-body{flex:1;min-width:0;}
.aud-action{font-size:12.5px;font-weight:600;color:var(--text);}
.aud-company{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:color-mix(in srgb,#f59e0b 18%,transparent);color:#b45309;}
.aud-detail{font-size:11px;color:var(--text2);margin-top:1px;word-break:break-word;}
.aud-by{font-weight:700;color:var(--text);}
.aud-time{flex-shrink:0;font-size:10.5px;color:var(--text3);white-space:nowrap;margin-top:2px;}
.aud-del-btn{flex-shrink:0;opacity:0;width:26px;height:26px;border-radius:6px;border:1px solid #fca5a5;background:#fee2e2;color:#b91c1c;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;transition:all .15s;}
.aud-del-btn:hover{background:#fecaca;}
.aud-chk{flex-shrink:0;margin-top:3px;accent-color:var(--accent);width:14px;height:14px;cursor:pointer;}
.aud-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;}
.aud-toolbar input,.aud-toolbar select{padding:7px 10px;font-size:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);outline:none;}
.aud-toolbar input:focus,.aud-toolbar select:focus{border-color:var(--accent);}
.aud-toolbar input{flex:1 1 180px;min-width:140px;}
.aud-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 12px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;transition:all .15s;white-space:nowrap;}
.aud-btn:hover{border-color:var(--accent);color:var(--text);}
.aud-btn.danger{background:#fee2e2;color:#b91c1c;border-color:#fca5a5;}
.aud-btn.danger:hover{background:#fecaca;}
.aud-bulk-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:color-mix(in srgb,var(--accent) 10%,transparent);border-bottom:1px solid var(--border);}
.aud-bulk-bar span{font-size:12px;font-weight:600;color:var(--text);flex:1;}
.aud-confirm-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;}
.aud-confirm{background:var(--card);border-radius:12px;padding:22px;width:360px;max-width:92vw;box-shadow:0 16px 48px rgba(0,0,0,.35);}
.aud-confirm-title{font-weight:700;font-size:14px;margin-bottom:8px;display:flex;align-items:center;gap:8px;}
.aud-confirm-msg{font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5;}
.aud-confirm-actions{display:flex;gap:8px;justify-content:flex-end;}
.aud-empty{text-align:center;padding:36px;font-size:13px;color:var(--text2);}
.aud-empty i{font-size:28px;display:block;margin-bottom:8px;opacity:.3;}
`;

type Item = { id: string; action: string; detail: string | null; category: string; by: string | null; company: string | null; at: string };
type Confirm = { msg: string; onOk: () => void };

export default function SAAudit() {
  const [items, setItems]     = useState<Item[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [q, setQ]             = useState("");
  const [cat, setCat]         = useState("");
  const [co, setCo]           = useState("");
  const [from, setFrom]       = useState("");
  const [to, setTo]           = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q)    p.set("q", q);
    if (cat)  p.set("category", cat);
    if (co)   p.set("tenantId", co);
    if (from) p.set("from", from);
    if (to)   p.set("to", to);
    try {
      const d = await fetch("/api/superadmin/audit?" + p).then(r => r.json());
      if (d.ok) { setItems(d.items); setCompanies(d.companies); setSelected(new Set()); }
    } catch {}
  }, [q, cat, co, from, to]);

  useEffect(() => { load(); }, [load]);

  async function doDelete(body: object) {
    setDeleting(true);
    try {
      await fetch("/api/superadmin/audit", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    } catch {}
    finally { setDeleting(false); setConfirm(null); }
  }

  function confirmDelete(msg: string, body: object) {
    setConfirm({ msg, onOk: () => doDelete(body) });
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title"><i className="fa-solid fa-clipboard-list" style={{ marginRight: 8, color: "var(--accent)" }}></i>Full Audit Log</h1>
        <p className="page-sub">Every action across the entire platform</p>
      </div>

      {/* Toolbar */}
      <div className="aud-toolbar">
        <i className="fa-solid fa-magnifying-glass" style={{ color: "var(--text3)", fontSize: 13 }}></i>
        <input placeholder="Search action / detail / user…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All Categories</option>
          <option>SUPERADMIN</option><option>ADMIN</option><option>MANAGER</option>
          <option>CLIENT</option><option>TRADE</option>
        </select>
        <select value={co} onChange={e => setCo(e.target.value)}>
          <option value="">All Companies</option>
          {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From date" style={{ flex: "0 0 auto", width: 130 }} />
        <input type="date" value={to}   onChange={e => setTo(e.target.value)}   title="To date"   style={{ flex: "0 0 auto", width: 130 }} />
        <button className="aud-btn" onClick={load}><i className="fa-solid fa-rotate-right"></i>Refresh</button>
        {(q || cat || co || from || to) &&
          <button className="aud-btn" onClick={() => { setQ(""); setCat(""); setCo(""); setFrom(""); setTo(""); }}>
            <i className="fa-solid fa-xmark"></i>Clear
          </button>
        }
        <button className="aud-btn danger" onClick={() =>
          confirmDelete(
            `Delete ALL ${items.length} log entries matching the current filters? This cannot be undone.`,
            { deleteAll: true, q, category: cat, tenantId: co, from, to }
          )
        }>
          <i className="fa-solid fa-trash"></i>Delete All ({items.length})
        </button>
      </div>

      <div className="aud-wrap">
        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="aud-bulk-bar">
            <span><i className="fa-solid fa-check-square" style={{ marginRight: 6, color: "var(--accent)" }}></i>{selected.size} selected</span>
            <button className="aud-btn danger" disabled={deleting} onClick={() =>
              confirmDelete(`Delete ${selected.size} selected log entries? This cannot be undone.`, { ids: Array.from(selected) })
            }>
              <i className="fa-solid fa-trash"></i>Delete Selected
            </button>
            <button className="aud-btn" onClick={() => setSelected(new Set())}>
              <i className="fa-solid fa-xmark"></i>Deselect
            </button>
          </div>
        )}

        {/* Header row with select-all */}
        {items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderBottom: "2px solid var(--border)", background: "var(--bg)" }}>
            <input type="checkbox" className="aud-chk" checked={allSelected} onChange={toggleAll} title="Select all" />
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text2)" }}>
              {items.length} entries
            </span>
          </div>
        )}

        {items.length === 0
          ? <div className="aud-empty"><i className="fa-regular fa-folder-open"></i>No audit log entries.</div>
          : items.map(r => (
            <div key={r.id} className="aud-row">
              <input type="checkbox" className="aud-chk" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
              <span className="aud-cat" style={{ background: catColor(r.category) }}>{r.category}</span>
              <div className="aud-body">
                <div className="aud-action">
                  {r.action}
                  {r.company && <span className="aud-company">{r.company}</span>}
                </div>
                {r.detail && (
                  <div className="aud-detail">
                    {r.detail}
                    {r.by && <> &mdash; by <span className="aud-by">{r.by}</span></>}
                  </div>
                )}
              </div>
              <div className="aud-time">{new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
              <button
                className="aud-del-btn"
                title="Delete this entry"
                onClick={() => confirmDelete(`Delete this audit log entry?\n"${r.action}"`, { id: r.id })}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
          ))
        }
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="aud-confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="aud-confirm" onClick={e => e.stopPropagation()}>
            <div className="aud-confirm-title">
              <i className="fa-solid fa-triangle-exclamation" style={{ color: "#b91c1c" }}></i>
              Confirm Delete
            </div>
            <div className="aud-confirm-msg" style={{ whiteSpace: "pre-wrap" }}>{confirm.msg}</div>
            <div className="aud-confirm-actions">
              <button className="aud-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="aud-btn danger" disabled={deleting} onClick={confirm.onOk}>
                {deleting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-trash"></i>}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
