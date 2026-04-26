import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '@/lib/haptics';

interface LevelUpFanfareProps {
  /** Current level number; the fanfare fires whenever this changes (after first mount). */
  levelNumber: number;
  /** Big blind label, e.g. "100/200". */
  blindsLabel: string;
  /** Optional ante value to display below blinds. */
  ante?: number;
  /** Suppress the fanfare entirely (e.g. for spectator views without sound). */
  silent?: boolean;
  /** Fanfare intensity. "soft" early on, "epic" near final-table levels. */
  intensity?: 'soft' | 'epic';
}

/**
 * Full-screen "BLINDS UP" sweep with chip-toss particles, brass shimmer,
 * sub-second visual + haptic. Fires once per level change (skips the
 * initial mount). Auto-dismisses after ~1.6s.
 */
export function LevelUpFanfare({ levelNumber, blindsLabel, ante, silent, intensity = 'soft' }: LevelUpFanfareProps) {
  const lastLevelRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (lastLevelRef.current === null) {
      lastLevelRef.current = levelNumber;
      return;
    }
    if (lastLevelRef.current === levelNumber) return;
    lastLevelRef.current = levelNumber;
    if (silent) return;

    setActive(true);
    haptic('success');
    const timeout = setTimeout(() => setActive(false), 1700);
    return () => clearTimeout(timeout);
  }, [levelNumber, silent]);

  const particleCount = intensity === 'epic' ? 24 : 14;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="level-up-fanfare"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center overflow-hidden"
        >
          {/* Backdrop dim */}
          <motion.div
            className="absolute inset-0 bg-felt-950/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Sweep bar */}
          <motion.div
            className="absolute inset-y-0 w-[150%] -skew-x-12"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(236,208,117,0.4) 50%, transparent 100%)' }}
            initial={{ x: '-150%' }}
            animate={{ x: '50%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Chip-toss particles */}
          {Array.from({ length: particleCount }).map((_, i) => {
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = 180 + Math.random() * 220;
            return (
              <motion.div
                key={i}
                className="absolute w-3 h-3 rounded-full"
                style={{
                  background: i % 3 === 0 ? '#ecd075' : i % 3 === 1 ? '#d8a920' : '#bf9013',
                  boxShadow: '0 0 12px rgba(236,208,117,0.6)',
                }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                animate={{
                  x: Math.cos(angle) * distance,
                  y: Math.sin(angle) * distance + 40,
                  opacity: 0,
                  scale: 1.2,
                  rotate: 360,
                }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            );
          })}

          {/* Hero card */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="relative px-8 py-6 rounded-3xl shadow-glow text-felt-950 font-display"
            style={{ backgroundImage: 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)' }}
          >
            <div className="text-center">
              <div className="uppercase tracking-[0.5em] text-felt-950/70 font-semibold" style={{ fontSize: 'clamp(0.85rem, 2.4vmin, 1.5rem)' }}>
                Level {levelNumber}
              </div>
              <div className="leading-none mt-2 tabular-nums" style={{ fontSize: 'clamp(3rem, 14vmin, 11rem)' }}>
                {blindsLabel}
              </div>
              {ante ? (
                <div className="text-felt-950/70 mt-1" style={{ fontSize: 'clamp(0.85rem, 2.2vmin, 1.4rem)' }}>
                  ante {ante}
                </div>
              ) : null}
              <div className="font-sans uppercase tracking-[0.4em] mt-3 text-felt-950/80" style={{ fontSize: 'clamp(0.7rem, 1.8vmin, 1rem)' }}>
                Blinds up
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
