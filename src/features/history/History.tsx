import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { useSeason } from '@/store/season';
import type { Season } from '@/types/db';
import { formatMoney } from '@/lib/format';
import { NumberInput } from '@/components/ui/NumberInput';
import { useConfirm } from '@/components/ui/Confirm';
import { useToast } from '@/components/ui/Toast';
import { StatsCharts } from './Charts';
import { SeasonPotCard } from './SeasonPotCard';
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

const MONTH_FILTERS: { id: string; label: string; daysBack?: number }[] = [
  { id: 'all',  label: 'All time' },
  { id: 'm',    label: 'This month',  daysBack: 30 },
  { id: '3m',   label: '3 months',    daysBack: 90 },
  { id: '12m',  label: 'Year',        daysBack: 365 },
];

const cutoffForPeriod = (id: string): number => {
  const days = MONTH_FILTERS.find((f) => f.id === id)?.daysBack;
  return days ? Date.now() - days * 86400000 : 0;
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function History() {
  const { currency } = useSettings();
  const { activeSeasonId, setActiveSeasonId } = useSeason();
  const confirm = useConfirm();
  const [seasons, setSeasons] = useState<Season[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('seasons').select('*').order('starts_on', { ascending: false });
      setSeasons((data ?? []) as Season[]);
    };
    load();
    const ch = supabase.channel(`history-seasons:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seasons' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  const toast = useToast();
  const [editingTour, setEditingTour] = useState<string | null>(null);
  const [prizeDraft, setPrizeDraft] = useState<Record<string, number>>({});
  const [posDraft, setPosDraft] = useState<Record<string, number | null>>({});

  const openPrizeEdit = (tournamentId: string, currentPlayers: TournamentPlayer[]) => {
    const prize: Record<string, number> = {};
    const pos: Record<string, number | null> = {};
    for (const p of currentPlayers) {
      prize[p.id] = Number(p.prize ?? 0);
      pos[p.id] = p.finishing_position;
    }
    setPrizeDraft(prize);
    setPosDraft(pos);
    setEditingTour(tournamentId);
  };
  const savePrizes = async () => {
    if (!editingTour) return;
    const ids = new Set([...Object.keys(prizeDraft), ...Object.keys(posDraft)]);
    const updates = Array.from(ids).map((id) =>
      supabase.from('tournament_players')
        .update({
          prize: Number(prizeDraft[id] ?? 0),
          finishing_position: posDraft[id] ?? null,
        })
        .eq('id', id),
    );
    const results = await Promise.all(updates);
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) {
      // Surface the actual error so silent failures stop being silent.
      const msg = results.find((r) => r.error)?.error?.message ?? 'unknown error';
      // eslint-disable-next-line no-console
      console.error('[History] savePrizes failed:', results.filter((r) => r.error).map((r) => r.error));
      toast(`${failed} update${failed === 1 ? '' : 's'} failed: ${msg}`, 'error');
    } else {
      toast('Prizes updated ✓', 'success');
    }
    setEditingTour(null);
  };
  const [tab, setTab] = useState<Tab>('season');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<string>('all');

  const deleteTournament = async (id: string, name: string) => {
    if (!await confirm({
      title: `Delete "${name}"?`,
      message: 'This removes the tournament from history. Bank transactions are kept in the ledger.',
      confirmLabel: '🗑 Delete',
      destructive: true,
    })) return;
    await supabase.from('tournaments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  };
  const deleteCashGame = async (id: string, name: string) => {
    if (!await confirm({
      title: `Delete "${name}"?`,
      message: 'This removes the cash game from history. Bank transactions are preserved.',
      confirmLabel: '🗑 Delete',
      destructive: true,
    })) return;
    await supabase.from('cash_games').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  };
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournPlayers, setTournPlayers] = useState<TournamentPlayer[]>([]);
  const [cashGames, setCashGames] = useState<CashGame[]>([]);
  const [cashPlayers, setCashPlayers] = useState<CashGamePlayer[]>([]);
  const [cashBuyIns, setCashBuyIns] = useState<CashBuyIn[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});

  useEffect(() => {
    let cancelled = false;

    // Initial fetch — fully parallel; all related queries fire at once and
    // stitched together when they all return.
    const initialLoad = async () => {
      let tq = supabase.from('tournaments').select('*').is('deleted_at', null).eq('state', 'finished').order('created_at', { ascending: false });
      let cq = supabase.from('cash_games').select('*').is('deleted_at', null).eq('state', 'finished').order('created_at', { ascending: false });
      if (activeSeasonId) { tq = tq.eq('season_id', activeSeasonId); cq = cq.eq('season_id', activeSeasonId); }

      const [{ data: tours }, { data: cgs }] = await Promise.all([tq, cq]);
      if (cancelled) return;
      const ts = (tours ?? []) as Tournament[];
      const cs = (cgs ?? []) as CashGame[];
      setTournaments(ts); setCashGames(cs);

      const tIds = ts.map((x) => x.id);
      const cIds = cs.map((x) => x.id);
      // ALL detail fetches in parallel (was sequential, slow).
      const [{ data: tp }, { data: cp }, { data: profs0 }] = await Promise.all([
        tIds.length ? supabase.from('tournament_players').select('*').in('tournament_id', tIds) : Promise.resolve({ data: [] }),
        cIds.length ? supabase.from('cash_game_players').select('*').in('cash_game_id', cIds) : Promise.resolve({ data: [] }),
        supabase.from('profiles').select('*'),
      ]);
      if (cancelled) return;
      setTournPlayers((tp ?? []) as TournamentPlayer[]);
      setCashPlayers((cp ?? []) as CashGamePlayer[]);
      setProfileMap(Object.fromEntries((profs0 ?? []).map((p) => [p.id, p as Profile])));

      const cpIds = (cp ?? []).map((x) => x.id);
      if (cpIds.length) {
        const { data: bi } = await supabase.from('cash_buy_ins').select('*').in('cash_game_player_id', cpIds);
        if (!cancelled) setCashBuyIns((bi ?? []) as CashBuyIn[]);
      }
    };
    initialLoad();

    // Realtime — reconcile from each event payload directly. No re-fetch.
    // This makes "End tournament" appear in History within ~50ms of the click
    // (just the ws round-trip), instead of waiting for 4-5 sequential queries.
    const matchSeason = <T extends { season_id: string | null }>(row: T) =>
      !activeSeasonId || row.season_id === activeSeasonId;

    const ch = supabase.channel(`history:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, (p) => {
        const row = (p.new ?? p.old) as Tournament;
        setTournaments((prev) => {
          const without = prev.filter((x) => x.id !== row.id);
          if (p.eventType === 'DELETE') return without;
          // Include only finished + not deleted + matching season
          if ((row as Tournament).state === 'finished'
              && !(row as Tournament).deleted_at
              && matchSeason(row as Tournament)) {
            return [row as Tournament, ...without].sort(
              (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
            );
          }
          return without;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games' }, (p) => {
        const row = (p.new ?? p.old) as CashGame;
        setCashGames((prev) => {
          const without = prev.filter((x) => x.id !== row.id);
          if (p.eventType === 'DELETE') return without;
          if ((row as CashGame).state === 'finished'
              && !(row as CashGame).deleted_at
              && matchSeason(row as CashGame)) {
            return [row as CashGame, ...without].sort(
              (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
            );
          }
          return without;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players' }, (p) => {
        const row = (p.new ?? p.old) as TournamentPlayer;
        setTournPlayers((prev) => {
          if (p.eventType === 'DELETE') return prev.filter((x) => x.id !== row.id);
          const i = prev.findIndex((x) => x.id === row.id);
          if (i === -1) return [...prev, row];
          const next = prev.slice(); next[i] = row; return next;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_game_players' }, (p) => {
        const row = (p.new ?? p.old) as CashGamePlayer;
        setCashPlayers((prev) => {
          if (p.eventType === 'DELETE') return prev.filter((x) => x.id !== row.id);
          const i = prev.findIndex((x) => x.id === row.id);
          if (i === -1) return [...prev, row];
          const next = prev.slice(); next[i] = row; return next;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_buy_ins' }, (p) => {
        const row = (p.new ?? p.old) as CashBuyIn;
        setCashBuyIns((prev) => {
          if (p.eventType === 'DELETE') return prev.filter((x) => x.id !== row.id);
          const i = prev.findIndex((x) => x.id === row.id);
          if (i === -1) return [...prev, row];
          const next = prev.slice(); next[i] = row; return next;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => {
        const row = (p.new ?? p.old) as Profile;
        setProfileMap((prev) => {
          const next = { ...prev };
          if (p.eventType === 'DELETE') delete next[row.id];
          else next[row.id] = row;
          return next;
        });
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [activeSeasonId]);

  const memberKey = (p: { profile_id?: string | null; guest_name?: string | null }) =>
    p.profile_id ? `p:${p.profile_id}` : `g:${p.guest_name}`;

  const seasonRollup: MemberRollup[] = useMemo(() => {
    const periodCutoff = cutoffForPeriod(period);
    const map: Record<string, MemberRollup> = {};
    const ensure = (key: string, name: string, avatar: string): MemberRollup => {
      if (!map[key]) map[key] = { id: key, name, avatar, tournamentCashes: 0, tournamentWins: 0, knockouts: 0, cashSessions: 0, netNok: 0 };
      return map[key];
    };
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    const inPeriod = (iso: string) => !periodCutoff || Date.parse(iso) >= periodCutoff;
    for (const p of tournPlayers) {
      const t = tMap.get(p.tournament_id); if (!t) continue;
      if (!inPeriod(t.created_at)) continue;
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
    const cMap = new Map(cashGames.map((c) => [c.id, c]));
    const buyInTotals: Record<string, number> = {};
    for (const b of cashBuyIns) buyInTotals[b.cash_game_player_id] = (buyInTotals[b.cash_game_player_id] ?? 0) + Number(b.amount);
    for (const cp of cashPlayers) {
      const g = cMap.get(cp.cash_game_id); if (!g) continue;
      if (!inPeriod(g.created_at)) continue;
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
  }, [tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap, period]);

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

  const filteredLeaderboard = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seasonRollup.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [seasonRollup, search]);

  const exportLeaderboardCsv = () => {
    downloadCsv(`home-pot-leaderboard-${new Date().toISOString().slice(0,10)}.csv`, [
      ['Rank', 'Name', 'Tournament wins', 'Tournament cashes', 'Knockouts', 'Cash sessions', 'Net'],
      ...filteredLeaderboard.map((m, i) => [i + 1, m.name, m.tournamentWins, m.tournamentCashes, m.knockouts, m.cashSessions, m.netNok]),
    ]);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="font-display text-3xl text-brass-shine">Season stats</h1>
        <button onClick={exportLeaderboardCsv} className="btn-ghost text-xs !px-3 !py-2" title="Export CSV">⬇ CSV</button>
      </header>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member…"
          className="input flex-1 text-sm"
        />
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="input w-auto text-sm"
        >
          {MONTH_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      {seasons.length > 0 && (
        <div>
          <select
            value={activeSeasonId ?? ''}
            onChange={(e) => setActiveSeasonId(e.target.value || null)}
            className="input w-full text-sm"
          >
            <option value="">🌐 All seasons (everything)</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                🏷 {s.name} ({new Date(s.starts_on).toLocaleDateString('nb-NO')} – {new Date(s.ends_on).toLocaleDateString('nb-NO')})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Modern segmented control: single pill container, active tab has a
          brass-glow background that animates between positions via framer's
          shared-layout. Icons + tight labels keep widths even and stop the
          "CASH GAMES" wrap that the old uppercase grid produced. */}
      <div className="relative inline-flex w-full bg-felt-900/60 border border-felt-700 rounded-2xl p-1">
        {(['season', 'tournaments', 'cash'] as Tab[]).map((id) => {
          const active = tab === id;
          const label = id === 'season' ? 'Leaderboard' : id === 'tournaments' ? 'Tournaments' : 'Cash';
          const icon = id === 'season' ? '🏆' : id === 'tournaments' ? '🃏' : '💵';
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                active ? 'text-brass-100' : 'text-ink-300 hover:text-ink-100'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="history-tab-pill"
                  className="absolute inset-0 rounded-xl bg-brass-500/20 border border-brass-500/40 shadow-glow"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative flex items-center justify-center gap-1.5">
                <span className="text-base">{icon}</span>
                <span className="truncate">{label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'season' && (
        <SeasonPotCard
          tournaments={tournaments}
          tournPlayers={tournPlayers}
          profileMap={profileMap}
        />
      )}

      {tab === 'season' && (
        <StatsCharts
          tournaments={tournaments}
          tournPlayers={tournPlayers}
          cashGames={cashGames}
          cashPlayers={cashPlayers}
          cashBuyIns={cashBuyIns}
          profileMap={profileMap}
        />
      )}

      {tab === 'season' && (
        filteredLeaderboard.length === 0 ? (
          <Card className="text-center py-10 text-ink-400">No completed games yet — go play.</Card>
        ) : (
          <Card>
            <ul className="divide-y divide-felt-800">
              {filteredLeaderboard.map((m, i) => {
                const profileId = m.id.startsWith('p:') ? m.id.slice(2) : null;
                const inner = (
                  <>
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
                  </>
                );
                return (
                  <li key={m.id} className="flex">
                    {profileId ? (
                      <Link to={`/player/${profileId}`} className="flex items-center justify-between py-3 flex-1 hover:bg-felt-900/40 -mx-2 px-2 rounded-lg">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between py-3 flex-1">{inner}</div>
                    )}
                  </li>
                );
              })}
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
                const expanded = editingTour === t.id;
                // Show *every* player so the host can assign positions/prizes
                // even to people who didn't get a finishing_position via the
                // bust flow (e.g. tournament ended early, or a manual call).
                const sortedAll = [...ps].sort((a, b) => {
                  const ap = posDraft[a.id] ?? a.finishing_position ?? 9999;
                  const bp = posDraft[b.id] ?? b.finishing_position ?? 9999;
                  if (ap !== bp) return ap - bp;
                  const an = a.profile_id ? profileMap[a.profile_id]?.display_name ?? '' : (a.guest_name ?? '');
                  const bn = b.profile_id ? profileMap[b.profile_id]?.display_name ?? '' : (b.guest_name ?? '');
                  return an.localeCompare(bn);
                });
                return (
                  <li key={t.id} className="bg-felt-950/60 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => expanded ? setEditingTour(null) : openPrizeEdit(t.id, ps)}
                        className="font-semibold flex-1 truncate text-left hover:text-brass-200"
                      >{expanded ? '▾' : '▸'} {t.name}</button>
                      <div className="font-mono text-brass-200">{formatMoney(pool, t.currency)}</div>
                      <button
                        onClick={() => expanded ? setEditingTour(null) : openPrizeEdit(t.id, ps)}
                        className="text-brass-300/70 hover:text-brass-200 px-2 py-1 text-base leading-none"
                        title="Edit prizes"
                      >✏️</button>
                      <button
                        onClick={() => deleteTournament(t.id, t.name)}
                        className="text-red-400/60 hover:text-red-400 px-2 py-1 text-lg leading-none"
                        title="Delete from history"
                      >🗑</button>
                    </div>
                    <div className="text-xs text-ink-400 mt-1">
                      {new Date(t.created_at).toLocaleDateString('nb-NO')} · {ps.length} players · 🏆 {winner ? (winner.profile_id ? profileMap[winner.profile_id]?.display_name : winner.guest_name) ?? '—' : '—'}
                    </div>

                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-felt-800 space-y-2">
                        <div className="text-[10px] uppercase tracking-widest text-brass-300 flex items-center justify-between">
                          <span>Edit positions & prizes</span>
                          <span className="text-ink-400 normal-case tracking-normal">tap any field to change</span>
                        </div>
                        {sortedAll.map((p) => {
                          const name = p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
                          return (
                            <div key={p.id} className="flex items-center gap-2">
                              <div className="w-14">
                                <NumberInput
                                  value={posDraft[p.id] ?? 0}
                                  min={0}
                                  placeholder="—"
                                  onValueChange={(n) => setPosDraft({ ...posDraft, [p.id]: n === 0 ? null : n })}
                                  className="!py-1.5 !px-2 text-center font-mono text-xs"
                                />
                              </div>
                              <span className="flex-1 text-sm truncate">{name}</span>
                              <div className="w-28">
                                <NumberInput
                                  value={prizeDraft[p.id] ?? 0}
                                  min={0}
                                  onValueChange={(n) => setPrizeDraft({ ...prizeDraft, [p.id]: n })}
                                  className="!py-1.5 !px-2 text-right font-mono text-sm"
                                />
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex justify-between items-center pt-2">
                          <span className="text-[10px] text-ink-400">
                            Sum: <span className="font-mono text-brass-200">{formatMoney(Object.values(prizeDraft).reduce((s, n) => s + Number(n || 0), 0), t.currency)}</span>
                            {' / '}<span className="font-mono">{formatMoney(pool, t.currency)}</span>
                          </span>
                          <div className="flex gap-2">
                            <button onClick={() => setEditingTour(null)} className="text-xs text-ink-400 px-3 py-1.5">Cancel</button>
                            <button onClick={savePrizes} className="btn-primary !py-1.5 !px-3 text-xs">Save</button>
                          </div>
                        </div>
                      </div>
                    )}
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
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/cash/${r.game.id}`} className="font-semibold flex-1 truncate hover:text-brass-200">{r.game.name}</Link>
                    <div className="font-mono text-brass-200">{formatMoney(r.totalIn, r.game.currency)}</div>
                    <button
                      onClick={() => deleteCashGame(r.game.id, r.game.name)}
                      className="text-red-400/60 hover:text-red-400 px-2 py-1 text-lg leading-none"
                      title="Delete from history"
                    >🗑</button>
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
