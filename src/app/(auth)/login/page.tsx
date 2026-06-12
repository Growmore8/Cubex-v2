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
  const [bioBusy, setBioBusy] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [canRegister, setCanRegister] = useState(false); // tenant login + registration enabled

  useEffect(() => {
    fetch("/api/public/brand").then((r) => r.json()).then((d) => { if (d.ok) setCanRegister(!!d.tenantId && !!d.allowRegistration); }).catch(() => {});
  }, []);

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
    // Just authenticated — don't make the app's PIN lock re-prompt immediately.
    try { sessionStorage.setItem("cubex-pin-ok", "1"); } catch {}
    window.location.href = d.redirect;
  }

  // Passwordless sign-in with a registered passkey (Face ID / Fingerprint).
  async function signInPasskey() {
    setErr(""); setBioBusy(true);
    try {
      const mod: any = await import("@simplewebauthn/browser");
      const optRes = await fetch("/api/auth/passkey/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then((r) => r.json());
      if (!optRes.ok) throw new Error(optRes.error || "No passkey available on this device");
      const asResp = await mod.startAuthentication(optRes.options);
      const vr = await fetch("/api/auth/passkey/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(asResp) }).then((r) => r.json());
      if (!vr.ok) throw new Error(vr.error || "Sign-in failed");
      localStorage.setItem("cubex-remember", "1");
      try { sessionStorage.setItem("cubex-pin-ok", "1"); } catch {}
      window.location.href = vr.redirect;
    } catch (e: any) {
      if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") setErr(e?.message || "Passkey sign-in failed");
    } finally { setBioBusy(false); }
  }

  // Passwordless PIN sign-in (device-bound).
  async function signInPin(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setPinBusy(true);
    try {
      const r = await fetch("/api/auth/pin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "PIN sign-in failed");
      localStorage.setItem("cubex-remember", "1");
      try { sessionStorage.setItem("cubex-pin-ok", "1"); } catch {}
      window.location.href = r.redirect;
    } catch (e: any) { setErr(e?.message || "PIN sign-in failed"); }
    finally { setPinBusy(false); }
  }

  const base = "w-full rounded-xl border bg-transparent py-2.5 pl-10 text-sm text-[var(--foreground)] auth-field";
  const altBtn = "auth-alt flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-[13px] font-semibold transition-colors disabled:opacity-60";

  return (
    <form onSubmit={submit} className="auth-stagger space-y-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Welcome back</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted-foreground)" }}>Sign in to access your trading account</p>
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
          <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" name="password"
            className={base} style={{ borderColor: "var(--border)" }} placeholder="••••••••" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: "var(--muted-foreground)" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 rounded" style={{ accentColor: "var(--brand-primary)" }} />
          Keep me signed in
        </label>
        <a href="/forgot-password" className="whitespace-nowrap text-xs font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>
          Forgot password?
        </a>
      </div>

      <button type="submit" disabled={loading}
        style={{ background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))` }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {loading ? <><i className="fa-solid fa-circle-notch fa-spin" /> Signing in…</> : <>Sign in <i className="fa-solid fa-arrow-right text-xs" /></>}
      </button>

      {/* Passwordless options */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1" style={{ background: "var(--border)" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>or sign in with</span>
        <div className="h-px flex-1" style={{ background: "var(--border)" }} />
      </div>

      {!pinMode ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={signInPasskey} disabled={bioBusy} className={altBtn} style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
            {bioBusy ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-fingerprint" style={{ color: "var(--brand-primary)" }} />} Face ID
          </button>
          <button type="button" onClick={() => { setErr(""); setPin(""); setPinMode(true); }} className={altBtn} style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
            <i className="fa-solid fa-shield-halved" style={{ color: "var(--brand-primary)" }} /> PIN
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <i className="fa-solid fa-shield-halved pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter") signInPin(e as any); }}
              className={base + " pr-3 tracking-[0.3em]"} style={{ borderColor: "var(--border)" }} placeholder="• • • •" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPinMode(false)} className={altBtn + " flex-1"} style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>Back</button>
            <button type="button" onClick={signInPin as any} disabled={pinBusy || pin.length < 4}
              style={{ background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))` }}
              className="auth-btn flex flex-[2] items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pinBusy ? <><i className="fa-solid fa-circle-notch fa-spin" /> Unlocking…</> : <>Unlock <i className="fa-solid fa-arrow-right text-xs" /></>}
            </button>
          </div>
          <p className="text-center text-[10px]" style={{ color: "var(--muted-foreground)" }}>Works on devices where you&apos;ve signed in with your password before.</p>
        </div>
      )}

      {canRegister && (
        <div className="space-y-1 pt-1 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
          <div>New here?{" "}
            <a href="/register?type=DEMO" className="font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}><i className="fa-solid fa-circle-play mr-1 text-[10px]" />Open Demo Account</a>
          </div>
          <div>Ready to trade?{" "}
            <a href="/register?type=LIVE" className="font-semibold hover:underline" style={{ color: "var(--brand-accent)" }}><i className="fa-solid fa-bolt mr-1 text-[10px]" />Open Live Account</a>
          </div>
        </div>
      )}
    </form>
  );
}
