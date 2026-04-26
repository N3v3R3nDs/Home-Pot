import { motion } from 'framer-motion';

interface EmptyStateBadgeProps {
  /** Big emoji glyph to pulse — defaults to a poker chip. */
  glyph?: string;
  /** Title (e.g. "Waiting for first buy-in"). */
  title: string;
  /** One-line subtitle. */
  subtitle?: string;
}

/**
 * Inviting placeholder for early-game states (no buy-ins yet, no players, etc.).
 * Pulsing chip glyph + brass-shimmer title — feels intentional, never blank.
 */
export function EmptyStateBadge({ glyph = '🃏', title, subtitle }: EmptyStateBadgeProps) {
  return (
    <div className="flex flex-col items-center gap-3 max-w-md text-center px-6">
      <motion.div
        animate={{
          scale: [1, 1.08, 1],
          filter: ['drop-shadow(0 0 0px rgba(236,208,117,0))', 'drop-shadow(0 0 16px rgba(236,208,117,0.55))', 'drop-shadow(0 0 0px rgba(236,208,117,0))'],
        }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ fontSize: 'clamp(3rem, 12vmin, 7rem)' }}
      >
        {glyph}
      </motion.div>
      <div className="font-display text-brass-shine" style={{ fontSize: 'clamp(1.4rem, 4vmin, 2.4rem)' }}>
        {title}
      </div>
      {subtitle && (
        <div className="text-ink-300" style={{ fontSize: 'clamp(0.9rem, 2.4vmin, 1.2rem)' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
