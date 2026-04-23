import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { tickSound, eliminationSound } from '@/lib/sounds';
import { useSettings } from '@/store/settings';

/**
 * Floating per-action countdown — for slow players. 30 sec default. Buzzes
 * + plays a sound when time runs out. Tap to start, tap again to reset.
 */
export function HandTimer({ defaultSeconds = 30 }: { defaultSeconds?: number }) {
  const { soundEnabled } = useSettings();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(defaultSeconds);
  const intRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!running) return;
    intRef.current = setInterval(() => {
      setRemaining((r) => {
        const next = Math.max(0, r - 1);
        if (next > 0 && next <= 5 && soundEnabled) {
          // tick within last 5 seconds
          const now = Date.now();
          if (now - lastTickRef.current > 800) { tickSound(); lastTickRef.current = now; }
        }
        if (next === 0) {
          if (soundEnabled) eliminationSound();
          haptic('error');
          setRunning(false);
        }
        return next;
      });
    }, 1000);
    return () => { if (intRef.current) clearInterval(intRef.current); };
  }, [running, soundEnabled]);

  const start = () => {
    setRemaining(defaultSeconds);
    setRunning(true);
    haptic('tap');
  };
  const stop = () => { setRunning(false); setRemaining(defaultSeconds); };

  // Compact floating button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-3 z-30 w-12 h-12 rounded-full bg-felt-900/90 backdrop-blur border border-felt-700 text-xl shadow-glow"
        title="Hand timer"
      >⏱</button>
    );
  }

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      className="fixed bottom-24 right-3 z-30 bg-felt-900/95 backdrop-blur border border-brass-500/40 rounded-2xl p-3 shadow-glow w-44"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-brass-300">Hand timer</span>
        <button onClick={() => { stop(); setOpen(false); }} className="text-ink-400 text-lg leading-none">×</button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={remaining}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`font-display text-4xl text-center tabular-nums ${
            remaining === 0 ? 'text-red-400' : remaining <= 5 ? 'text-amber-300' : 'text-brass-shine'
          }`}
        >
          {String(remaining).padStart(2, '0')}
        </motion.div>
      </AnimatePresence>
      <button
        onClick={running ? stop : start}
        className={`mt-2 w-full py-1.5 rounded-lg text-sm font-semibold ${
          running ? 'bg-felt-800 text-ink-200' : 'bg-brass-500/20 text-brass-100 border border-brass-500/40'
        }`}
      >
        {running ? 'Reset' : remaining === 0 ? 'Restart' : 'Start'}
      </button>
    </motion.div>
  );
}
