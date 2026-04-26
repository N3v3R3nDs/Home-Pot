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

/** True when the PWA is launched in standalone display mode (already chrome-less). */
function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Best-effort "always fullscreen" for monitor views.
 *
 * - In PWA standalone mode, the app is already chrome-less; we no-op.
 * - In a regular browser tab, we try to enter fullscreen on mount, on every
 *   user click anywhere on the page (one-shot until satisfied), and on every
 *   orientation change. Browsers require a user gesture for `requestFullscreen`,
 *   so the click and orientation listeners are how we eventually succeed; iOS
 *   Safari rejects in many contexts and we silently fall back.
 * - On a transition back to portrait we exit fullscreen (so the live/control
 *   route — which the orientation-redirect hook navigates to — isn't trapped).
 */
export function useAutoFullscreen() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPwaStandalone()) return;

    let cancelled = false;
    const tryEnter = async () => {
      if (cancelled) return;
      if (document.fullscreenElement) return;
      try {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      } catch {
        /* needs a user gesture; the click/orientation listeners below will retry */
      }
    };
    const tryExit = async () => {
      if (!document.fullscreenElement) return;
      try { await document.exitFullscreen(); } catch { /* noop */ }
    };

    // Best-effort on mount (works if the navigation that brought us here was
    // the original gesture, e.g. a Link click in the same tick on Chrome).
    void tryEnter();

    const get = (): 'landscape' | 'portrait' =>
      window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    let last = get();
    const onResize = () => {
      const next = get();
      if (next === last) return;
      last = next;
      if (next === 'landscape') void tryEnter();
      else void tryExit();
    };

    // Any tap on the monitor is a fresh user gesture — use it.
    const onPointer = () => { void tryEnter(); };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('pointerdown', onPointer, { once: false });

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);
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
