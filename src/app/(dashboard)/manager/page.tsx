"use client";
import TradeDesk from "@/components/dashboard/TradeDesk";

export default function ManagerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Trade Desk</h1>
      <p className="text-sm text-gray-600">Your assigned clients only.</p>
      <TradeDesk />
    </div>
  );
}
