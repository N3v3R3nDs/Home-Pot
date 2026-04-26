import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tournament } from '@/types/db';

/**
 * When a tournament's level hits 0:00, automatically advance to the next level
 * (if `auto_advance` is on). To avoid two clients racing, we use a simple
 * compare-and-swap: only advance if the DB still shows the same `current_level`
 * and `level_started_at` we observed when we triggered.
 *
 * Safe to mount on multiple screens (live + monitor + spectator) — only one
 * actually wins the race; the others' updates become no-ops.
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
    // Optimistic local update
    patchTournament?.({
      current_level: next,
      level_started_at: newStart,
      pause_elapsed_ms: 0,
    });
    // Compare-and-swap on the server
    void supabase.from('tournaments')
      .update({
        current_level: next,
        level_started_at: newStart,
        pause_elapsed_ms: 0,
      })
      .eq('id', tournament.id)
      .eq('current_level', tournament.current_level)
      .eq('state', 'running');
  }, [tournament, msRemaining, patchTournament]);
}
