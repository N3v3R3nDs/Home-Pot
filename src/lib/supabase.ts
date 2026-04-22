import { createClient } from '@supabase/supabase-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Resolve the Supabase URL.
 *
 *  - If the build-time env URL is set to a *non-local* host (prod), use it
 *    verbatim — prod has Supabase on the same domain via Caddy on :443.
 *  - If the build-time env URL is missing or points at localhost (dev), and the
 *    PWA is being opened from a non-localhost host (LAN IP, e.g. 10.0.0.14),
 *    swap the host to whatever the page was served from + :8000 so friends
 *    can reach the dev box from their phones.
 *  - Otherwise fall back to the env URL or localhost.
 */
function resolveSupabaseUrl(): string {
  const envIsLocal = !envUrl || /localhost|127\.0\.0\.1/.test(envUrl);
  if (!envIsLocal) return envUrl as string;

  if (typeof window !== 'undefined') {
    const pageHost = window.location.hostname;
    const pageIsLocal = !pageHost || pageHost === 'localhost' || pageHost === '127.0.0.1';
    if (!pageIsLocal) return `${window.location.protocol}//${pageHost}:8000`;
  }
  return envUrl ?? 'http://localhost:8000';
}

if (!anon) {
  // eslint-disable-next-line no-console
  console.warn('[Home Pot] VITE_SUPABASE_ANON_KEY missing — auth/realtime will not work.');
}

export const supabase = createClient(resolveSupabaseUrl(), anon ?? 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
