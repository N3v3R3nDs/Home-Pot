import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tournament, TournamentPlayer } from '@/types/db';

export function useTournament(tournamentId: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<TournamentPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;

    const load = async () => {
      const [{ data: t }, { data: ps }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle(),
        supabase.from('tournament_players').select('*').eq('tournament_id', tournamentId).order('created_at'),
      ]);
      if (cancelled) return;
      setTournament(t as Tournament | null);
      setPlayers((ps ?? []) as TournamentPlayer[]);
      setLoading(false);
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

    // Hard safety net: poll every 3s. Realtime can silently drop events on
    // dodgy networks (TVs, sleeping tabs, public wifi), and any divergence
    // between the live and monitor views is jarring — both should always be
    // showing the same level/timer since they derive from the same DB row.
    // The poll is two cheap reads (single row + filtered players) and
    // guarantees views can't sit on stale data for more than ~3s.
    const pollId = setInterval(() => { if (!cancelled) void load(); }, 3_000);

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
