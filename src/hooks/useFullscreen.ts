import { useCallback, useEffect, useState } from 'react';

/** Tracks browser fullscreen state and exposes toggle helpers. */
export function useFullscreen(target?: HTMLElement | null) {
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== 'undefined' && !!document.fullscreenElement,
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(async () => {
    const el = target ?? document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      try {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } catch {
        /* iOS Safari may reject — silently fall back to "regular" monitor view */
      }
    }
  }, [target]);

  const exit = useCallback(async () => {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* noop */ }
    }
  }, []);

  const toggle = useCallback(() => (isFullscreen ? exit() : enter()), [isFullscreen, enter, exit]);

  return { isFullscreen, enter, exit, toggle };
}

/** Tracks landscape vs portrait orientation. */
export function useOrientation(): 'landscape' | 'portrait' {
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(() => {
    if (typeof window === 'undefined') return 'portrait';
    return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  });
  useEffect(() => {
    const update = () => setOrientation(window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait');
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return orientation;
}
