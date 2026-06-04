"use client";
// Four distinct notification sounds, synthesized via Web Audio (no asset files).
//  - trade  : trade open/close/liquidation        (two-tone blip)
//  - funds  : deposit / withdrawal / balance       (rising chime)
//  - login  : login / logout                       (soft single tone)
//  - notice : general alerts / KYC / news          (gentle ding)
export type SoundType = "trade" | "funds" | "login" | "notice";

const MUTE_KEY = "cubex-sound-muted";
const VOL_KEY = "cubex-sound-vol";

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function setMuted(m: boolean) {
  try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch {}
}
export function getVol() {
  try { const v = Number(localStorage.getItem(VOL_KEY)); return isFinite(v) && v > 0 ? Math.min(1, v) : 0.5; } catch { return 0.5; }
}
export function setVol(v: number) {
  try { localStorage.setItem(VOL_KEY, String(Math.max(0, Math.min(1, v)))); } catch {}
}

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

function blip(freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const ac = audioCtx(); if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain); gain.connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// Distinct patterns per category so they're recognizable by ear.
const PATTERNS: Record<SoundType, () => void> = {
  trade: () => { const v = getVol() * 0.35; blip(660, 0, 0.09, v, "triangle"); blip(880, 0.09, 0.11, v, "triangle"); },
  funds: () => { const v = getVol() * 0.4; blip(523, 0, 0.1, v); blip(659, 0.1, 0.1, v); blip(784, 0.2, 0.16, v); },
  login: () => { const v = getVol() * 0.3; blip(440, 0, 0.16, v, "sine"); },
  notice: () => { const v = getVol() * 0.35; blip(880, 0, 0.14, v, "sine"); },
};

export function playSound(type: SoundType) {
  if (isMuted()) return;
  try { (PATTERNS[type] || PATTERNS.notice)(); } catch {}
}

// Infer a sound category from a notification's type/title text.
export function soundForNotification(n: { type?: string | null; title?: string | null }): SoundType {
  const t = (n.type || "").toUpperCase();
  const title = (n.title || "").toLowerCase();
  if (t === "TRADE" || /trade|position|order filled|liquidat|stop out|margin call/.test(title)) return "trade";
  if (t === "FUNDS" || /deposit|withdraw|balance|credit|bonus|transfer|payment/.test(title)) return "funds";
  if (t === "LOGIN" || /logged in|logged out|login|sign/.test(title)) return "login";
  return "notice";
}
