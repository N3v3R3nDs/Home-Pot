/** Tiny validators returning a string error message or null if OK. */

export const required = (v: unknown, label = 'field'): string | null =>
  v == null || (typeof v === 'string' && v.trim() === '') ? `${label} is required` : null;

export const positive = (v: number, label = 'amount'): string | null =>
  !Number.isFinite(v) || v <= 0 ? `${label} must be greater than 0` : null;

export const nonNegative = (v: number, label = 'amount'): string | null =>
  !Number.isFinite(v) || v < 0 ? `${label} cannot be negative` : null;

export const minLen = (v: string, n: number, label = 'value'): string | null =>
  (v ?? '').trim().length < n ? `${label} must be at least ${n} characters` : null;

export const pinDigits = (v: string): string | null =>
  /^\d{4}$/.test(v) ? null : 'PIN must be exactly 4 digits';

/** Run several checks and return the first error, or null. */
export function firstError(...checks: (string | null)[]): string | null {
  return checks.find((c) => c !== null) ?? null;
}
