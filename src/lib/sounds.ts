/**
 * Lightweight sound effects via Web Audio (no external assets required).
 * Each sound is a short synthesized cue — works offline and on iOS PWA.
 */

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function setMuted(m: boolean) { muted = m; }
export function isMuted() { return muted; }

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0): void {
  const c = getCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Short rising chime — used when blinds advance. */
export function blindUpSound() {
  tone(660, 0.25, 'triangle', 0.18, 0);
  tone(880, 0.30, 'triangle', 0.16, 0.10);
  tone(1320, 0.45, 'triangle', 0.14, 0.22);
}

/** Knockout sting — used when a player busts. */
export function eliminationSound() {
  tone(220, 0.18, 'sawtooth', 0.16, 0);
  tone(110, 0.40, 'sawtooth', 0.20, 0.12);
}

/** Final-table fanfare. */
export function finalTableSound() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.30, 'triangle', 0.18, i * 0.12));
}

/** Subtle tick used at the last 5 seconds of a level. */
export function tickSound() {
  tone(1000, 0.05, 'square', 0.06, 0);
}

/** Cash register / podium reveal. */
export function winnerSound() {
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, 'sine', 0.18, i * 0.10));
}
