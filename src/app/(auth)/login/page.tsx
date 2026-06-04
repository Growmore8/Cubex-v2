"use client";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "other-device") setNotice("You were signed out because your account was logged in on another device.");
    else if (reason === "deactivated") setNotice("Your account has been deactivated. Please contact support.");
    else if (reason === "expired") setNotice("Your session expired. Please sign in again.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Login failed"); return; }
    window.location.href = d.redirect;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold text-zinc-500">Sign in</h1>
      {notice && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{notice}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-1">
        <label className="text-sm text-gray-600">Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm text-gray-800" placeholder="you@example.com" />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-gray-600">Password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full text-gray-800 rounded-md border px-3 py-2 text-sm" placeholder="********" />
      </div>
      <button type="submit" disabled={loading}
        style={{ backgroundColor: "var(--brand-primary)" }}
        className="w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50">
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
