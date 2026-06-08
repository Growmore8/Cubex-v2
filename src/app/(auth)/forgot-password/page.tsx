"use client";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    const r = await fetch("/api/auth/forgot-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Failed"); return; }
    setSent(true);
  }

  const base = "w-full rounded-xl border bg-transparent py-2.5 pl-10 text-sm text-[var(--foreground)] auth-field";

  if (sent) return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(22,163,74,.12)" }}>
        <i className="fa-solid fa-envelope-circle-check text-2xl" style={{ color: "#16a34a" }} />
      </div>
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Check your email</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
          If <strong>{email}</strong> is registered, you'll receive a password reset link shortly.
        </p>
      </div>
      <a href="/login" className="block text-sm font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>
        ← Back to sign in
      </a>
    </div>
  );

  return (
    <form onSubmit={submit} className="auth-stagger space-y-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Forgot password</h1>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Enter your email and we'll send a reset link
        </p>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <div className="relative">
        <i className="fa-solid fa-envelope pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className={base + " pr-3"} style={{ borderColor: "var(--border)" }} placeholder="you@example.com" />
      </div>
      <button type="submit" disabled={loading}
        style={{ background: "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))" }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {loading ? <><i className="fa-solid fa-circle-notch fa-spin" /> Sending…</> : <>Send reset link <i className="fa-solid fa-arrow-right text-xs" /></>}
      </button>
      <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
        <a href="/login" className="font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>← Back to sign in</a>
      </p>
    </form>
  );
}
