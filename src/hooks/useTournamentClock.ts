import { useEffect, useState } from 'react';
import type { Tournament, BlindLevel } from '@/types/db';

export interface ClockSnapshot {
  /** 0-based index into blind_structure for the *current* level. */
  levelIndex: number;
  level: BlindLevel | null;
  /** Milliseconds remaining in the current level. */
  msRemaining: number;
  /** Total ms in the current level. */
  msLevelTotal: number;
}

/**
 * Computes the live tournament clock from server fields:
 *   level_started_at + pause_elapsed_ms + (paused_at ? frozen : ticking)
 * Updates 4× per second when running.
 */
export function useTournamentClock(tournament: Tournament | null): ClockSnapshot {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!tournament || tournament.state !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [tournament]);

  if (!tournament) return { levelIndex: 0, level: null, msRemaining: 0, msLevelTotal: 0 };

  const idx = Math.min(tournament.current_level, tournament.blind_structure.length - 1);
  const level = tournament.blind_structure[idx] ?? null;
  if (!level) return { levelIndex: idx, level: null, msRemaining: 0, msLevelTotal: 0 };

  const msLevelTotal = level.durationMin * 60_000;
  const startedAt = tournament.level_started_at ? Date.parse(tournament.level_started_at) : null;

  let elapsed: number;
  if (!startedAt) {
    elapsed = 0;
  } else if (tournament.state === 'paused' && tournament.paused_at) {
    elapsed = Date.parse(tournament.paused_at) - startedAt - tournament.pause_elapsed_ms;
  } else {
    elapsed = now - startedAt - tournament.pause_elapsed_ms;
  }

  const msRemaining = Math.max(0, msLevelTotal - elapsed);
  return { levelIndex: idx, level, msRemaining, msLevelTotal };
}
