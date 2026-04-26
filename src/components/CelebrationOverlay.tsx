import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Celebration {
  id: string;
  glyph: string;
  title: string;
  subtitle?: string;
  /** ms duration on screen. Defaults 2000. */
  durationMs?: number;
  /** Tint for the gradient ring. Defaults brass. */
  tint?: 'brass' | 'emerald' | 'crimson';
}

interface CelebrationOverlayProps {
  /** When set, the overlay shows; pass null to clear. */
  celebration: Celebration | null;
  /** Called when the celebration's display window has elapsed. */
  onDone: () => void;
}

/**
 * Brief full-screen pop for milestone moments — first knockout, final table,
 * heads-up, chip-leader change, biggest pot. Auto-dismisses; non-interactive.
 */
export function CelebrationOverlay({ celebration, onDone }: CelebrationOverlayProps) {
  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(onDone, celebration.durationMs ?? 2000);
    return () => clearTimeout(t);
  }, [celebration, onDone]);

  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key={celebration.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center overflow-hidden"
        >
          <motion.div className="absolute inset-0 bg-felt-950/55 backdrop-blur-sm" />

          {/* Confetti ring */}
          {Array.from({ length: 28 }).map((_, i) => {
            const angle = (i / 28) * Math.PI * 2;
            const distance = 200 + Math.random() * 220;
            const colors = celebration.tint === 'emerald'
              ? ['#34d399', '#10b981', '#bbf7d0']
              : celebration.tint === 'crimson'
              ? ['#f87171', '#dc2626', '#fda4af']
              : ['#ecd075', '#d8a920', '#bf9013'];
            return (
              <motion.div
                key={i}
                className="absolute w-2.5 h-3 rounded-sm"
                style={{ background: colors[i % 3], boxShadow: '0 0 10px rgba(236,208,117,0.5)' }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                animate={{
                  x: Math.cos(angle) * distance,
                  y: Math.sin(angle) * distance + 80,
                  opacity: 0,
                  rotate: 720,
                }}
                transition={{ duration: 1.6, ease: 'easeOut' }}
              />
            );
          })}

          {/* Hero card */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="relative px-8 py-6 rounded-3xl shadow-glow text-felt-950 font-display text-center"
            style={{
              backgroundImage: celebration.tint === 'emerald'
                ? 'linear-gradient(135deg, #6ee7b7 0%, #10b981 50%, #047857 100%)'
                : celebration.tint === 'crimson'
                ? 'linear-gradient(135deg, #fda4af 0%, #ef4444 50%, #b91c1c 100%)'
                : 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)',
            }}
          >
            <div style={{ fontSize: 'clamp(3rem, 12vmin, 6rem)' }}>{celebration.glyph}</div>
            <div className="mt-1" style={{ fontSize: 'clamp(1.5rem, 5vmin, 3rem)' }}>{celebration.title}</div>
            {celebration.subtitle && (
              <div className="font-sans uppercase tracking-[0.4em] mt-2 text-felt-950/80" style={{ fontSize: 'clamp(0.7rem, 2vmin, 1.1rem)' }}>
                {celebration.subtitle}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
