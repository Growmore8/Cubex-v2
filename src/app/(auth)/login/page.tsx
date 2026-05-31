"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

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
      <h1 className="text-xl font-semibold">Sign in</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-1">
        <label className="text-sm text-gray-600">Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm" placeholder="you@example.com" />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-gray-600">Password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm" placeholder="********" />
      </div>
      <button type="submit" disabled={loading}
        style={{ backgroundColor: "var(--brand-primary)" }}
        className="w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50">
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
