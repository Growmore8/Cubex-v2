"use client";
import { useEffect, useState } from "react";

export default function SuperadminSymbolsPage() {
  const [symbols, setSymbols] = useState<any[]>([]);
  useEffect(() => { fetch("/api/symbols").then((r) => r.json()).then((d) => { if (d.ok) setSymbols(d.symbols); }); }, []);
  const byCat = (c: string) => symbols.filter((s) => s.category === c);
  const Group = ({ title, cat }: any) => (
    <div className="rounded-lg border bg-white p-3">
      <div className="mb-2 text-sm font-semibold capitalize">{title} ({byCat(cat).length})</div>
      <div className="flex flex-wrap gap-1.5">{byCat(cat).map((s) => <span key={s.symbol} className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">{s.symbol}</span>)}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Global Symbols</h1>
      <p className="text-sm text-gray-600">One catalog, shown the same in every terminal and admin desk. Run the seed to (re)populate it.</p>
      <Group title="Forex" cat="forex" />
      <Group title="Metals" cat="metals" />
      <Group title="Crypto" cat="crypto" />
    </div>
  );
}
