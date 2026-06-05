"use client";
import { useState, Suspense } from "react";
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

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia", "Australia",
  "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Bulgaria", "Cambodia", "Cameroon",
  "Canada", "Chile", "China", "Colombia", "Congo", "Croatia", "Cuba", "Cyprus",
  "Czech Republic", "Denmark", "Ecuador", "Egypt", "Ethiopia", "Finland", "France",
  "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Hungary", "India", "Indonesia",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Japan", "Jordan", "Kazakhstan", "Kenya",
  "Kuwait", "Kyrgyzstan", "Lebanon", "Libya", "Lithuania", "Malaysia", "Mexico", "Moldova",
  "Morocco", "Mozambique", "Myanmar", "Netherlands", "New Zealand", "Nigeria", "Norway",
  "Oman", "Pakistan", "Palestine", "Panama", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia", "Singapore",
  "Slovakia", "Slovenia", "Somalia", "South Africa", "South Korea", "Spain", "Sri Lanka",
  "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan", "Tanzania", "Thailand", "Tunisia",
  "Turkey", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

const inputStyle: React.CSSProperties = {
  borderColor: "var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
};

function RegisterForm() {
  const searchParams = useSearchParams();
  const tenantSlug = searchParams.get("tenant") ?? undefined;

  const [type, setType] = useState<"DEMO" | "LIVE">("DEMO");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("LK");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
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
    if (!d.ok) { setErr(d.error || "Registration failed"); return; }
    window.location.href = d.redirect;
  }

  const fieldCls = "w-full rounded-xl border px-3 py-2.5 text-sm auth-field";

  return (
    <form onSubmit={submit} className="auth-stagger space-y-4">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Create account</h1>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Choose an account type to get started</p>
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

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

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
