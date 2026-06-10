// Map a notification to a FontAwesome icon + color by category (type/title text).
// Used across every notification list (desk, client app/desktop, superadmin).
export function iconForNotification(n: { type?: string | null; title?: string | null; body?: string | null }): { icon: string; color: string } {
  const t = (n.type || "").toUpperCase();
  const s = ((n.title || "") + " " + (n.body || "")).toLowerCase();
  if (/mainten/.test(s)) return { icon: "fa-screwdriver-wrench", color: "#f59e0b" };       // Maintenance
  if (/promo|special offer|offer ends|discount/.test(s)) return { icon: "fa-bullhorn", color: "#ec4899" }; // Promotion
  if (/\bnews\b|market update|market news/.test(s)) return { icon: "fa-newspaper", color: "#38bdf8" };     // News
  if (t === "TRADE" || /trade|position|order|take profit|\btp\b|stop loss|\bsl\b|liquidat|margin call|stop out|pending/.test(s)) return { icon: "fa-chart-line", color: "#5aa9ff" }; // Trade
  if (t === "FUNDS" || /deposit|withdraw|credit|bonus|insurance|transfer|payment|balance|fund/.test(s)) return { icon: "fa-money-bill-wave", color: "#26a69a" }; // Funds
  if (t === "LOGIN" || /logged in|logged out|login|sign in|sign out|offline|online|disconnect/.test(s)) return { icon: "fa-right-to-bracket", color: "#a78bfa" }; // Login/presence
  return { icon: "fa-circle-info", color: "#94a3b8" }; // Notice (default)
}
