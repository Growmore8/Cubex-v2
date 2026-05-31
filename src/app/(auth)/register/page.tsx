"use client";
import { useState } from "react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Registration failed"); return; }
    window.location.href = d.redirect;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Create account</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <input required value={name} onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Full name" />
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm" placeholder="you@example.com" />
      <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Password (min 6)" />
      <button type="submit" disabled={loading}
        style={{ backgroundColor: "var(--brand-primary)" }}
        className="w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50">
        {loading ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
