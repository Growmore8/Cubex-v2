"use client";
import { useEffect, useState } from "react";
import WalletPanel from "@/components/WalletPanel";

export default function WalletPage() {
  const [tab, setTab] = useState<"deposit" | "withdraw" | "kyc">("deposit");
  useEffect(() => {
    try {
      const a = new URLSearchParams(window.location.search).get("action");
      if (a === "withdraw") setTab("withdraw"); else if (a === "kyc") setTab("kyc"); else setTab("deposit");
    } catch (e) {}
  }, []);
  return (<div className="mx-auto max-w-3xl p-4"><WalletPanel key={tab} initialTab={tab} /></div>);
}
