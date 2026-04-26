import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Health = 'live' | 'polling' | 'offline';

/**
 * Tiny realtime-health indicator. Tells the host at a glance whether the
 * monitor is receiving live updates or quietly catching up via polling.
 *
 * Green pulse = realtime SUBSCRIBED. Amber = awaiting realtime (polling
 * fallback). Red = offline / channel error.
 */
export function StatusPill({ topic }: { topic: string }) {
  const [health, setHealth] = useState<Health>('polling');

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setHealth('offline');
    }
    const ch = supabase.channel(`status:${topic}`)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setHealth('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setHealth('polling');
      });
    const onOffline = () => setHealth('offline');
    const onOnline = () => setHealth('polling');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [topic]);

  const dotColor = health === 'live'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
    : health === 'polling'
    ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
    : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]';
  const label = health === 'live' ? 'live' : health === 'polling' ? 'sync' : 'offline';

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-ink-400/80">
      <span className={`relative inline-block w-1.5 h-1.5 rounded-full ${dotColor}`}>
        {health === 'live' && (
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
        )}
      </span>
      {label}
    </span>
  );
}
