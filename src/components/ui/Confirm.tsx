import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { haptic } from '@/lib/haptics';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    haptic('warning');
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet open={!!state} onClose={() => close(false)} title={state?.title ?? ''}>
        {state?.message && <p className="text-ink-200 text-sm mb-4">{state.message}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" full onClick={() => close(false)}>
            {state?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={state?.destructive ? 'danger' : 'primary'}
            full
            onClick={() => close(true)}
          >
            {state?.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
