/**
 * Pro-grade sound design via Web Audio. Still no external assets — every cue
 * is synthesized — but each one is a multi-oscillator stack with detuning,
 * envelope shaping, low-pass filter sweeps, and a tiny shared reverb send so
 * cues don't sound like a 1980s game.
 *
 * Browser autoplay policies require a user gesture before the AudioContext
 * can produce sound; we lazily create + resume on the first call, which is
 * always inside a click/tap handler in this app.
 */

let ctx: AudioContext | null = null;
let muted = false;
let masterGain: GainNode | null = null;
let reverbSend: GainNode | null = null;
let reverbWet: GainNode | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    setupBus(ctx);
  }
  // iOS Safari sometimes leaves the ctx in 'suspended' until a fresh gesture.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Build a small algorithmic reverb (impulse response) so cues have air. */
function setupBus(c: AudioContext) {
  masterGain = c.createGain();
  masterGain.gain.value = 0.85;
  masterGain.connect(c.destination);

  // Generate a short, dark IR (~1.4s) — cheap one-time cost.
  const ir = c.createBuffer(2, c.sampleRate * 1.4, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      // Exponential decay with a touch of high-frequency rolloff via mild noise weighting.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  reverbSend = c.createGain();
  reverbSend.gain.value = 1.0;
  reverbWet = c.createGain();
  reverbWet.gain.value = 0.18;
  reverbSend.connect(conv).connect(reverbWet).connect(masterGain);
}

export function setMuted(m: boolean) { muted = m; }
export function isMuted() { return muted; }

/**
 * Unlock the AudioContext on the first real user gesture. After this fires
 * once, subsequent automatic sounds (auto-advance, realtime echoes) play
 * without being blocked by autoplay policies. Idempotent.
 */
let unlockBound = false;
export function bindAudioUnlock(): void {
  if (typeof window === 'undefined' || unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    const c = ensureCtx();
    if (!c) return;
    // Touch the context with an inaudible blip so iOS counts it as gestured.
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
}

interface NoteOpts {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Detune (cents). 0 = none. Used for chorus/phatness when summed with detune-pair. */
  detune?: number;
  /** Low-pass cutoff Hz at attack. Sweeps to `filterEnd`. */
  filterStart?: number;
  filterEnd?: number;
  /** ADSR-ish: attack/decay/sustain (0..1)/release seconds. Defaults give a soft pluck. */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Send level into the reverb bus (0..1). 0 = dry only. */
  reverb?: number;
}

/**
 * Play one shaped tone. Uses a low-pass filter + ADSR envelope and a
 * configurable reverb send. This is the building block; the public sounds
 * below stack several of these for harmonic richness.
 */
function play(opts: NoteOpts): void {
  const c = ensureCtx();
  if (!c || muted) return;
  const {
    freq, duration, type = 'triangle', gain = 0.12,
    delay = 0, detune = 0,
    filterStart = 6000, filterEnd = 1800,
    attack = 0.01, decay = 0.06, sustain = 0.7, release = 0.18,
    reverb = 0.25,
  } = opts;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (detune) osc.detune.setValueAtTime(detune, t0);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(filterStart, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterEnd), t0 + duration);

  const env = c.createGain();
  const peak = Math.max(0.0001, gain);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.linearRampToValueAtTime(peak * sustain, t0 + attack + decay);
  env.gain.setValueAtTime(peak * sustain, t0 + Math.max(attack + decay, duration - release));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);

  osc.connect(filter).connect(env);
  env.connect(masterGain ?? c.destination);
  if (reverb > 0 && reverbSend) {
    const send = c.createGain();
    send.gain.value = reverb;
    env.connect(send).connect(reverbSend);
  }
  osc.start(t0);
  osc.stop(t0 + duration + release + 0.05);
}

/** Stack: same fundamental + slightly detuned twin for chorused phatness. */
function fat(freq: number, duration: number, gain: number, delay: number, type: OscillatorType = 'triangle', reverb = 0.3) {
  play({ freq, duration, gain, delay, type, detune: -7, reverb });
  play({ freq, duration, gain, delay, type, detune: +7, reverb });
}

/** Chord: stack frequencies as a chord stab. */
function chord(freqs: number[], duration: number, gain: number, delay: number, type: OscillatorType = 'triangle', reverb = 0.35) {
  for (const f of freqs) fat(f, duration, gain, delay, type, reverb);
}

/** Quick percussive sub kick — used for impact transients. */
function subKick(delay = 0, gain = 0.45) {
  const c = ensureCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  osc.connect(env).connect(masterGain ?? c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

/** Short white-noise burst with a band-pass filter — for chip ticks / shimmers. */
function noiseHit(opts: { duration: number; delay?: number; centerHz: number; q?: number; gain?: number; reverb?: number }) {
  const c = ensureCtx();
  if (!c || muted) return;
  const { duration, delay = 0, centerHz, q = 8, gain = 0.18, reverb = 0.15 } = opts;
  const t0 = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = centerHz;
  bp.Q.value = q;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(bp).connect(env).connect(masterGain ?? c.destination);
  if (reverb > 0 && reverbSend) {
    const send = c.createGain();
    send.gain.value = reverb;
    env.connect(send).connect(reverbSend);
  }
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

/* ────────────────────────────────────────────────────────────────────────
 * Public cues
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Blind-up: warm rising bell-stack with a low-end thump. Two stacked perfect
 * fifths walking up to a major third resolves to a wide major chord —
 * unmistakable as "level changed" without being annoying every time.
 */
export function blindUpSound() {
  // Bell-tone arpeggio (C5 → G5 → C6 → E6) with reverb tail.
  fat(523.25, 0.45, 0.10, 0.00, 'triangle', 0.45);  // C5
  fat(783.99, 0.50, 0.09, 0.10, 'triangle', 0.45);  // G5
  fat(1046.50, 0.55, 0.09, 0.20, 'triangle', 0.50); // C6
  // Final chord stab on the major triad
  chord([523.25, 659.25, 783.99], 0.85, 0.07, 0.32, 'sine', 0.55);
  // Sparkle on top
  fat(2093, 0.35, 0.05, 0.34, 'sine', 0.6);
  // Sub thump for body
  subKick(0.00, 0.28);
}

/**
 * Knockout sting — drum hit + descending pitched whoosh. Reads as "out".
 */
export function eliminationSound() {
  subKick(0.0, 0.45);
  // Pitched downsweep
  const c = ensureCtx();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.45);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2400, t0);
  f.frequency.exponentialRampToValueAtTime(220, t0 + 0.45);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  osc.connect(f).connect(env).connect(masterGain ?? c.destination);
  osc.start(t0); osc.stop(t0 + 0.6);
  // Noise breath
  noiseHit({ duration: 0.35, centerHz: 800, q: 4, gain: 0.12, reverb: 0.3 });
}

/**
 * Final-table fanfare — bright major arpeggio on a fat synth, with shimmer.
 */
export function finalTableSound() {
  // C major triad rising arpeggio with octave doubling
  const seq = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
  seq.forEach((f, i) => fat(f, 0.40, 0.10, i * 0.10, 'sawtooth', 0.5));
  // Tonic chord landing
  chord([261.63, 329.63, 392.00, 523.25], 1.4, 0.07, seq.length * 0.10, 'triangle', 0.6);
  // Sparkle
  fat(1567.98, 0.6, 0.06, seq.length * 0.10 + 0.08, 'sine', 0.7);
  fat(2093.00, 0.7, 0.05, seq.length * 0.10 + 0.16, 'sine', 0.7);
  subKick(0, 0.22);
}

/** Subtle tick — last 5 seconds of a level. Crisp band-pass click. */
export function tickSound() {
  noiseHit({ duration: 0.04, centerHz: 4500, q: 30, gain: 0.18, reverb: 0 });
}

/**
 * Champion / podium reveal — slow-rolled major triad, big sub drop, sustained
 * shimmer. The whole thing is ~1.4s. Use sparingly.
 */
export function winnerSound() {
  subKick(0, 0.5);
  // Roll up the major scale
  const scale = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
  scale.forEach((f, i) => fat(f, 0.35, 0.09, i * 0.07, 'triangle', 0.55));
  // Sustained chord + octave
  chord([261.63, 329.63, 392.00, 523.25], 1.6, 0.10, 0.5, 'sawtooth', 0.65);
  chord([523.25, 659.25, 783.99], 1.8, 0.07, 0.55, 'sine', 0.75);
  fat(2093.00, 1.4, 0.05, 0.6, 'sine', 0.85);
  // Cymbal-like shimmer
  noiseHit({ duration: 1.4, delay: 0.5, centerHz: 6500, q: 1.2, gain: 0.06, reverb: 0.7 });
}

/**
 * Chip clatter — 3-4 band-pass noise pings + a tiny pitched bell.
 * Reads like real chips landing on felt.
 */
export function chipClatterSound() {
  for (let i = 0; i < 4; i++) {
    noiseHit({ duration: 0.05, delay: i * 0.04 + Math.random() * 0.02, centerHz: 3500 + Math.random() * 1500, q: 12, gain: 0.14, reverb: 0.18 });
  }
  // Subtle pitched ping at end
  fat(1760, 0.20, 0.04, 0.16, 'sine', 0.4);
}

/**
 * Cash-out chime — bright two-note major tenth + sub thump.
 * Reads "money in / money out" satisfying.
 */
export function cashRegisterSound() {
  // Cash drawer style: Eb6 → Bb6 (major sixth-ish bell)
  fat(1244.51, 0.30, 0.10, 0.00, 'triangle', 0.55); // Eb6
  fat(1864.66, 0.40, 0.08, 0.07, 'triangle', 0.6);  // Bb6
  // Sparkle
  fat(2489.02, 0.35, 0.05, 0.10, 'sine', 0.7);
  // Coin drop noise
  noiseHit({ duration: 0.06, delay: 0.0, centerHz: 5500, q: 16, gain: 0.10, reverb: 0.2 });
  noiseHit({ duration: 0.06, delay: 0.05, centerHz: 4200, q: 16, gain: 0.08, reverb: 0.2 });
  subKick(0, 0.18);
}

/** Celebratory rising arpeggio — first bust, chip leader changes, big top-ups. */
export function celebrationSound() {
  // G major arpeggio with octave bell on top
  [392.00, 493.88, 587.33, 783.99].forEach((f, i) => fat(f, 0.28, 0.09, i * 0.07, 'triangle', 0.45));
  chord([392.00, 493.88, 587.33], 0.7, 0.07, 0.28, 'sine', 0.55);
  fat(1567.98, 0.4, 0.05, 0.3, 'sine', 0.6);
  subKick(0, 0.18);
}

/**
 * Level-expired alert — fires once per level boundary in *manual* mode (when
 * auto-advance is off), to tell the host "time's up, hit Next." Three
 * pulsed boxing-bell strikes with a low gong undertone — distinctly more
 * alarm-y than blindUp so the two cues don't sound the same when the host
 * eventually advances and blindUp fires for the new level.
 */
export function levelExpiredSound() {
  // Three sharp dings (classic boxing/ring bell — round over)
  for (let i = 0; i < 3; i++) {
    const t = i * 0.18;
    fat(880, 0.25, 0.10, t, 'square', 0.5);   // A5
    fat(1318, 0.25, 0.08, t, 'square', 0.5);  // E6 (perfect 5th)
  }
  // Low gong undertone for weight
  fat(110, 0.9, 0.08, 0.0, 'sine', 0.5);
  // Final brass ring resolving up
  fat(1760, 0.5, 0.06, 0.55, 'triangle', 0.7);
  subKick(0, 0.18);
}

/** Heads-up dueling sting — two competing low notes that resolve. */
export function headsUpSound() {
  subKick(0, 0.4);
  fat(146.83, 0.6, 0.12, 0.0, 'sawtooth', 0.5);   // D3
  fat(196.00, 0.6, 0.12, 0.10, 'sawtooth', 0.5);  // G3
  // Tension chord
  chord([146.83, 220.00, 293.66, 369.99], 1.0, 0.08, 0.3, 'sawtooth', 0.6);
  noiseHit({ duration: 0.5, delay: 0.0, centerHz: 200, q: 1.5, gain: 0.12, reverb: 0.4 });
}
