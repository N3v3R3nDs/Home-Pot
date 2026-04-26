import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tournament, TournamentPlayer } from '@/types/db';

// Module-level cache: rotating between live and monitor unmounts/remounts the
// hook, but the data is the same. Without this, every rotation flashed a
// "Loading…" spinner while we re-fetched what we already knew. Now re-mounts
// hydrate instantly from cache and the network refresh is silent.
interface CacheEntry { tournament: Tournament | null; players: TournamentPlayer[] }
const cache = new Map<string, CacheEntry>();

/**
 * Returns true if two tournament rows are equivalent on every field that
 * actually drives the UI. Used to skip setState calls during the polling
 * fallback so we don't trigger a render storm when nothing changed.
 */
function sameTournament(a: Tournament | null, b: Tournament | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.state === b.state
    && a.current_level === b.current_level
    && a.level_started_at === b.level_started_at
    && a.paused_at === b.paused_at
    && a.pause_elapsed_ms === b.pause_elapsed_ms
    && a.auto_advance === b.auto_advance
    && a.name === b.name
    && a.bounty_amount === b.bounty_amount
    && a.rake_percent === b.rake_percent
    && a.dealer_tip_percent === b.dealer_tip_percent
    && a.deleted_at === b.deleted_at
    && a.season_id === b.season_id;
}

function samePlayers(a: TournamentPlayer[], b: TournamentPlayer[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id) return false;
    if (x.eliminated_at !== y.eliminated_at) return false;
    if (x.finishing_position !== y.finishing_position) return false;
    if (x.buy_ins !== y.buy_ins) return false;
    if (x.rebuys !== y.rebuys) return false;
    if (x.addons !== y.addons) return false;
    if (x.bounties_won !== y.bounties_won) return false;
    if (x.prize !== y.prize) return false;
    if (x.guest_name !== y.guest_name) return false;
    if (x.profile_id !== y.profile_id) return false;
  }
  return true;
}

export function useTournament(tournamentId: string | undefined) {
  const cached = tournamentId ? cache.get(tournamentId) : undefined;
  const [tournament, setTournament] = useState<Tournament | null>(cached?.tournament ?? null);
  const [players, setPlayers] = useState<TournamentPlayer[]>(cached?.players ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    let lastLoadAt = 0;
    let inFlight: Promise<void> | null = null;

    const load = async (): Promise<void> => {
      // Coalesce: if a load is already in flight or one finished <500ms ago,
      // reuse / skip. Mount can otherwise fire 3-4 loads in quick succession
      // (initial + SUBSCRIBED echo + visibility focus + polling start).
      if (inFlight) return inFlight;
      if (Date.now() - lastLoadAt < 500) return;
      inFlight = (async () => {
        try {
          const [{ data: t }, { data: ps }] = await Promise.all([
            supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle(),
            supabase.from('tournament_players').select('*').eq('tournament_id', tournamentId).order('created_at'),
          ]);
          if (cancelled) return;
          const tournamentRow = t as Tournament | null;
          const playerRows = (ps ?? []) as TournamentPlayer[];
          // Skip state updates when nothing changed — avoids a render storm
          // every 3s from the polling fallback when the DB is idle.
          setTournament((prev) => sameTournament(prev, tournamentRow) ? prev : tournamentRow);
          setPlayers((prev) => samePlayers(prev, playerRows) ? prev : playerRows);
          cache.set(tournamentId, { tournament: tournamentRow, players: playerRows });
          setLoading(false);
        } finally {
          lastLoadAt = Date.now();
          inFlight = null;
        }
      })();
      return inFlight;
    };
    void load();

    const channel = supabase
      .channel(`tournament:${tournamentId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') setTournament(null);
          else setTournament(payload.new as Tournament);
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === 'INSERT') {
              const next = payload.new as TournamentPlayer;
              return prev.some((p) => p.id === next.id) ? prev : [...prev, next];
            }
            if (payload.eventType === 'UPDATE') return prev.map((p) => p.id === (payload.new as TournamentPlayer).id ? payload.new as TournamentPlayer : p);
            if (payload.eventType === 'DELETE') return prev.filter((p) => p.id !== (payload.old as TournamentPlayer).id);
            return prev;
          });
        })
      .subscribe((status) => {
        // When realtime reconnects after a drop, fetch a fresh snapshot — any
        // events that fired while we were disconnected were silently dropped.
        if (status === 'SUBSCRIBED' && !cancelled) void load();
      });

    // Resync on tab/window focus — covers a backgrounded monitor that slept
    // through realtime events, and the rotation handoff between live/monitor.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // Hard safety net poll — realtime can silently drop events on dodgy
    // networks (TVs, sleeping tabs, public wifi). 5s keeps views in sync
    // without saturating the API; the load() coalescer + sameX skip
    // suppresses re-renders when nothing actually changed.
    const pollId = setInterval(() => { if (!cancelled) void load(); }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  // Optimistic helpers — apply a partial patch locally so UI updates instantly.
  // The realtime echo a few hundred ms later is then idempotent.
  const patchTournament = (patch: Partial<Tournament>) => {
    setTournament((prev) => prev ? { ...prev, ...patch } : prev);
  };
  const patchPlayer = (id: string, patch: Partial<TournamentPlayer>) => {
    setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  };
  const removePlayer = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  };
  const addPlayer = (player: TournamentPlayer) => {
    setPlayers((prev) => prev.some((p) => p.id === player.id) ? prev : [...prev, player]);
  };

  return { tournament, players, loading, patchTournament, patchPlayer, removePlayer, addPlayer };
}
