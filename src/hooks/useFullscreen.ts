import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

/**
 * Redirects to `destination` when the device rotates *into* `target` orientation.
 * Used to flip between live (portrait) and monitor (landscape) routes on phones —
 * the PWA's orientation lock has been removed in the manifest. Only fires on
 * actual transitions, so manual navigation in the "wrong" orientation is left alone.
 */
export function useRedirectOnOrientation(target: 'landscape' | 'portrait', destination: string) {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const get = (): 'landscape' | 'portrait' =>
      window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    let last = get();
    const update = () => {
      const next = get();
      if (next === last) return;
      last = next;
      if (next === target) navigate(destination, { replace: true });
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [target, destination, navigate]);
}
