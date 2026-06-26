"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PasswordInput from "@/components/ui/PasswordInput";
import CountrySelect from "@/components/ui/CountrySelect";

const DIAL_CODES = [
  { code: "LK", dial: "+94" },
  { code: "US", dial: "+1" },
  { code: "GB", dial: "+44" },
  { code: "IN", dial: "+91" },
  { code: "AU", dial: "+61" },
  { code: "CA", dial: "+1" },
  { code: "SG", dial: "+65" },
  { code: "AE", dial: "+971" },
  { code: "ZA", dial: "+27" },
  { code: "NG", dial: "+234" },
  { code: "KE", dial: "+254" },
  { code: "PK", dial: "+92" },
  { code: "BD", dial: "+880" },
  { code: "MY", dial: "+60" },
  { code: "PH", dial: "+63" },
  { code: "ID", dial: "+62" },
  { code: "TH", dial: "+66" },
  { code: "VN", dial: "+84" },
  { code: "EG", dial: "+20" },
  { code: "GH", dial: "+233" },
];

const inputStyle: React.CSSProperties = {
  borderColor: "var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
};

function RegisterForm() {
  const searchParams = useSearchParams();
  const tenantSlug = searchParams.get("tenant") ?? undefined;

  const [type, setType] = useState<"DEMO" | "LIVE">(searchParams.get("type") === "LIVE" ? "LIVE" : "DEMO");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("LK");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState(false); // email already a client -> offer Sign in
  const [loading, setLoading] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => { fetch("/api/public/brand").then((r) => r.json()).then((d) => { if (d.ok) setGoogleOn(!!d.googleEnabled); }).catch(() => {}); }, []);

  // Email verification state — persisted to sessionStorage so page refresh doesn't close the OTP screen
  const [verifyEmail, setVerifyEmailState] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [resendIn, setResendIn] = useState(0);

  // Restore pending verification from sessionStorage on mount (handles mobile tab-switch/page refresh)
  useEffect(() => {
    const saved = sessionStorage.getItem("reg_verify_email");
    if (saved) { setVerifyEmailState(saved); setEmail(saved); setResendIn(0); }
  }, []);

  function setVerifyEmail(email: string) {
    setVerifyEmailState(email);
    if (email) sessionStorage.setItem("reg_verify_email", email);
    else sessionStorage.removeItem("reg_verify_email");
  }

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    setExisting(false);
    const dc = DIAL_CODES.find((d) => d.code === dialCode);
    const fullPhone = phone ? (dc ? dc.dial + phone : phone) : undefined;
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, email, password,
        phone: fullPhone,
        country: country || undefined,
        type,
        tenantSlug,
      }),
    });
    const d = await r.json();
    setLoading(false);
    if (!d.ok) { setErr(d.error || "Registration failed"); if (d.existing) setExisting(true); return; }
    if (d.needsVerification) {
      setVerifyEmail(d.email);
      setResendIn(120); // a code was just sent — start the 2-min resend cooldown
      return;
    }
    window.location.href = d.redirect;
  }

  async function verifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true); setVerifyErr("");
    const r = await fetch("/api/auth/verify-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyEmail, token: verifyCode }),
    });
    const d = await r.json();
    setVerifying(false);
    if (!d.ok) { setVerifyErr(d.error || "Verification failed"); return; }
    sessionStorage.removeItem("reg_verify_email");
    window.location.href = d.redirect;
  }

  async function resendCode() {
    if (resendIn > 0) return; // enforce the 2-minute cooldown
    setVerifyErr("");
    const dc = DIAL_CODES.find((d) => d.code === dialCode);
    const fullPhone = phone ? (dc ? dc.dial + phone : phone) : undefined;
    setResendIn(120);
    await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email: verifyEmail, password, phone: fullPhone, country: country || undefined, type, tenantSlug }),
    });
    setVerifyErr("A new code has been sent.");
  }

  const fieldCls = "w-full rounded-xl border px-3 py-2.5 text-sm auth-field";

  // — Verification step —
  if (verifyEmail) return (
    <form onSubmit={verifySubmit} className="auth-stagger space-y-4">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(37,99,235,.12)" }}>
          <i className="fa-solid fa-envelope-open-text text-2xl" style={{ color: "var(--brand-primary)" }} />
        </div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Check your email</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
          We sent a 6-digit code to <strong>{verifyEmail}</strong>. Enter it below to activate your account.
        </p>
      </div>
      {verifyErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{verifyErr}</p>}
      <input
        type="text" inputMode="numeric" maxLength={6} required
        value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
        className={fieldCls + " text-center text-2xl tracking-[0.5em] font-bold"}
        style={inputStyle} placeholder="000000"
        autoFocus
      />
      <button type="submit" disabled={verifying || verifyCode.length < 6}
        style={{ background: "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))" }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {verifying ? <><i className="fa-solid fa-circle-notch fa-spin" /> Verifying…</> : <>Verify & activate account</>}
      </button>
      <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
        Didn&apos;t receive the code?{" "}
        <button type="button" onClick={resendCode} disabled={resendIn > 0} className="font-semibold hover:underline disabled:no-underline disabled:opacity-60" style={{ color: "var(--brand-primary)" }}>
          {resendIn > 0 ? `Resend in ${Math.floor(resendIn / 60)}:${String(resendIn % 60).padStart(2, "0")}` : "Resend"}
        </button>
      </p>
    </form>
  );

  // — Registration form —
  return (
    <form onSubmit={submit} className="auth-stagger space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Create account</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted-foreground)" }}>Choose an account type to get started</p>
      </div>

      {/* Segmented Demo / Live toggle with a sliding highlight */}
      <div className="relative grid grid-cols-2 rounded-xl border p-1" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg transition-transform duration-300 ease-out"
          style={{
            background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))`,
            transform: type === "LIVE" ? "translateX(calc(100% + 0.5rem))" : "translateX(0)",
            boxShadow: "0 4px 12px -4px rgba(0,0,0,0.3)",
          }}
        />
        {(["DEMO", "LIVE"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)}
            className="relative z-10 py-1.5 text-sm font-semibold transition-colors"
            style={{ color: type === t ? "#fff" : "var(--muted-foreground)" }}>
            {t === "DEMO" ? "Demo" : "Live"}
          </button>
        ))}
      </div>

      {err && !existing && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

      {existing && (
        <div className="space-y-2 rounded-xl border px-3 py-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
          <p style={{ color: "var(--foreground)" }}>
            <i className="fa-solid fa-circle-info mr-1.5" style={{ color: "var(--brand-primary)" }} />
            You already have an account with this email. Sign in to open an additional Demo or Live account from your dashboard.
          </p>
          <a href="/login"
            style={{ background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))` }}
            className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold text-white">
            Sign in <i className="fa-solid fa-arrow-right text-xs" />
          </a>
        </div>
      )}

      <div className="relative">
        <i className="fa-solid fa-user pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
        <input required value={name} onChange={(e) => setName(e.target.value)} className={fieldCls + " pl-10"} style={inputStyle} placeholder="Full name" />
      </div>

      <div className="relative">
        <i className="fa-solid fa-envelope pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted-foreground)" }} />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={fieldCls + " pl-10"} style={inputStyle} placeholder="you@example.com" />
      </div>

      <div className="flex gap-2">
        <select value={dialCode} onChange={(e) => setDialCode(e.target.value)} className="shrink-0 rounded-xl border px-2 py-2.5 text-sm auth-field" style={inputStyle}>
          {DIAL_CODES.map((d) => (
            <option key={d.code} value={d.code}>{d.code} {d.dial}</option>
          ))}
        </select>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldCls + " min-w-0 flex-1"} style={inputStyle} placeholder="Phone number" />
      </div>

      <CountrySelect value={country} onChange={setCountry} className={fieldCls} style={inputStyle} />

      <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} className={fieldCls} style={inputStyle} placeholder="Password (min 6)" />

      <button type="submit" disabled={loading}
        style={{ background: `linear-gradient(135deg, var(--brand-primary), var(--brand-accent))` }}
        className="auth-btn flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {loading ? <><i className="fa-solid fa-circle-notch fa-spin" /> Creating…</> : <>Create {type === "LIVE" ? "Live" : "Demo"} account <i className="fa-solid fa-arrow-right text-xs" /></>}
      </button>

      {googleOn && (<>
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: "var(--border)" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>or</span>
          <div className="h-px flex-1" style={{ background: "var(--border)" }} />
        </div>
        <a href={`/api/auth/google/start?mode=register&type=${type}`} className="flex w-full items-center justify-center gap-2 rounded-xl border bg-white py-2.5 text-sm font-semibold text-gray-700" style={{ borderColor: "var(--border)" }}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="h-4 w-4" /> Continue with Google
        </a>
      </>)}

      <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
        Already have an account?{" "}
        <a href="/login" className="font-semibold hover:underline" style={{ color: "var(--brand-primary)" }}>Sign in</a>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
