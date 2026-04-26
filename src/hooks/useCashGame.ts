import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CashBuyIn, CashGame, CashGamePlayer, Profile } from '@/types/db';

// Module-level cache so rotation between live and monitor doesn't show a
// "Loading…" flash on every remount. Hydrate instantly from cache; the
// network refresh happens silently in the background.
interface CashCacheEntry {
  game: CashGame | null;
  players: CashGamePlayer[];
  buyIns: CashBuyIn[];
  profileMap: Record<string, Profile>;
}
const cache = new Map<string, CashCacheEntry>();

function sameGame(a: CashGame | null, b: CashGame | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.state === b.state
    && a.name === b.name
    && a.small_blind === b.small_blind
    && a.big_blind === b.big_blind
    && a.join_code === b.join_code
    && a.season_id === b.season_id
    && a.deleted_at === b.deleted_at
    && a.ended_at === b.ended_at;
}
function samePlayers(a: CashGamePlayer[], b: CashGamePlayer[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id) return false;
    if (x.cash_out !== y.cash_out) return false;
    if (x.guest_name !== y.guest_name) return false;
    if (x.profile_id !== y.profile_id) return false;
  }
  return true;
}
function sameBuyIns(a: CashBuyIn[], b: CashBuyIn[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].amount !== b[i].amount) return false;
  }
  return true;
}

/**
 * Realtime cash-game data hook. Loads the game + its players + their buy-ins
 * and a profile lookup map, then subscribes to live changes on all three
 * tables. Mirrors the shape of `useTournament`.
 *
 * Used by CashGameLive (host control), CashGameMonitor (big-screen) and
 * PublicCashView (spectator).
 */
export function useCashGame(cashGameId: string | undefined) {
  const cached = cashGameId ? cache.get(cashGameId) : undefined;
  const [game, setGame] = useState<CashGame | null>(cached?.game ?? null);
  const [players, setPlayers] = useState<CashGamePlayer[]>(cached?.players ?? []);
  const [buyIns, setBuyIns] = useState<CashBuyIn[]>(cached?.buyIns ?? []);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>(cached?.profileMap ?? {});
  const [loading, setLoading] = useState(!cached);

  // Initial load + realtime subscription. We fetch a fresh snapshot whenever
  // we (re)mount or the tab becomes visible again, so stale data from a
  // backgrounded monitor / a missed realtime event always corrects itself.
  useEffect(() => {
    if (!cashGameId) return;
    let cancelled = false;
    let lastLoadAt = 0;
    let inFlight: Promise<void> | null = null;

    const fetchSnapshot = async (): Promise<void> => {
      // Coalesce overlapping fetch requests + throttle to >=500ms apart.
      if (inFlight) return inFlight;
      if (Date.now() - lastLoadAt < 500) return;
      inFlight = (async () => {
        try {
          const [{ data: g }, { data: ps }] = await Promise.all([
            supabase.from('cash_games').select('*').eq('id', cashGameId).maybeSingle(),
            supabase.from('cash_game_players').select('*').eq('cash_game_id', cashGameId).order('created_at'),
          ]);
          if (cancelled) return;
          const gameRow = g as CashGame | null;
          const playerRows = (ps ?? []) as CashGamePlayer[];
          setGame((prev) => sameGame(prev, gameRow) ? prev : gameRow);
          setPlayers((prev) => samePlayers(prev, playerRows) ? prev : playerRows);
          const playerIds = playerRows.map((p) => p.id);
          let buyInRows: CashBuyIn[] = [];
          if (playerIds.length) {
            const { data: bi } = await supabase.from('cash_buy_ins').select('*').in('cash_game_player_id', playerIds);
            if (cancelled) return;
            buyInRows = (bi ?? []) as CashBuyIn[];
            setBuyIns((prev) => sameBuyIns(prev, buyInRows) ? prev : buyInRows);
          } else {
            setBuyIns((prev) => prev.length === 0 ? prev : []);
          }
          const existing = cache.get(cashGameId);
          cache.set(cashGameId, {
            game: gameRow,
            players: playerRows,
            buyIns: buyInRows,
            profileMap: existing?.profileMap ?? {},
          });
          if (!cancelled) setLoading(false);
        } finally {
          lastLoadAt = Date.now();
          inFlight = null;
        }
      })();
      return inFlight;
    };
    void fetchSnapshot();

    const ch = supabase.channel(`cash:${cashGameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games', filter: `id=eq.${cashGameId}` },
        (p) => {
          if (p.eventType === 'DELETE') setGame(null);
          else setGame(p.new as CashGame);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_game_players', filter: `cash_game_id=eq.${cashGameId}` },
        (p) => {
          setPlayers((prev) => {
            if (p.eventType === 'INSERT') {
              const next = p.new as CashGamePlayer;
              return prev.some((x) => x.id === next.id) ? prev : [...prev, next];
            }
            if (p.eventType === 'UPDATE') return prev.map((x) => x.id === (p.new as CashGamePlayer).id ? (p.new as CashGamePlayer) : x);
            if (p.eventType === 'DELETE') return prev.filter((x) => x.id !== (p.old as CashGamePlayer).id);
            return prev;
          });
        })
      // Buy-in events arrive on every game in the realtime channel — we'll
      // filter to ones belonging to this game using the player list below.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_buy_ins' },
        (p) => {
          setBuyIns((prev) => {
            if (p.eventType === 'INSERT') {
              const next = p.new as CashBuyIn;
              return prev.some((x) => x.id === next.id) ? prev : [...prev, next];
            }
            if (p.eventType === 'UPDATE') return prev.map((x) => x.id === (p.new as CashBuyIn).id ? (p.new as CashBuyIn) : x);
            if (p.eventType === 'DELETE') return prev.filter((x) => x.id !== (p.old as CashBuyIn).id);
            return prev;
          });
        })
      .subscribe((status) => {
        // When realtime reconnects after a drop, fetch a fresh snapshot — any
        // events that fired while we were disconnected were silently dropped.
        if (status === 'SUBSCRIBED' && !cancelled) void fetchSnapshot();
      });

    // Resync on tab focus (handles a TV that briefly slept, or the live
    // making changes while we were on monitor). Realtime drops events on
    // disconnect, so a fresh snapshot is the safety net.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchSnapshot();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // Hard safety net: poll every 3s. Realtime can silently drop events on
    // dodgy networks (TV, public wifi). Live and monitor views must always
    // agree on counts/totals — both derive from the same DB rows — so the
    // worst-case divergence between any two views needs to be tiny.
    const pollId = setInterval(() => { if (!cancelled) void fetchSnapshot(); }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      supabase.removeChannel(ch);
    };
  }, [cashGameId]);

  // Keep profileMap in sync with the set of profile_ids we've seen — handles
  // late joins where a player with a profile_id is inserted after initial load.
  useEffect(() => {
    const need = players
      .map((p) => p.profile_id)
      .filter((id): id is string => !!id)
      .filter((id) => !(id in profileMap));
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('*').in('id', need);
      if (cancelled || !data) return;
      setProfileMap((prev) => {
        const next = { ...prev };
        for (const p of data as Profile[]) next[p.id] = p;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [players, profileMap]);

  // Drop buy-ins that don't belong to any of our players (stale entries from
  // the unfiltered realtime channel for other games).
  const playerIdSet = new Set(players.map((p) => p.id));
  const scopedBuyIns = buyIns.filter((b) => playerIdSet.has(b.cash_game_player_id));

  // Optimistic mutation helpers — same pattern as useTournament.
  const patchGame = (patch: Partial<CashGame>) => {
    setGame((prev) => prev ? { ...prev, ...patch } : prev);
  };
  const patchPlayer = (id: string, patch: Partial<CashGamePlayer>) => {
    setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  };
  const addPlayer = (player: CashGamePlayer) => {
    setPlayers((prev) => prev.some((p) => p.id === player.id) ? prev : [...prev, player]);
  };
  const addBuyIn = (bi: CashBuyIn) => {
    setBuyIns((prev) => prev.some((p) => p.id === bi.id) ? prev : [...prev, bi]);
  };

  return {
    game,
    players,
    buyIns: scopedBuyIns,
    profileMap,
    loading,
    patchGame,
    patchPlayer,
    addPlayer,
    addBuyIn,
  };
}
