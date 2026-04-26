import { forwardRef, useEffect, useRef, useState, type FocusEvent } from 'react';
import { cn } from '@/lib/cn';

export interface NumberInputProps {
  /** Current numeric value (always a number; we coerce internally). */
  value: number;
  /** Called with the parsed numeric value on every keystroke. Empty input → 0. */
  onValueChange: (n: number) => void;
  label?: string;
  hint?: string;
  suffix?: string;
  /** Minimum value (the field still allows transient empty/typing states). */
  min?: number;
  /** Maximum value. */
  max?: number;
  /** Floating point allowed? Defaults false (integer only). */
  decimals?: boolean;
  /** Apply when this input is required to have a non-zero value. */
  required?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Numeric input that doesn't fight the user.
 *
 * Issues with the naive `<input type="number" value={n}>`:
 *  - Clearing the field snaps back to "0" because Number('') === 0.
 *  - Leading-zero shenanigans: typing "5" while the field says "0" can land
 *    you on "05" depending on cursor placement.
 *  - Numeric keyboards on Android and iOS Safari render and behave
 *    differently for inputmode="numeric" vs type="number".
 *
 * Fix: keep a local *string* state for the displayed value, parse on every
 * change, and emit the parsed number via `onValueChange`. The user can
 * freely clear the field (shows blank, emits 0). Focusing the field
 * selects all so typing replaces.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ label, hint, suffix, value, onValueChange, min, max, decimals = false, className, id, name, placeholder, disabled, autoFocus, required }, ref) => {
    const [text, setText] = useState<string>(value === 0 && !required ? '' : String(value));
    // Sync from external value changes (e.g. template load) — but only when
    // it really differs, so the user's in-flight typing isn't clobbered.
    const lastEmittedRef = useRef<number>(value);
    useEffect(() => {
      if (value !== lastEmittedRef.current) {
        setText(value === 0 && !required ? '' : String(value));
        lastEmittedRef.current = value;
      }
    }, [value, required]);

    const inputId = id ?? name;

    const commit = (raw: string) => {
      // Strip everything except digits + optional single decimal point.
      let clean = raw.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, '');
      if (decimals) {
        // Keep only the first dot.
        const firstDot = clean.indexOf('.');
        if (firstDot >= 0) clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, '');
      }
      // Strip leading zeros except "0." or a single "0"
      if (clean.length > 1 && clean.startsWith('0') && !clean.startsWith('0.')) {
        clean = clean.replace(/^0+/, '') || '0';
      }
      setText(clean);
      let n = clean === '' ? 0 : Number(clean);
      if (Number.isNaN(n)) n = 0;
      if (min !== undefined && n < min) n = min;
      if (max !== undefined && n > max) n = max;
      lastEmittedRef.current = n;
      onValueChange(n);
    };

    const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
      // Select all so the next keystroke replaces, doesn't append.
      e.currentTarget.select();
    };

    return (
      <div className="w-full">
        {label && <label htmlFor={inputId} className="label">{label}</label>}
        <div className="relative">
          <input
            id={inputId}
            name={name}
            ref={ref}
            type="text"
            inputMode={decimals ? 'decimal' : 'numeric'}
            pattern={decimals ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
            value={text}
            placeholder={placeholder ?? '0'}
            disabled={disabled}
            autoFocus={autoFocus}
            onFocus={handleFocus}
            onChange={(e) => commit(e.target.value)}
            onBlur={(e) => {
              // On blur, normalize: empty field becomes "" but emits 0.
              commit(e.target.value);
            }}
            className={cn('input', suffix && 'pr-14', className)}
          />
          {suffix && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm font-mono pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
        {hint && <p className="mt-1.5 text-xs text-ink-400">{hint}</p>}
      </div>
    );
  },
);
NumberInput.displayName = 'NumberInput';
