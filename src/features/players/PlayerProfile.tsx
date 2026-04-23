import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { formatMoney, formatPlace } from '@/lib/format';
import type { CashBuyIn, CashGame, CashGamePlayer, Profile, Tournament, TournamentPlayer } from '@/types/db';

/** Profile / stats page for a single member. Pulls all of their tournament +
 *  cash-game history and rolls up wins, ROI, knockouts, biggest win. */
export function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const { currency } = useSettings();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tournPlayers, setTournPlayers] = useState<TournamentPlayer[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [cashPlayers, setCashPlayers] = useState<CashGamePlayer[]>([]);
  const [cashGames, setCashGames] = useState<CashGame[]>([]);
  const [cashBuyIns, setCashBuyIns] = useState<CashBuyIn[]>([]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [{ data: prof }, { data: tps }, { data: cps }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('tournament_players').select('*').eq('profile_id', id),
        supabase.from('cash_game_players').select('*').eq('profile_id', id),
      ]);
      setProfile(prof as Profile | null);
      setTournPlayers((tps ?? []) as TournamentPlayer[]);
      setCashPlayers((cps ?? []) as CashGamePlayer[]);

      const tIds = (tps ?? []).map((p) => p.tournament_id);
      const cIds = (cps ?? []).map((p) => p.cash_game_id);
      const cpIds = (cps ?? []).map((p) => p.id);
      const [{ data: tours }, { data: cgs }, { data: bis }] = await Promise.all([
        tIds.length ? supabase.from('tournaments').select('*').in('id', tIds) : Promise.resolve({ data: [] }),
        cIds.length ? supabase.from('cash_games').select('*').in('id', cIds) : Promise.resolve({ data: [] }),
        cpIds.length ? supabase.from('cash_buy_ins').select('*').in('cash_game_player_id', cpIds) : Promise.resolve({ data: [] }),
      ]);
      setTournaments((tours ?? []) as Tournament[]);
      setCashGames((cgs ?? []) as CashGame[]);
      setCashBuyIns((bis ?? []) as CashBuyIn[]);
    };
    load();
    const ch = supabase.channel(`player:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `profile_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_game_players', filter: `profile_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const stats = useMemo(() => {
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    const cMap = new Map(cashGames.map((c) => [c.id, c]));
    const buyInTotals: Record<string, number> = {};
    for (const b of cashBuyIns) buyInTotals[b.cash_game_player_id] = (buyInTotals[b.cash_game_player_id] ?? 0) + Number(b.amount);

    let netNok = 0;
    let tournPlayed = 0, tournCashed = 0, tournWon = 0;
    let totalKO = 0;
    let cashSessions = 0;
    let bestSingleWin = 0;

    for (const p of tournPlayers) {
      const t = tMap.get(p.tournament_id); if (!t) continue;
      // only count finished tournaments in stats
      if (t.state !== 'finished') continue;
      tournPlayed += 1;
      const spent = p.buy_ins * Number(t.buy_in)
        + p.rebuys * Number(t.rebuy_amount ?? 0)
        + p.addons * Number(t.addon_amount ?? 0);
      const bountyEarn = p.bounties_won * Number(t.bounty_amount);
      const net = (Number(p.prize) ?? 0) + bountyEarn - spent;
      netNok += net;
      if (Number(p.prize) > 0) tournCashed += 1;
      if (p.finishing_position === 1) tournWon += 1;
      totalKO += p.bounties_won;
      if (net > bestSingleWin) bestSingleWin = net;
    }
    for (const cp of cashPlayers) {
      const g = cMap.get(cp.cash_game_id); if (!g) continue;
      if (g.state !== 'finished') continue;
      cashSessions += 1;
      const cIn = buyInTotals[cp.id] ?? 0;
      const cOut = Number(cp.cash_out ?? 0);
      const net = cOut - cIn;
      netNok += net;
      if (net > bestSingleWin) bestSingleWin = net;
    }
    return { netNok, tournPlayed, tournCashed, tournWon, totalKO, cashSessions, bestSingleWin };
  }, [tournPlayers, cashPlayers, tournaments, cashGames, cashBuyIns]);

  const tournResults = useMemo(() => {
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    return tournPlayers
      .map((p) => ({ p, t: tMap.get(p.tournament_id) }))
      .filter((x) => x.t && x.t.state === 'finished')
      .sort((a, b) => Date.parse(b.t!.created_at) - Date.parse(a.t!.created_at));
  }, [tournPlayers, tournaments]);

  if (!profile) return <div className="text-ink-300">Loading…</div>;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link to="/history" className="text-ink-400 text-2xl">←</Link>
        <span className="text-3xl">{profile.avatar_emoji ?? '🃏'}</span>
        <div>
          <h1 className="font-display text-3xl text-brass-shine leading-tight">{profile.display_name}</h1>
          <p className="text-xs text-ink-400">since {new Date(profile.created_at).toLocaleDateString('nb-NO')}</p>
        </div>
      </header>

      <Card className="bg-felt-radial text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-brass-300">All-time net</div>
        <motion.div
          key={stats.netNok}
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`font-display text-5xl mt-1 tabular-nums ${
            stats.netNok > 0 ? 'text-emerald-400' : stats.netNok < 0 ? 'text-red-400' : 'text-ink-200'
          }`}
        >
          {stats.netNok >= 0 ? '+' : ''}{formatMoney(stats.netNok, currency)}
        </motion.div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <MicroStat label="🏆" value={stats.tournWon} sub="wins" />
        <MicroStat label="💰" value={stats.tournCashed} sub={`of ${stats.tournPlayed}`} />
        <MicroStat label="💀" value={stats.totalKO} sub="knockouts" />
        <MicroStat label="🪑" value={stats.cashSessions} sub="cash" />
        <MicroStat
          label="🚀"
          value={stats.bestSingleWin > 0 ? formatMoney(stats.bestSingleWin, currency) : '—'}
          sub="best night"
        />
        <MicroStat
          label="📊"
          value={stats.tournPlayed > 0
            ? `${Math.round((stats.tournCashed / stats.tournPlayed) * 100)}%`
            : '—'}
          sub="cash rate"
        />
      </div>

      <Card>
        <p className="label">Tournaments</p>
        {tournResults.length === 0 ? (
          <p className="text-ink-400 text-sm">No finished tournaments yet.</p>
        ) : (
          <ul className="divide-y divide-felt-800">
            {tournResults.map(({ p, t }) => (
              <li key={p.id}>
                <Link to={`/tournament/${t!.id}`} className="flex items-center justify-between py-2 hover:bg-felt-900/40 rounded-lg px-1 -mx-1">
                  <div>
                    <div className="font-semibold text-sm">{t!.name}</div>
                    <div className="text-[11px] text-ink-400">
                      {new Date(t!.created_at).toLocaleDateString('nb-NO')}
                      {p.finishing_position && ` · ${formatPlace(p.finishing_position)}`}
                      {p.bounties_won > 0 && ` · 💀 ${p.bounties_won}`}
                    </div>
                  </div>
                  <span className={`font-mono text-sm ${
                    Number(p.prize) > 0 ? 'text-emerald-400' : 'text-ink-400'
                  }`}>
                    {Number(p.prize) > 0 ? '+' : ''}{formatMoney(Number(p.prize), t!.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MicroStat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="card-felt p-3 text-center">
      <div className="text-2xl leading-none">{label}</div>
      <div className="font-display text-xl text-brass-shine tabular-nums mt-1">{value}</div>
      <div className="text-[10px] text-ink-400 mt-0.5">{sub}</div>
    </div>
  );
}
