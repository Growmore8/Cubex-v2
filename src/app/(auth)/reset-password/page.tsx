"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PasswordInput from "@/components/ui/PasswordInput";

function ResetPasswordForm() {
  const sp = useSearchParams();
  const email = sp.get("email") || "";
  const token = sp.get("token") || "";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    const r = await fetch("/api/auth/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, password }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Reset failed"); return; }
    setDone(true);
  }

  const fieldCls = "w-full rounded-xl border px-3 py-2.5 text-sm auth-field";

  if (!email || !token) return (
    <div className="text-center space-y-3">
      <p className="text-sm text-red-600">Invalid reset link. Please request a new one.</p>
      <a href="/forgot-password" className="text-sm font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>Request reset</a>
    </div>
  );

  if (done) return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(22,163,74,.12)" }}>
        <i className="fa-solid fa-lock-open text-2xl" style={{ color: "#16a34a" }} />
      </div>
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Password updated</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>You can now sign in with your new password.</p>
      </div>
      <a href="/login" className="block text-sm font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>Sign in →</a>
    </div>
  );

  return (
    <form onSubmit={submit} className="auth-stagger space-y-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Reset password</h1>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Enter your new password below</p>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)}
        className={fieldCls} style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        placeholder="New password (min 6)" />
      <button type="submit" disabled={loading}
        style={{ background: "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))" }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {loading ? <><i className="fa-solid fa-circle-notch fa-spin" /> Updating…</> : <>Update password <i className="fa-solid fa-arrow-right text-xs" /></>}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}
