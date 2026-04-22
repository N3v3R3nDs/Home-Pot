import { createClient } from '@supabase/supabase-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Resolve the Supabase URL at runtime so that the same built bundle works for
 * the host (on `localhost`) AND for friends opening the PWA via the host's LAN
 * IP. We only use the build-time URL if it's not pointing at localhost; in that
 * case we substitute whatever hostname the page is served from.
 */
function resolveSupabaseUrl(): string {
  if (typeof window !== 'undefined') {
    const pageHost = window.location.hostname;
    const isLocal = !pageHost || pageHost === 'localhost' || pageHost === '127.0.0.1';
    if (!isLocal) {
      return `${window.location.protocol}//${pageHost}:8000`;
    }
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
