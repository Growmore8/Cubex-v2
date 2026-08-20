"use client";
import { useState } from "react";

const TYPES = [
  { value: "DEPOSIT",     label: "Deposit",     icon: "fa-download",  color: "#16a34a" },
  { value: "WITHDRAWAL",  label: "Withdrawal",  icon: "fa-upload",    color: "#dc2626" },
  { value: "CREDIT_IN",   label: "Credit In",   icon: "fa-plus",      color: "#2563eb" },
  { value: "CREDIT_OUT",  label: "Credit Out",  icon: "fa-minus",     color: "#dc2626" },
  { value: "BONUS",       label: "Bonus",       icon: "fa-gift",      color: "#7c3aed" },
  { value: "INSURANCE",   label: "Insurance",   icon: "fa-shield",    color: "#0891b2" },
];

const CSS = `
.adj-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;}
.adj-modal{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.35);}
.adj-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px;}
.adj-sub{font-size:12px;color:var(--text2);margin-bottom:18px;}
.adj-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:5px;}
.adj-type-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:16px;}
.adj-type-btn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:9px;border:2px solid var(--border);background:var(--bg2);cursor:pointer;transition:all .15s;font-size:11px;font-weight:600;color:var(--text2);}
.adj-type-btn:hover{border-color:var(--accent);color:var(--text);}
.adj-type-btn.sel{border-color:var(--sel-c);background:var(--sel-bg);color:var(--sel-c);}
.adj-type-btn i{font-size:14px;}
.adj-field{margin-bottom:14px;}
.adj-input{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text);font-size:13px;outline:none;transition:border-color .15s;}
.adj-input:focus{border-color:var(--accent);}
.adj-input::placeholder{color:var(--text3);}
.adj-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.adj-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-size:13px;font-weight:600;border-radius:8px;cursor:pointer;transition:all .15s;border:1px solid var(--border);}
.adj-btn.cancel{background:var(--bg2);color:var(--text2);}
.adj-btn.cancel:hover{color:var(--text);}
.adj-btn.apply{background:var(--accent);color:#04221c;border-color:transparent;}
.adj-btn.apply:hover{opacity:.88;}
.adj-btn:disabled{opacity:.5;cursor:not-allowed;}
.adj-err{padding:8px 12px;background:#fee2e2;color:#b91c1c;border-radius:7px;font-size:12px;margin-top:10px;}
`;

type Props = {
  open: boolean;
  data: any;
  setData: (v: any) => void;
  onClose: () => void;
  onApply: () => void;
  error?: string;
  loading?: boolean;
};

export default function AdjustBalanceDialog({ open, data, setData, onClose, onApply, error, loading }: Props) {
  if (!open || !data) return null;
  const sel = TYPES.find(t => t.value === (data.type || "DEPOSIT")) || TYPES[0];

  return (
    <div className="adj-overlay" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="adj-modal" onClick={e => e.stopPropagation()}>
        <div className="adj-title">
          <i className="fa-solid fa-coins" style={{ color: "var(--accent)" }}></i>
          Adjust Balance
        </div>
        <div className="adj-sub">Account <strong>{data.login}</strong>{data.accountType ? ` · ${data.accountType === "LIVE" ? "Live" : "Demo"}` : ""}</div>

        {/* Type picker */}
        <div className="adj-label">Transaction Type</div>
        <div className="adj-type-grid">
          {TYPES.map(t => (
            <button
              key={t.value}
              className={"adj-type-btn" + (data.type === t.value ? " sel" : "")}
              style={{ "--sel-c": t.color, "--sel-bg": t.color + "18" } as any}
              onClick={() => setData({ ...data, type: t.value })}
            >
              <i className={"fa-solid " + t.icon} style={{ color: data.type === t.value ? t.color : undefined }}></i>
              {t.label}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div className="adj-field">
          <div className="adj-label">Amount (USD)</div>
          <input
            className="adj-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={data.amount || ""}
            onChange={e => setData({ ...data, amount: e.target.value })}
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="adj-field" style={{ marginBottom: 0 }}>
          <div className="adj-label">Description <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></div>
          <input
            className="adj-input"
            placeholder="e.g. Manual top-up, bonus adjustment…"
            value={data.description || ""}
            onChange={e => setData({ ...data, description: e.target.value })}
          />
        </div>

        {error && <div className="adj-err"><i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>{error}</div>}

        <div className="adj-actions">
          <button className="adj-btn cancel" onClick={onClose}>Cancel</button>
          <button
            className="adj-btn apply"
            disabled={!data.amount || Number(data.amount) <= 0 || loading}
            onClick={onApply}
          >
            {loading
              ? <><i className="fa-solid fa-circle-notch fa-spin"></i>Applying…</>
              : <><i className={"fa-solid " + sel.icon}></i>Apply {sel.label}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
