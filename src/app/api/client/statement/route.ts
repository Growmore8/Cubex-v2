import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Branded, printable client account statement (browser Print -> Save as PDF).
// Per-tenant brand (name, logo, colours) so a broker's traders never see "Cubex".
export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return new Response("Forbidden", { status: 403 });
  try {
    const accountId = new URL(req.url).searchParams.get("accountId");
    const account = await prisma.account.findFirst({
      where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false, ...(accountId ? { id: accountId } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true } },
        history: { orderBy: { closedAt: "desc" }, take: 200 },
        financials: { orderBy: { appliedAt: "desc" }, take: 200 },
        trades: { orderBy: { openedAt: "desc" } },
      },
    });
    if (!account) return new Response("No account", { status: 404 });
    const pendings = await prisma.pendingOrder.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
    const requests = await prisma.paymentRequest.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 });

    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! } });
    const t: any = tenant || {};
    const brandName = t.brandName || t.name || "Statement";
    const accent = esc(t.primaryColor || "#2563eb");

    const deposit = Number(account.deposit), withdrawal = Number(account.withdrawal);
    const credit = Number(account.credit), bonus = Number(account.bonus), pnl = Number(account.pnl);
    const balance = deposit - withdrawal + credit + bonus + pnl;

    const openRows = account.trades.map((o) => `<tr>
      <td>${esc(o.ticket.toString())}</td><td>${esc(o.symbol)}</td><td>${esc(o.type)}</td>
      <td class="r">${Number(o.lots).toFixed(2)}</td><td class="r">${Number(o.openPrice)}</td>
      <td class="r">${Number(o.sl) || "—"}</td><td class="r">${Number(o.tp) || "—"}</td>
      <td>${o.openedAt ? new Date(o.openedAt).toLocaleString() : ""}</td></tr>`).join("");
    const pendRows = pendings.map((p) => `<tr>
      <td>${esc(p.symbol)}</td><td>${esc(p.side)}</td><td>${esc(p.kind)}</td>
      <td class="r">${Number(p.lots).toFixed(2)}</td><td class="r">${Number(p.price)}</td>
      <td class="r">${Number(p.sl) || "—"}</td><td class="r">${Number(p.tp) || "—"}</td>
      <td>${new Date(p.createdAt).toLocaleString()}</td></tr>`).join("");
    const histRows = account.history.map((h) => `<tr>
      <td>${esc(h.ticket.toString())}</td><td>${esc(h.symbol)}</td><td>${esc(h.side)}</td>
      <td class="r">${Number(h.lots).toFixed(2)}</td><td class="r">${Number(h.openPrice)}</td><td class="r">${Number(h.closePrice)}</td>
      <td class="r ${Number(h.pnl) >= 0 ? "pos" : "neg"}">${money(Number(h.pnl))}</td>
      <td>${h.closedAt ? new Date(h.closedAt).toLocaleString() : ""}</td></tr>`).join("");
    const reqRows = requests.map((r) => `<tr>
      <td>${esc(r.kind)}</td><td class="r">${money(Number(r.amount))}</td><td>${esc(r.method || "")}</td>
      <td>${esc(r.status)}${r.status === "REJECTED" && r.rejectReason ? " — " + esc(r.rejectReason) : ""}</td>
      <td>${new Date(r.createdAt).toLocaleString()}</td></tr>`).join("");
    const finRows = account.financials.map((f) => `<tr>
      <td>${esc(f.type)}</td><td class="r">${money(Number(f.amount))}</td><td>${esc(f.description || "")}</td>
      <td>${new Date(f.appliedAt).toLocaleString()}</td></tr>`).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${esc(account.login)}</title>
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
  <h2>Running Trades</h2>
  <table><thead><tr><th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th class="r">Open</th><th class="r">SL</th><th class="r">TP</th><th>Opened</th></tr></thead>
  <tbody>${openRows || `<tr><td colspan="8">No open trades.</td></tr>`}</tbody></table>
  <h2>Pending Orders</h2>
  <table><thead><tr><th>Symbol</th><th>Side</th><th>Kind</th><th class="r">Lots</th><th class="r">Price</th><th class="r">SL</th><th class="r">TP</th><th>Placed</th></tr></thead>
  <tbody>${pendRows || `<tr><td colspan="8">No pending orders.</td></tr>`}</tbody></table>
  <h2>Closed Trades</h2>
  <table><thead><tr><th>Ticket</th><th>Symbol</th><th>Side</th><th class="r">Lots</th><th class="r">Open</th><th class="r">Close</th><th class="r">P/L</th><th>Closed</th></tr></thead>
  <tbody>${histRows || `<tr><td colspan="8">No closed trades.</td></tr>`}</tbody></table>
  <h2>Deposit / Withdrawal Requests</h2>
  <table><thead><tr><th>Type</th><th class="r">Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
  <tbody>${reqRows || `<tr><td colspan="5">No requests.</td></tr>`}</tbody></table>
  <h2>Financial History</h2>
  <table><thead><tr><th>Type</th><th class="r">Amount</th><th>Description</th><th>Date</th></tr></thead>
  <tbody>${finRows || `<tr><td colspan="4">No transactions.</td></tr>`}</tbody></table>
  <div class="foot">
    ${t.companyInfo ? esc(t.companyInfo) + "<br>" : ""}${t.supportEmail ? esc(t.supportEmail) : ""}
    <div>This statement was generated by ${esc(brandName)}. Figures are indicative.</div>
  </div>
</body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response(esc(e.message || "Failed"), { status: 400 });
  }
}
