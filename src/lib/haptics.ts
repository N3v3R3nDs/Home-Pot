/** Tiny haptic helper — vibrates on supported devices, no-ops elsewhere. */

type Pattern = 'tap' | 'success' | 'warning' | 'error';

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  success: [12, 60, 24],
  warning: [20, 60, 20],
  error: [40, 80, 40, 80, 80],
};

export function haptic(p: Pattern = 'tap'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try { navigator.vibrate(PATTERNS[p]); } catch { /* noop */ }
}
