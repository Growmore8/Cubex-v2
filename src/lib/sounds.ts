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
  try { const v = Number(localStorage.getItem(VOL_KEY)); return isFinite(v) && v > 0 ? Math.min(1, v) : 0.75; } catch { return 0.75; }
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

// A single soft note with a gentle attack/decay envelope. `detune` adds a faint
// second oscillator a few cents apart for a warmer, less "beepy" tone.
function blip(freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine", warm = true) {
  const ac = audioCtx(); if (!ac) return;
  const t0 = ac.currentTime + start;
  const gain = ac.createGain();
  // soft attack, smooth exponential release — no clicks
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  gain.connect(ac.destination);
  const mk = (f: number, detune = 0) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.setValueAtTime(detune, t0); o.connect(gain); o.start(t0); o.stop(t0 + dur + 0.03); };
  mk(freq);
  if (warm) mk(freq, 6); // subtle chorus
}

// Distinct, pleasant patterns per category (gentle bells / arpeggios, not beeps).
const PATTERNS: Record<SoundType, () => void> = {
  // trade: quick confident two-note rise
  trade: () => { const v = getVol() * 0.5; blip(587, 0, 0.12, v, "triangle"); blip(880, 0.1, 0.18, v, "triangle"); },
  // funds: warm 3-note major arpeggio (C-E-G) — "cha-ching" feel
  funds: () => { const v = getVol() * 0.55; blip(523.25, 0, 0.12, v); blip(659.25, 0.11, 0.12, v); blip(783.99, 0.22, 0.26, v); },
  // login: soft two-note "doorbell" (in = up, but kept gentle)
  login: () => { const v = getVol() * 0.45; blip(494, 0, 0.16, v); blip(659, 0.14, 0.24, v); },
  // notice: single mellow bell
  notice: () => { const v = getVol() * 0.5; blip(784, 0, 0.1, v); blip(988, 0.08, 0.28, v); },
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
