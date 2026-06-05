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

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>Create account</h1>

      <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {(["DEMO", "LIVE"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 py-2 text-sm font-medium transition-colors"
            style={
              type === t
                ? { backgroundColor: "var(--brand-primary)", color: "#fff" }
                : { background: "var(--card)", color: "var(--muted-foreground)" }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Full name"
      />

      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="you@example.com"
      />

      <div className="flex gap-2">
        <select
          value={dialCode}
          onChange={(e) => setDialCode(e.target.value)}
          className="rounded-md border px-2 py-2 text-sm shrink-0"
          style={inputStyle}
        >
          {DIAL_CODES.map((d) => (
            <option key={d.code} value={d.code}>{d.code} {d.dial}</option>
          ))}
        </select>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="flex-1 rounded-md border px-3 py-2 text-sm min-w-0"
          style={inputStyle}
          placeholder="Phone number"
        />
      </div>

      <CountrySelect value={country} onChange={setCountry} className="w-full rounded-md border px-3 py-2 text-sm" style={inputStyle} />

      <PasswordInput
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Password (min 6)"
      />

      <button
        type="submit"
        disabled={loading}
        style={{ backgroundColor: "var(--brand-primary)" }}
        className="w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create account"}
      </button>
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
