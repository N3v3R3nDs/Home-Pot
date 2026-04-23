import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { formatMoney } from '@/lib/format';
import type {
  CashBuyIn, CashGame, CashGamePlayer, Profile, Tournament, TournamentPlayer,
} from '@/types/db';

interface MemberRollup {
  id: string;
  name: string;
  avatar: string;
  tournamentCashes: number;
  tournamentWins: number;
  knockouts: number;
  cashSessions: number;
  netNok: number;
}

type Tab = 'season' | 'tournaments' | 'cash';

export function History() {
  const { currency } = useSettings();
  const [tab, setTab] = useState<Tab>('season');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournPlayers, setTournPlayers] = useState<TournamentPlayer[]>([]);
  const [cashGames, setCashGames] = useState<CashGame[]>([]);
  const [cashPlayers, setCashPlayers] = useState<CashGamePlayer[]>([]);
  const [cashBuyIns, setCashBuyIns] = useState<CashBuyIn[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});

  useEffect(() => {
    const load = async () => {
      const [{ data: tours }, { data: cgs }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('state', 'finished').order('created_at', { ascending: false }),
        supabase.from('cash_games').select('*').eq('state', 'finished').order('created_at', { ascending: false }),
      ]);
      const ts = (tours ?? []) as Tournament[];
      const cs = (cgs ?? []) as CashGame[];
      setTournaments(ts); setCashGames(cs);

      const tIds = ts.map((x) => x.id);
      const cIds = cs.map((x) => x.id);
      const [{ data: tp }, { data: cp }] = await Promise.all([
        tIds.length ? supabase.from('tournament_players').select('*').in('tournament_id', tIds) : Promise.resolve({ data: [] }),
        cIds.length ? supabase.from('cash_game_players').select('*').in('cash_game_id', cIds) : Promise.resolve({ data: [] }),
      ]);
      setTournPlayers((tp ?? []) as TournamentPlayer[]);
      setCashPlayers((cp ?? []) as CashGamePlayer[]);

      const cpIds = (cp ?? []).map((x) => x.id);
      if (cpIds.length) {
        const { data: bi } = await supabase.from('cash_buy_ins').select('*').in('cash_game_player_id', cpIds);
        setCashBuyIns((bi ?? []) as CashBuyIn[]);
      }
      const profIds = [
        ...(tp ?? []).map((p) => p.profile_id),
        ...(cp ?? []).map((p) => p.profile_id),
      ].filter(Boolean) as string[];
      if (profIds.length) {
        const { data: profs } = await supabase.from('profiles').select('*').in('id', Array.from(new Set(profIds)));
        setProfileMap(Object.fromEntries((profs ?? []).map((p) => [p.id, p as Profile])));
      }
    };
    load();

    // Realtime: any state change on tournaments/cash games or any update to
    // their players/buy-ins triggers a fresh load. Cheap and correct — the
    // history page is rarely open and full reloads are well under a second.
    const ch = supabase.channel('history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_game_players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_buy_ins' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const memberKey = (p: { profile_id?: string | null; guest_name?: string | null }) =>
    p.profile_id ? `p:${p.profile_id}` : `g:${p.guest_name}`;

  const seasonRollup: MemberRollup[] = useMemo(() => {
    const map: Record<string, MemberRollup> = {};
    const ensure = (key: string, name: string, avatar: string): MemberRollup => {
      if (!map[key]) map[key] = { id: key, name, avatar, tournamentCashes: 0, tournamentWins: 0, knockouts: 0, cashSessions: 0, netNok: 0 };
      return map[key];
    };
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    for (const p of tournPlayers) {
      const t = tMap.get(p.tournament_id); if (!t) continue;
      const k = memberKey(p);
      const name = p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
      const avatar = p.profile_id ? profileMap[p.profile_id]?.avatar_emoji ?? '🃏' : '👤';
      const r = ensure(k, name, avatar);
      const spent = p.buy_ins * t.buy_in + p.rebuys * (t.rebuy_amount ?? 0) + p.addons * (t.addon_amount ?? 0);
      const bountyEarn = p.bounties_won * t.bounty_amount;
      r.netNok += (p.prize ?? 0) + bountyEarn - spent;
      if (p.prize > 0) r.tournamentCashes += 1;
      if (p.finishing_position === 1) r.tournamentWins += 1;
      r.knockouts += p.bounties_won;
    }
    const buyInTotals: Record<string, number> = {};
    for (const b of cashBuyIns) buyInTotals[b.cash_game_player_id] = (buyInTotals[b.cash_game_player_id] ?? 0) + Number(b.amount);
    for (const cp of cashPlayers) {
      const k = memberKey(cp);
      const name = cp.profile_id ? profileMap[cp.profile_id]?.display_name ?? '…' : (cp.guest_name ?? 'Guest');
      const avatar = cp.profile_id ? profileMap[cp.profile_id]?.avatar_emoji ?? '🃏' : '👤';
      const r = ensure(k, name, avatar);
      const cIn = buyInTotals[cp.id] ?? 0;
      const cOut = cp.cash_out ?? 0;
      r.netNok += cOut - cIn;
      r.cashSessions += 1;
    }
    return Object.values(map).sort((a, b) => b.netNok - a.netNok);
  }, [tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap]);

  const cashRows = useMemo(() => {
    const buyInTotals: Record<string, number> = {};
    for (const b of cashBuyIns) buyInTotals[b.cash_game_player_id] = (buyInTotals[b.cash_game_player_id] ?? 0) + Number(b.amount);
    return cashGames.map((g) => {
      const ps = cashPlayers.filter((p) => p.cash_game_id === g.id);
      const totalIn = ps.reduce((s, p) => s + (buyInTotals[p.id] ?? 0), 0);
      const totalOut = ps.reduce((s, p) => s + (p.cash_out ?? 0), 0);
      const winner = ps
        .map((p) => ({ p, net: (p.cash_out ?? 0) - (buyInTotals[p.id] ?? 0) }))
        .sort((a, b) => b.net - a.net)[0];
      return {
        game: g,
        players: ps.length,
        totalIn,
        totalOut,
        winnerName: winner ? (winner.p.profile_id ? profileMap[winner.p.profile_id]?.display_name ?? '…' : winner.p.guest_name ?? 'Guest') : '—',
        winnerNet: winner?.net ?? 0,
      };
    });
  }, [cashGames, cashPlayers, cashBuyIns, profileMap]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl text-brass-shine">Season stats</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {(['season', 'tournaments', 'cash'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2 rounded-xl text-sm font-semibold uppercase tracking-wider border ${
              tab === t ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-300'
            }`}
          >
            {t === 'season' ? 'Leaderboard' : t === 'tournaments' ? 'Tournaments' : 'Cash games'}
          </button>
        ))}
      </div>

      {tab === 'season' && (
        seasonRollup.length === 0 ? (
          <Card className="text-center py-10 text-ink-400">No completed games yet — go play.</Card>
        ) : (
          <Card>
            <ul className="divide-y divide-felt-800">
              {seasonRollup.map((m, i) => (
                <li key={m.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-2xl text-brass-200 w-8 text-center">{i + 1}</span>
                    <span className="text-xl">{m.avatar}</span>
                    <div>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-ink-400">
                        {m.tournamentWins > 0 && `🏆 ${m.tournamentWins} · `}
                        {m.tournamentCashes > 0 && `💰 ${m.tournamentCashes} · `}
                        {m.knockouts > 0 && `💀 ${m.knockouts} · `}
                        {m.cashSessions > 0 && `🪑 ${m.cashSessions}`}
                      </div>
                    </div>
                  </div>
                  <div className={`font-mono ${m.netNok > 0 ? 'text-emerald-400' : m.netNok < 0 ? 'text-red-400' : 'text-ink-200'}`}>
                    {m.netNok >= 0 ? '+' : ''}{formatMoney(m.netNok, currency)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      )}

      {tab === 'tournaments' && (
        tournaments.length === 0 ? (
          <Card className="text-center py-10 text-ink-400">No completed tournaments.</Card>
        ) : (
          <Card>
            <ul className="space-y-2">
              {tournaments.map((t) => {
                const ps = tournPlayers.filter((p) => p.tournament_id === t.id);
                const winner = ps.find((p) => p.finishing_position === 1);
                const pool = ps.reduce((s, p) => s + p.buy_ins * t.buy_in + p.rebuys * (t.rebuy_amount ?? 0) + p.addons * (t.addon_amount ?? 0), 0);
                return (
                  <li key={t.id} className="bg-felt-950/60 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{t.name}</div>
                      <div className="font-mono text-brass-200">{formatMoney(pool, t.currency)}</div>
                    </div>
                    <div className="text-xs text-ink-400 mt-1">
                      {new Date(t.created_at).toLocaleDateString('nb-NO')} · {ps.length} players · 🏆 {winner ? (winner.profile_id ? profileMap[winner.profile_id]?.display_name : winner.guest_name) ?? '—' : '—'}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )
      )}

      {tab === 'cash' && (
        cashGames.length === 0 ? (
          <Card className="text-center py-10 text-ink-400">No completed cash games.</Card>
        ) : (
          <Card>
            <ul className="space-y-2">
              {cashRows.map((r) => (
                <li key={r.game.id} className="bg-felt-950/60 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{r.game.name}</div>
                    <div className="font-mono text-brass-200">{formatMoney(r.totalIn, r.game.currency)}</div>
                  </div>
                  <div className="text-xs text-ink-400 mt-1">
                    {new Date(r.game.created_at).toLocaleDateString('nb-NO')} · {r.players} players · top: <b className="text-emerald-400">{r.winnerName}</b> {r.winnerNet > 0 && `+${formatMoney(r.winnerNet, r.game.currency)}`}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      )}
    </div>
  );
}
