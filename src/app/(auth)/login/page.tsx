"use client";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/ui/PasswordInput";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "other-device") setNotice("You were signed out because your account was logged in on another device.");
    else if (reason === "deactivated") setNotice("Your account has been deactivated. Please contact support.");
    else if (reason === "suspended") setNotice("This brokerage has been suspended. Please contact support.");
    else if (reason === "expired") setNotice("Your session expired. Please sign in again.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Login failed"); return; }
    if (remember) localStorage.setItem("cubex-remember", "1");
    else localStorage.removeItem("cubex-remember");
    window.location.href = d.redirect;
  }

  const base = "w-full rounded-xl border bg-transparent py-2.5 pl-10 text-sm text-[var(--foreground)] auth-field";

  return (
    <form onSubmit={submit} className="auth-stagger space-y-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Welcome back</h1>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Sign in to your account to continue</p>
      </div>

      {notice && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{notice}</p>}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Email</label>
        <div className="relative">
          <i className="fa-solid fa-envelope pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className={base + " pr-3"} style={{ borderColor: "var(--border)" }} placeholder="you@example.com" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Password</label>
        <div className="relative">
          <i className="fa-solid fa-lock pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
          <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)}
            className={base} style={{ borderColor: "var(--border)" }} placeholder="••••••••" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded" style={{ accentColor: "var(--brand-primary)" }} />
          Keep me signed in for 30 days
        </label>
        <a href="/forgot-password" className="text-xs font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>
          Forgot password?
        </a>
      </div>

      <button type="submit" disabled={loading}
        style={{ background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))` }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {loading ? <><i className="fa-solid fa-circle-notch fa-spin" /> Signing in…</> : <>Sign in <i className="fa-solid fa-arrow-right text-xs" /></>}
      </button>

      <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
        Don&apos;t have an account?{" "}
        <a href="/register" className="font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>
          Open a Live or Demo account
        </a>
      </p>
    </form>
  );
}
