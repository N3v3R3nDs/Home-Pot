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
 * Best-effort fullscreen for monitor views.
 *
 * - PWA standalone: no-op (already chrome-less).
 * - Regular tab: tries fullscreen *only* on `orientationchange` (a real user
 *   gesture). We deliberately do NOT install a global pointerdown listener —
 *   it ate user taps and could be interpreted as accidental UI interactions.
 *   We also do not request on mount; the first orientation transition (or
 *   the user's manual ⛶ button) will do it.
 * - Exits fullscreen on rotate to portrait so the orientation-redirect hook
 *   isn't trapped in a fullscreen viewport whose dimensions report portrait.
 */
export function useAutoFullscreen() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPwaStandalone()) return;

    const onOrientation = async () => {
      // Use the actual screen.orientation API when available — it's stable
      // across the fullscreen-induced resize storm. Inner-dimension fallback
      // for browsers that lack screen.orientation.
      const screenOrientation = (screen as Screen & { orientation?: { type?: string } }).orientation?.type;
      const isLandscape = screenOrientation
        ? screenOrientation.startsWith('landscape')
        : window.innerWidth >= window.innerHeight;
      try {
        if (isLandscape && !document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } else if (!isLandscape && document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        /* needs a user gesture or unsupported — silently fall back */
      }
    };

    window.addEventListener('orientationchange', onOrientation);
    return () => window.removeEventListener('orientationchange', onOrientation);
  }, []);
}

/**
 * Redirects to `destination` when the device rotates *into* `target` orientation.
 * Used to flip between live (portrait) and monitor (landscape) routes on phones —
 * the PWA's orientation lock has been removed in the manifest. Only fires on
 * actual transitions, so manual navigation in the "wrong" orientation is left alone.
 *
 * Uses the `screen.orientation` API (when available) instead of inner-dimensions
 * so the fullscreen-induced resize storm doesn't briefly classify the viewport
 * as the opposite orientation and trigger an unwanted navigation.
 */
export function useRedirectOnOrientation(target: 'landscape' | 'portrait', destination: string) {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const get = (): 'landscape' | 'portrait' => {
      const screenOrientation = (screen as Screen & { orientation?: { type?: string } }).orientation?.type;
      if (screenOrientation) return screenOrientation.startsWith('landscape') ? 'landscape' : 'portrait';
      return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    };
    let last = get();
    const update = () => {
      const next = get();
      if (next === last) return;
      last = next;
      if (next === target) navigate(destination, { replace: true });
    };
    window.addEventListener('orientationchange', update);
    return () => window.removeEventListener('orientationchange', update);
  }, [target, destination, navigate]);
}
