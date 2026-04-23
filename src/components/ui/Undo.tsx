import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';

interface UndoState {
  message: string;
  /** Called if the user taps Undo within the timeout. */
  onUndo: () => void | Promise<void>;
  /** Called when the timeout expires (commit phase) — usually a no-op since the
   *  destructive action has already been applied optimistically. */
  onConfirm?: () => void | Promise<void>;
  /** ms before the toast auto-dismisses and onConfirm fires. Default 5000. */
  timeoutMs?: number;
}

type ShowFn = (s: UndoState) => void;

const UndoContext = createContext<ShowFn>(() => {});

export function UndoProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<UndoState | null>(null);
  const [progress, setProgress] = useState(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<number>(0);
  const animRef = useRef<number>(0);

  const dismissCommit = useCallback(async () => {
    if (!item) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    cancelAnimationFrame(animRef.current);
    await item.onConfirm?.();
    setItem(null);
  }, [item]);

  const dismissUndo = useCallback(async () => {
    if (!item) return;
    haptic('success');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    cancelAnimationFrame(animRef.current);
    await item.onUndo();
    setItem(null);
  }, [item]);

  const show = useCallback<ShowFn>((s) => {
    haptic('warning');
    setItem(s);
  }, []);

  // Drive the countdown bar + auto-commit
  useEffect(() => {
    if (!item) return;
    const timeout = item.timeoutMs ?? 5000;
    startRef.current = performance.now();
    setProgress(1);
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const p = Math.max(0, 1 - elapsed / timeout);
      setProgress(p);
      if (p > 0) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    timeoutRef.current = setTimeout(() => { void dismissCommit(); }, timeout);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      cancelAnimationFrame(animRef.current);
    };
  }, [item, dismissCommit]);

  return (
    <UndoContext.Provider value={show}>
      {children}
      <AnimatePresence>
        {item && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] w-[min(92vw,420px)]"
          >
            <div className="bg-felt-900 border border-brass-500/40 rounded-2xl shadow-glow overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-ink-100 truncate">{item.message}</span>
                <button
                  onClick={dismissUndo}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-brass-500/20 border border-brass-500/40 text-brass-100 text-xs font-semibold uppercase tracking-wider"
                >Undo</button>
              </div>
              <div className="h-1 bg-brass-500/15">
                <div
                  className="h-full bg-brass-shine transition-[width] duration-100 ease-linear"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </UndoContext.Provider>
  );
}

export function useUndo() { return useContext(UndoContext); }
