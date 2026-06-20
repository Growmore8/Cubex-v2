// Global color code - imported by every area so all screens match exactly.
// NOTE: --background / --foreground / --muted-foreground / --ui-accent are also set
// here so the shared .ui-input / .ui-* classes (which reference the next-themes vars)
// follow this trading theme — otherwise inputs render white inside the dark desk.
export const DARK: Record<string, string> = { "--bg": "#131722", "--panel": "#1e222d", "--border": "#363a45", "--text": "#d1d4dc", "--muted": "#848e9c", "--soft": "#2a2e39", "--up": "#0f2018", "--down": "#241016", "--accent": "#0078d7", "--background": "#131722", "--foreground": "#d1d4dc", "--muted-foreground": "#848e9c", "--ui-accent": "#0078d7" };
export const LIGHT: Record<string, string> = { "--bg": "#f4f6fa", "--panel": "#ffffff", "--border": "#e6eaf0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f8", "--up": "#e7f8f0", "--down": "#fdeceb", "--accent": "#2563eb", "--background": "#ffffff", "--foreground": "#0f172a", "--muted-foreground": "#64748b", "--ui-accent": "#2563eb" };

// ADSS-inspired palette — deep-black smooth UI, fixed green accent (NOT the
// tenant brand colour, which stays only on the loading splash). Used by the
// desk/admin first, then client desktop + app.
export const ADSS_DARK: Record<string, string> = { "--bg": "#0a0d12", "--panel": "#11151d", "--border": "#1c2330", "--text": "#e7ecf3", "--muted": "#8a93a6", "--soft": "#151b25", "--up": "#0e2a20", "--down": "#2a1116", "--accent": "#16c79a", "--background": "#0a0d12", "--foreground": "#e7ecf3", "--muted-foreground": "#8a93a6", "--ui-accent": "#16c79a" };
export const ADSS_LIGHT: Record<string, string> = { "--bg": "#f3f5f9", "--panel": "#ffffff", "--border": "#e6eaf0", "--text": "#0f172a", "--muted": "#64748b", "--soft": "#eef2f6", "--up": "#e7f8f0", "--down": "#fdeceb", "--accent": "#0f9d77", "--background": "#ffffff", "--foreground": "#0f172a", "--muted-foreground": "#64748b", "--ui-accent": "#0f9d77" };
export const ADSS_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Buy/Sell BUTTON colours (ADSS): blue buy, red sell. (P/L still uses BUY/SELL below.)
export const BUYBTN = "#2f81f7";
export const SELLBTN = "#f6465d";
export const BUY = "#26a69a";
export const SELL = "#ef5350";
export const GOLD = "#f0b429";