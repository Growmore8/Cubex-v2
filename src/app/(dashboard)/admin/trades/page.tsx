"use client";
import Link from "next/link";
import TradeDesk from "@/components/dashboard/TradeDesk";

export default function AdminTradesPage() {
  const nav = (href: string, label: string, active = false) => (
    <Link href={href} className={"text-sm " + (active ? "font-medium" : "text-gray-500")}
      style={active ? { color: "var(--brand-primary)" } : undefined}>{label}</Link>
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Trade Desk</h1>
        
      </div>
      <TradeDesk />
    </div>
  );
}

