// Shared, branded, printable HTML account statement used by both the client and
// the staff (desk) statement routes. Keeps a single source of truth for the
// layout/styles so the two routes no longer duplicate ~90 lines each.

import { pnlFor } from "@/lib/trademath";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
export function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dt(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "";
}

export interface StatementHtmlInput {
  account: any;          // includes trades, history, financials, user
  tenant: any;
  variant: "client" | "desk";
  pendings?: any[];      // client variant only
  requests?: any[];      // client variant only
  dateLabel?: string;    // desk variant: appended to the Closed Trades heading
  prices?: Record<string, number>;   // live prices for running-trade P&L
  catOf?: Record<string, string>;    // symbol -> category (contract size)
}

export function statementHtml(input: StatementHtmlInput): string {
  const { account, tenant, variant } = input;
  const t: any = tenant || {};
  const brandName = t.brandName || t.name || "Statement";
  const accent = esc(t.primaryColor || "#2563eb");
  const isDesk = variant === "desk";

  const deposit = Number(account.deposit), withdrawal = Number(account.withdrawal);
  const credit = Number(account.credit), bonus = Number(account.bonus), pnl = Number(account.pnl);
  const balance = deposit - withdrawal + credit + bonus + pnl;

  const sideColor = (s: string) => (s === "BUY" ? "#16a34a" : "#dc2626");
  const reasonColor = (r: string) => (r === "TP" ? "#16a34a" : r === "SL" ? "#dc2626" : r === "MC" ? "#d97706" : "#6b7280");

  // Running trades (desk colours the side cell) — now with live Current + P/L.
  const prices = input.prices || {};
  const catOf = input.catOf || {};
  const runPnl = (o: any): number | null => {
    const cur = prices[o.symbol];
    if (cur == null) return null;
    return pnlFor(o.symbol, o.type, Number(o.openPrice), cur, Number(o.lots), catOf[o.symbol]);
  };
  const floating = account.trades.reduce((s: number, o: any) => s + (runPnl(o) || 0), 0);
  const openRows = account.trades.map((o: any) => {
    const cur = prices[o.symbol];
    const pl = runPnl(o);
    return `<tr>
      <td>${esc(o.ticket.toString())}</td><td>${esc(o.symbol)}</td>
      <td${isDesk ? ` style="color:${sideColor(o.type)}"` : ""}>${esc(o.type)}</td>
      <td class="r">${Number(o.lots).toFixed(2)}</td><td class="r">${Number(o.openPrice)}</td>
      <td class="r">${cur != null ? cur : "—"}</td>
      <td class="r">${Number(o.sl) || "—"}</td><td class="r">${Number(o.tp) || "—"}</td>
      <td class="r ${pl != null && pl >= 0 ? "pos" : "neg"}">${pl != null ? money(pl) : "—"}</td>
      <td>${dt(o.openedAt)}</td></tr>`;
  }).join("");

  // Closed trades — desk adds Opened + Reason columns
  const histRows = account.history.map((h: any) => {
    if (isDesk) return `<tr>
      <td>${esc(h.ticket.toString())}</td><td>${esc(h.symbol)}</td>
      <td style="color:${sideColor(h.side)}">${esc(h.side)}</td>
      <td class="r">${Number(h.lots).toFixed(2)}</td>
      <td class="r">${h.openedAt ? dt(h.openedAt) : "—"}</td>
      <td class="r">${Number(h.openPrice)}</td><td class="r">${Number(h.closePrice)}</td>
      <td><span style="color:${reasonColor(h.closeReason || "")};font-weight:600">${esc(h.closeReason || "MANUAL")}</span></td>
      <td class="r ${Number(h.pnl) >= 0 ? "pos" : "neg"}">${money(Number(h.pnl))}</td>
      <td>${dt(h.closedAt)}</td></tr>`;
    return `<tr>
      <td>${esc(h.ticket.toString())}</td><td>${esc(h.symbol)}</td><td>${esc(h.side)}</td>
      <td class="r">${Number(h.lots).toFixed(2)}</td><td class="r">${Number(h.openPrice)}</td><td class="r">${Number(h.closePrice)}</td>
      <td class="r ${Number(h.pnl) >= 0 ? "pos" : "neg"}">${money(Number(h.pnl))}</td>
      <td>${dt(h.closedAt)}</td></tr>`;
  }).join("");

  const finRows = account.financials.map((f: any) => `<tr>
      <td>${esc(f.type)}</td><td class="r">${money(Number(f.amount))}</td><td>${esc(f.description || "")}</td>
      <td>${dt(f.appliedAt)}</td></tr>`).join("");

  // Client-only sections
  const pendRows = (input.pendings || []).map((p: any) => `<tr>
      <td>${esc(p.symbol)}</td><td>${esc(p.side)}</td><td>${esc(p.kind)}</td>
      <td class="r">${Number(p.lots).toFixed(2)}</td><td class="r">${Number(p.price)}</td>
      <td class="r">${Number(p.sl) || "—"}</td><td class="r">${Number(p.tp) || "—"}</td>
      <td>${dt(p.createdAt)}</td></tr>`).join("");
  const reqRows = (input.requests || []).map((r: any) => `<tr>
      <td>${esc(r.kind)}</td><td class="r">${money(Number(r.amount))}</td><td>${esc(r.method || "")}</td>
      <td>${esc(r.status)}${r.status === "REJECTED" && r.rejectReason ? " — " + esc(r.rejectReason) : ""}</td>
      <td>${dt(r.createdAt)}</td></tr>`).join("");

  const openHead = isDesk
    ? `<th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th class="r">Open Price</th><th class="r">Current</th><th class="r">S/L</th><th class="r">T/P</th><th class="r">P/L</th><th>Opened</th>`
    : `<th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th class="r">Open</th><th class="r">Current</th><th class="r">SL</th><th class="r">TP</th><th class="r">P/L</th><th>Opened</th>`;
  const histHead = isDesk
    ? `<th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th>Opened</th><th class="r">Open Price</th><th class="r">Close Price</th><th>Reason</th><th class="r">P/L</th><th>Closed</th>`
    : `<th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th class="r">Open</th><th class="r">Close</th><th class="r">P/L</th><th>Closed</th>`;
  const histCols = isDesk ? 10 : 8;

  const clientSections = isDesk ? "" : `
  <h2>Pending Orders</h2>
  <table><thead><tr><th>Symbol</th><th>Side</th><th>Kind</th><th class="r">Lots</th><th class="r">Price</th><th class="r">SL</th><th class="r">TP</th><th>Placed</th></tr></thead>
  <tbody>${pendRows || `<tr><td colspan="8">No pending orders.</td></tr>`}</tbody></table>`;
  const requestSection = isDesk ? "" : `
  <h2>Deposit / Withdrawal Requests</h2>
  <table><thead><tr><th>Type</th><th class="r">Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
  <tbody>${reqRows || `<tr><td colspan="5">No requests.</td></tr>`}</tbody></table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${esc(account.login)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px;font-size:12px}
  .head{display:flex;align-items:center;gap:16px;border-bottom:3px solid ${accent};padding-bottom:14px;margin-bottom:18px}
  .head img{height:48px;width:auto;object-fit:contain}
  .brand{font-size:20px;font-weight:700;color:${accent}}
  .slogan{font-size:11px;color:#6b7280}
  .meta{margin-left:auto;text-align:right;color:#6b7280;font-size:11px}
  h2{font-size:13px;margin:18px 0 6px;color:#374151;border-left:3px solid ${accent};padding-left:8px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  th,td{border:1px solid #e5e7eb;padding:5px 7px;text-align:left}
  th{background:#f3f4f6;font-weight:600}
  td.r,th.r{text-align:right}
  .pos{color:#16a34a}.neg{color:#dc2626}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px}
  .card{border:1px solid #e5e7eb;border-radius:6px;padding:8px}
  .card .l{color:#6b7280;font-size:10px}.card .v{font-weight:700;font-size:14px}
  .foot{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:10px;color:#9ca3af;font-size:10px;text-align:center}
  .noprint{margin-bottom:14px}
  @media print{.noprint{display:none}}
</style></head><body>
  <div class="noprint"><button onclick="window.print()" style="background:${accent};color:#fff;border:0;padding:8px 16px;border-radius:6px;cursor:pointer">Print / Save as PDF</button></div>
  <div class="head">
    ${t.logoUrl ? `<img src="${esc(t.logoUrl)}" alt="">` : ""}
    <div><div class="brand">${esc(brandName)}</div>${t.slogan ? `<div class="slogan">${esc(t.slogan)}</div>` : ""}</div>
    <div class="meta">Account Statement<br>${new Date().toLocaleString()}</div>
  </div>
  <h2>Account</h2>
  <div class="grid">
    <div class="card"><div class="l">Account</div><div class="v">${esc(account.login)}</div></div>
    <div class="card"><div class="l">Holder</div><div class="v">${esc(account.name || account.user?.name || "")}</div></div>
    <div class="card"><div class="l">Type / Leverage</div><div class="v">${esc(account.type)} · 1:${esc(account.leverage)}</div></div>
  </div>
  <h2>Balance Summary</h2>
  <div class="grid">
    <div class="card"><div class="l">Deposit</div><div class="v pos">${money(deposit)}</div></div>
    <div class="card"><div class="l">Withdrawal</div><div class="v neg">${money(withdrawal)}</div></div>
    <div class="card"><div class="l">Closed P/L</div><div class="v ${pnl >= 0 ? "pos" : "neg"}">${money(pnl)}</div></div>
    <div class="card"><div class="l">Credit</div><div class="v">${money(credit)}</div></div>
    <div class="card"><div class="l">Bonus</div><div class="v">${money(bonus)}</div></div>
    <div class="card"><div class="l">Balance</div><div class="v">${money(balance)}</div></div>
  </div>
  <h2>Running Trades${account.trades.length ? ` <span style="font-weight:400;font-size:11px;color:#6b7280">— Floating P/L <b class="${floating >= 0 ? "pos" : "neg"}">${money(floating)}</b></span>` : ""}</h2>
  <table><thead><tr>${openHead}</tr></thead>
  <tbody>${openRows || `<tr><td colspan="10">No open trades.</td></tr>`}</tbody></table>${clientSections}
  <h2>Closed Trades${isDesk && input.dateLabel ? ` ${input.dateLabel}` : ""}</h2>
  <table><thead><tr>${histHead}</tr></thead>
  <tbody>${histRows || `<tr><td colspan="${histCols}">No closed trades.</td></tr>`}</tbody></table>${requestSection}
  <h2>Financial History</h2>
  <table><thead><tr><th>Type</th><th class="r">Amount</th><th>Description</th><th>Date</th></tr></thead>
  <tbody>${finRows || `<tr><td colspan="4">No transactions.</td></tr>`}</tbody></table>
  <div class="foot">
    ${t.companyInfo ? esc(t.companyInfo) : ""}
    <div>This statement was generated by ${esc(brandName)}. Figures are indicative.</div>
  </div>
</body></html>`;
}
