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
 * spring-like easeOut tween. The single biggest "this looks expensive"
 * upgrade — every monetary stat, chip count, prize pool, players-left
 * should pass through this instead of rendering a raw number.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 0.9,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(() => format(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    const from = lastValueRef.current;
    const to = value;
    lastValueRef.current = to;
    if (from === to) {
      setDisplay(format(to));
      return;
    }
    const controls = animate(from, to, {
      duration,
      ease: [0.16, 1, 0.3, 1], // easeOutExpo-ish — fast, decisive settle
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
  }, [value, duration, format]);

  return <span className={className}>{display}</span>;
}
