import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

interface AnimatedNumberProps {
  /** Target numeric value. */
  value: number;
  /** Format the displayed string from the current animated number. */
  format?: (n: number) => string;
  /** Tween duration in seconds. */
  duration?: number;
  /** Apply tabular numerals so digits don't jitter horizontally. */
  className?: string;
}

/**
 * Counts up (or down) from the previous value to the new value with a
 * spring-like easeOut tween. Every monetary stat, chip count, prize pool,
 * players-left passes through this instead of rendering a raw number.
 *
 * The `format` callback is intentionally NOT in the effect's dep array — call
 * sites pass an inline arrow that's a fresh reference every render, which
 * would otherwise restart the tween on every parent re-render and cause
 * stutter. We thread the latest formatter through a ref instead.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
  className,
}: AnimatedNumberProps) {
  // Stable ref to the latest formatter so we can read it inside the tween
  // without listing it as a dependency.
  const formatRef = useRef<(n: number) => string>(format ?? defaultFormat);
  formatRef.current = format ?? defaultFormat;

  const [display, setDisplay] = useState(() => formatRef.current(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    const from = lastValueRef.current;
    const to = value;
    lastValueRef.current = to;
    if (from === to) {
      // Value steady — just refresh the formatted string in case the
      // formatter (e.g. currency) changed.
      setDisplay(formatRef.current(to));
      return;
    }
    const controls = animate(from, to, {
      duration,
      ease: [0.16, 1, 0.3, 1], // easeOutExpo-ish — fast, decisive settle
      onUpdate: (latest) => setDisplay(formatRef.current(latest)),
    });
    return () => controls.stop();
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}

function defaultFormat(n: number): string {
  return Math.round(n).toLocaleString();
}
