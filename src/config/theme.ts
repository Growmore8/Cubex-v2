// Global color code - imported by every area so all screens match exactly.
// NOTE: --background / --foreground / --muted-foreground / --ui-accent are also set
// here so the shared .ui-input / .ui-* classes (which reference the next-themes vars)
// follow this trading theme — otherwise inputs render white inside the dark desk.
export const DARK: Record<string, string> = { "--bg": "#131722", "--panel": "#1e222d", "--border": "#363a45", "--text": "#d1d4dc", "--muted": "#848e9c", "--soft": "#2a2e39", "--up": "#0f2018", "--down": "#241016", "--accent": "#0078d7", "--background": "#131722", "--foreground": "#d1d4dc", "--muted-foreground": "#848e9c", "--ui-accent": "#0078d7" };
export const LIGHT: Record<string, string> = { "--bg": "#f4f6fa", "--panel": "#ffffff", "--border": "#e6eaf0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f8", "--up": "#e7f8f0", "--down": "#fdeceb", "--accent": "#2563eb", "--background": "#ffffff", "--foreground": "#0f172a", "--muted-foreground": "#64748b", "--ui-accent": "#2563eb" };
export const BUY = "#26a69a";
export const SELL = "#ef5350";
export const GOLD = "#f0b429";