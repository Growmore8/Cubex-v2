// Display/storage name normalisation. Capitalises the first letter of each word
// (leaving the rest as typed, so acronyms like "JP" survive). "john doe" -> "John Doe".
export function titleCaseName(s: unknown): string {
  const str = String(s ?? "").trim();
  if (!str) return str;
  return str.replace(/(^|\s|[-'])([a-zA-Z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// Group a number with thousands separators (1261480.5 -> "1,261,480.50"), fixed
// to `digits` decimals. Used for DISPLAY only — never inside <input> values,
// where commas would break numeric parsing. Returns "-" for non-numbers.
export function gnum(v: unknown, digits = 2): string {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Money: always 2 decimals, grouped. (1261480 -> "1,261,480.00")
export function gmoney(v: unknown): string {
  return gnum(v, 2);
}

// Grouped price keeping the value's natural decimals (no forced trailing zeros,
// up to 8 dp). For statements/PDF/email where per-symbol digits aren't handy.
// 64150.5 -> "64,150.5"; 1.2345 -> "1.2345".
export function gprice(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

// Signed money for P&L: "+1,234.50" / "-1,234.50" (grouped, 2 decimals).
export function gsign(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return "-";
  return (n >= 0 ? "+" : "") + gnum(n, 2);
}
