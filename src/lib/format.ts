// Display/storage name normalisation. Capitalises the first letter of each word
// (leaving the rest as typed, so acronyms like "JP" survive). "john doe" -> "John Doe".
export function titleCaseName(s: unknown): string {
  const str = String(s ?? "").trim();
  if (!str) return str;
  return str.replace(/(^|\s|[-'])([a-zA-Z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}
