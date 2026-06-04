"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import instruments from "@/config/instruments";

function pnlOf(p: any, price: number) {
  const sym = String(p.symbol || "");
  const dir = p.type === "BUY" ? 1 : -1;
  const diff = (price - p.openPrice) * dir;
  const isFx = !/^(XAU|XAG|XPT|XPD)/.test(sym) && !sym.endsWith("USDT") && /^[A-Z]{6}$/.test(sym);
  if (isFx) {
    const pip = /JPY$/i.test(sym) ? 0.01 : 0.0001;
    let pf = (diff / pip) * p.lots;
    if (/^USD/i.test(sym)) pf = pf / (price || 1);
    return pf;
  }
  const meta = instruments[sym] || { contractSize: 100000 };
  return diff * p.lots * meta.contractSize;
}

export default function TradeDesk() {
  const [tab, setTab] = useState<"open" | "history">("open");
  const [open, setOpen] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [reps, setReps] = useState<any>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");
  const tickedRef = useRef(false);

  async function loadOpen() {
    const d = await fetch("/api/desk/trades").then((r) => r.json());
    if (d.ok) setOpen(d.trades);
  }
  async function loadHistory() {
    const d = await fetch("/api/desk/history").then((r) => r.json());
    if (d.ok) setHistory(d.history);
  }
  async function loadReports() {
    const d = await fetch("/api/desk/reports").then((r) => r.json());
    if (d.ok) setReps(d.reports);
  }
  useEffect(() => { loadOpen(); loadHistory(); loadReports(); }, []);

  useEffect(() => {
    const socket: Socket = io({ path: "/socket.io" });
    socket.on("tick", ({ symbol, price }: any) => setPrices((p) => ({ ...p, [symbol]: price })));
    socket.on("liquidation", () => { loadOpen(); loadReports(); });
    const t = setInterval(loadOpen, 8000);
    return () => { socket.disconnect(); clearInterval(t); };
  }, []);

  async function close(id: string) {
    setErr("");
    const r = await fetch("/api/desk/trades/" + id + "/close", { method: "POST" });
    const d = await r.json();
    if (!d.ok) { setErr(d.error || "Close failed"); return; }
    loadOpen(); loadReports(); loadHistory();
  }

  const stat = (label: string, val: string) => (
    <div className="rounded-md bg-white px-3 py-2 text-sm shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{val}</div>
    </div>
  );
  const dg = (s: string) => instruments[s]?.digits ?? 2;

  return (
    <div className="space-y-4">
      {reps && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {stat("Clients", String(reps.clients))}
          {stat("Open positions", String(reps.openPositions))}
          {stat("Realized P&L", reps.realizedPnl.toFixed(2))}
          {stat("Deposits", reps.deposits.toFixed(2))}
          {stat("Withdrawals", reps.withdrawals.toFixed(2))}
        </div>
      )}

      <div className="rounded-lg border bg-white p-2">
        <div className="px-2 py-1 text-xs font-semibold text-gray-500">MARKET WATCH</div>
        <div className="flex flex-wrap gap-3 px-2 pb-1 text-sm">
          {Object.keys(instruments).map((sym) => (
            <span key={sym} className="font-mono">{sym} <b>{prices[sym]?.toFixed(dg(sym)) ?? "..."}</b></span>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex gap-3 text-sm">
        <button onClick={() => setTab("open")} className={tab === "open" ? "font-medium" : "text-gray-500"}>Open ({open.length})</button>
        <button onClick={() => setTab("history")} className={tab === "history" ? "font-medium" : "text-gray-500"}>History</button>
      </div>

      {tab === "open" ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Ticket</th><th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Lots</th><th className="px-3 py-2">Open</th>
                <th className="px-3 py-2">Current</th><th className="px-3 py-2">P&L</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {open.length === 0 ? <tr><td className="px-3 py-4" colSpan={9}>No open positions.</td></tr> : open.map((p) => {
                const cur = prices[p.symbol] ?? p.openPrice;
                const pl = pnlOf(p, cur);
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{p.ticket}</td>
                    <td className="px-3 py-2">{p.accountLogin} <span className="text-gray-500">{p.accountName}</span></td>
                    <td className="px-3 py-2">{p.symbol}</td>
                    <td className={"px-3 py-2 font-medium " + (p.type === "BUY" ? "text-blue-600" : "text-red-600")}>{p.type}</td>
                    <td className="px-3 py-2">{p.lots}</td>
                    <td className="px-3 py-2 font-mono">{p.openPrice.toFixed(dg(p.symbol))}</td>
                    <td className="px-3 py-2 font-mono">{cur.toFixed(dg(p.symbol))}</td>
                    <td className={"px-3 py-2 font-medium " + (pl >= 0 ? "text-green-600" : "text-red-600")}>{pl.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right"><button className="text-red-600" onClick={() => close(p.id)}>Force close</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Ticket</th><th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Lots</th><th className="px-3 py-2">Open</th>
                <th className="px-3 py-2">Close</th><th className="px-3 py-2">P&L</th>
                <th className="px-3 py-2">Reason</th><th className="px-3 py-2">Closed</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? <tr><td className="px-3 py-4" colSpan={10}>No history.</td></tr> : history.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono">{h.ticket}</td>
                  <td className="px-3 py-2">{h.accountLogin}</td>
                  <td className="px-3 py-2">{h.symbol}</td>
                  <td className="px-3 py-2">{h.side}</td>
                  <td className="px-3 py-2">{h.lots}</td>
                  <td className="px-3 py-2 font-mono">{h.openPrice.toFixed(dg(h.symbol))}</td>
                  <td className="px-3 py-2 font-mono">{h.closePrice.toFixed(dg(h.symbol))}</td>
                  <td className={"px-3 py-2 font-medium " + (h.pnl >= 0 ? "text-green-600" : "text-red-600")}>{h.pnl.toFixed(2)}</td>
                  <td className="px-3 py-2">{h.closeReason}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{new Date(h.closedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
