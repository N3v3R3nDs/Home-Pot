import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string; }
type ToastFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn>(() => {});
let toastSeq = 0;

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 text-emerald-100',
  error:   'border-red-500/40 text-red-100',
  info:    'border-felt-700 text-ink-100',
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: '✓',
  error:   '✗',
  info:    '•',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback<ToastFn>((message, kind = 'info') => {
    const id = ++toastSeq;
    setItems((prev) => [...prev, { id, kind, message }]);
    if (kind === 'error') haptic('error');
    else if (kind === 'success') haptic('success');
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-3 inset-x-0 z-[70] flex flex-col items-center gap-1.5 px-3 pointer-events-none pt-safe">
        <AnimatePresence>
          {items.map((tItem) => (
            <motion.div
              key={tItem.id}
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -30, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className={`pointer-events-auto bg-felt-900/95 backdrop-blur-sm border rounded-xl px-4 py-2 shadow-felt max-w-sm ${KIND_STYLES[tItem.kind]}`}
            >
              <span className="font-semibold mr-2">{KIND_ICONS[tItem.kind]}</span>
              <span className="text-sm">{tItem.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }
