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
    load();

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
            if (payload.eventType === 'INSERT') return [...prev, payload.new as TournamentPlayer];
            if (payload.eventType === 'UPDATE') return prev.map((p) => p.id === (payload.new as TournamentPlayer).id ? payload.new as TournamentPlayer : p);
            if (payload.eventType === 'DELETE') return prev.filter((p) => p.id !== (payload.old as TournamentPlayer).id);
            return prev;
          });
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [tournamentId]);

  return { tournament, players, loading };
}
