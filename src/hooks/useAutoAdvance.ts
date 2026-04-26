import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tournament } from '@/types/db';

/**
 * When a tournament's level hits 0:00, automatically advance to the next level
 * (if `auto_advance` is on). To avoid two clients racing, we use a simple
 * compare-and-swap: only advance if the DB still shows the same `current_level`
 * we observed when we triggered.
 *
 * IMPORTANT: We deliberately do *not* optimistically patch local state. The
 * compare-and-swap can lose (another client already advanced), in which case
 * an optimistic `level_started_at = NOW` would show a fresh timer locally
 * that doesn't match the DB — when the next poll arrives, the timer snaps
 * to the real value. Instead, we patch local state only from the row the
 * DB *actually* wrote, so every view always agrees with the source of truth.
 *
 * Safe to mount on multiple screens (live + monitor + spectator) — only the
 * first writer wins, every other client's update returns 0 rows and is a no-op.
 */
export function useAutoAdvance(
  tournament: Tournament | null,
  msRemaining: number,
  patchTournament?: (patch: Partial<Tournament>) => void,
) {
  const triggeredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tournament) return;
    if (!tournament.auto_advance) return;
    if (tournament.state !== 'running') return;
    if (msRemaining > 0) return;

    // Tournament hit 0. Build a one-shot key so each level boundary fires once.
    const key = `${tournament.id}:${tournament.current_level}:${tournament.level_started_at ?? ''}`;
    if (triggeredKeyRef.current === key) return;
    triggeredKeyRef.current = key;

    const isFinalLevel = tournament.current_level >= tournament.blind_structure.length - 1;
    if (isFinalLevel) return;  // nothing to advance to

    const next = tournament.current_level + 1;
    const newStart = new Date().toISOString();

    // Compare-and-swap on the server. `.select()` returns the row only if the
    // .eq filters matched — i.e. we won the race. Patch local state only then,
    // using the row the DB actually committed.
    void supabase.from('tournaments')
      .update({
        current_level: next,
        level_started_at: newStart,
        pause_elapsed_ms: 0,
      })
      .eq('id', tournament.id)
      .eq('current_level', tournament.current_level)
      .eq('state', 'running')
      .select()
      .maybeSingle()
      .then(({ data }) => {
        if (data && patchTournament) patchTournament(data as Tournament);
        // If `data` is null we lost the race — do nothing. Realtime/polling
        // will deliver the actual DB state (whoever else advanced). The
        // local view stays consistent with the DB at all times.
      });
  }, [tournament, msRemaining, patchTournament]);
}
