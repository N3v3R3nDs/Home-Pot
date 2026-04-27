import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useConfirm } from '@/components/ui/Confirm';
import { useAuth } from '@/store/auth';
import { formatDuration, formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { ActivityFeed } from './ActivityFeed';
import type { CashGame, Tournament } from '@/types/db';

type Action = { kind: 'tournament' | 'cash_game'; id: string; name: string };

/** Compute remaining ms in the current level for a tournament — same math as
 *  useTournamentClock but without the per-second re-render. We let parent
 *  re-render at 1Hz instead. */
function tournamentRemainingMs(t: Tournament, now: number): number {
  if (t.state !== 'running' && t.state !== 'paused') return 0;
  const lvl = t.blind_structure[Math.min(t.current_level, t.blind_structure.length - 1)];
  if (!lvl) return 0;
  const total = lvl.durationMin * 60_000;
  const start = t.level_started_at ? Date.parse(t.level_started_at) : null;
  if (!start) return total;
  const elapsed = t.state === 'paused' && t.paused_at
    ? Date.parse(t.paused_at) - start - t.pause_elapsed_ms
    : now - start - t.pause_elapsed_ms;
  return Math.max(0, total - elapsed);
}

export function Dashboard() {
  const { profile } = useAuth();
  const t = useT();
  const confirm = useConfirm();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [cashGames, setCashGames] = useState<CashGame[]>([]);
  const [acting, setActing] = useState<Action | null>(null);
  const [tickNow, setTickNow] = useState(() => Date.now());

  // Re-render every second so the live timer on tournament cards counts down.
  // Only ticks when there's actually a live tournament — avoids 1Hz wakeups
  // (and battery drain) for users sitting on an empty dashboard.
  const liveCount = tournaments.filter((t) => t.state === 'running').length;
  useEffect(() => {
    if (liveCount === 0) return;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveCount]);

  const endIt = async () => {
    if (!acting) return;
    const table = acting.kind === 'tournament' ? 'tournaments' : 'cash_games';
    const updates = acting.kind === 'tournament'
      ? { state: 'finished' }
      : { state: 'finished', ended_at: new Date().toISOString() };
    setActing(null);
    await supabase.from(table).update(updates).eq('id', acting.id);
  };
  const deleteIt = async () => {
    if (!acting) return;
    const target = acting;
    setActing(null);
    if (!await confirm({
      title: `Delete "${target.name}"?`,
      message: 'This cannot be undone. Bank transactions are kept in the ledger.',
      confirmLabel: '🗑 Delete',
      destructive: true,
    })) return;
    const table = target.kind === 'tournament' ? 'tournaments' : 'cash_games';
    // Soft delete — keeps audit trail and bank cross-references intact
    await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', target.id);
  };

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from('tournaments').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(20),
        supabase.from('cash_games').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(20),
      ]);
      setTournaments((t ?? []) as Tournament[]);
      setCashGames((c ?? []) as CashGame[]);
    };
    load();

    // Reconcile from realtime payloads — instant updates, no extra queries.
    const ch = supabase.channel(`dashboard:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, (p) => {
        const row = (p.new ?? p.old) as Tournament;
        setTournaments((prev) => {
          const without = prev.filter((x) => x.id !== row.id);
          if (p.eventType === 'DELETE' || (row as Tournament).deleted_at) return without;
          return [row as Tournament, ...without].sort(
            (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
          ).slice(0, 20);
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games' }, (p) => {
        const row = (p.new ?? p.old) as CashGame;
        setCashGames((prev) => {
          const without = prev.filter((x) => x.id !== row.id);
          if (p.eventType === 'DELETE' || (row as CashGame).deleted_at) return without;
          return [row as CashGame, ...without].sort(
            (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
          ).slice(0, 20);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const live = tournaments.filter((tour) => tour.state === 'running' || tour.state === 'paused');
  const liveCash = cashGames.filter((c) => c.state === 'running');

  return (
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className="text-ink-300">{t('welcomeBackName', { name: profile?.display_name ?? '...' })}</p>
        <h1 className="font-display text-4xl text-brass-shine">{t('tonightsPoker')}</h1>
      </motion.section>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/tournament/new" className="card-felt p-5 text-center group hover:border-brass-500/50 transition">
          <div className="text-4xl mb-2">🏆</div>
          <div className="font-display text-xl text-brass-shine">{t('tournament')}</div>
          <div className="text-xs text-ink-400 mt-1">{t('setupAndRun')}</div>
        </Link>
        <Link to="/cash/new" className="card-felt p-5 text-center group hover:border-brass-500/50 transition">
          <div className="text-4xl mb-2">💵</div>
          <div className="font-display text-xl text-brass-shine">{t('cashGame')}</div>
          <div className="text-xs text-ink-400 mt-1">{t('liveLedger')}</div>
        </Link>
      </div>
      {/* Tonight's chips — unified planner. Surfaces the dealer's float split
          at a glance; live links into running tournament + cash game. */}
      <Link
        to="/chips"
        className="card-felt p-4 flex items-center gap-3 group hover:border-brass-500/50 transition"
      >
        <div className="text-3xl">🎰</div>
        <div className="flex-1">
          <div className="font-display text-lg text-brass-shine">Tonight's chips</div>
          <div className="text-xs text-ink-400">Plan dealer float across tournament + cash. Live updates as players bust.</div>
        </div>
        <span className="text-brass-300 group-hover:translate-x-0.5 transition-transform">→</span>
      </Link>

      {live.length > 0 && (
        <Card>
          <p className="label">{t('liveTournaments')}</p>
          <ul className="space-y-2">
            {live.map((tour) => {
              const lvl = tour.blind_structure[Math.min(tour.current_level, tour.blind_structure.length - 1)];
              const remaining = tournamentRemainingMs(tour, tickNow);
              return (
                <li key={tour.id} className="flex items-center bg-felt-950/60 rounded-xl hover:bg-felt-900">
                  <Link to={`/tournament/${tour.id}`} className="flex-1 flex items-center justify-between px-4 py-3 gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{tour.name}</div>
                      <div className="text-xs text-ink-400">
                        Lvl {tour.current_level + 1}
                        {lvl && <> · <span className="text-brass-300">{lvl.sb}/{lvl.bb}</span></>}
                        {tour.join_code && <> · {tour.join_code}</>}
                      </div>
                    </div>
                    <span className={`shrink-0 font-mono text-lg tabular-nums ${
                      tour.state === 'paused' ? 'text-ink-400' : remaining < 60_000 ? 'text-red-400' : 'text-brass-200'
                    }`}>
                      {tour.state === 'paused' ? '⏸ ' : ''}{formatDuration(remaining)}
                    </span>
                  </Link>
                  <button
                    onClick={() => setActing({ kind: 'tournament', id: tour.id, name: tour.name })}
                    className="px-3 py-3 text-ink-400 hover:text-ink-100"
                    title="Manage"
                  >⋯</button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {liveCash.length > 0 && (
        <Card>
          <p className="label">{t('liveCashGames')}</p>
          <ul className="space-y-2">
            {liveCash.map((c) => (
              <li key={c.id} className="flex items-center bg-felt-950/60 rounded-xl hover:bg-felt-900">
                <Link to={`/cash/${c.id}`} className="flex-1 flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-ink-400">{c.small_blind}/{c.big_blind} · {c.currency}{c.join_code ? ` · ${c.join_code}` : ''}</div>
                  </div>
                  <span className="text-brass-300 text-2xl">→</span>
                </Link>
                <button
                  onClick={() => setActing({ kind: 'cash_game', id: c.id, name: c.name })}
                  className="px-3 py-3 text-ink-400 hover:text-ink-100"
                  title="Manage"
                >⋯</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet open={!!acting} onClose={() => setActing(null)} title={acting?.name ?? ''}>
        <div className="space-y-3">
          <Button variant="ghost" full onClick={endIt}>
            {t('endNowMoveToHistory')}
          </Button>
          <Button variant="danger" full onClick={deleteIt}>
            {t('deletePermanently')}
          </Button>
        </div>
      </Sheet>

      <ActivityFeed />

      {tournaments.filter((tour) => tour.state === 'finished').length > 0 && (
        <Card>
          <p className="label">{t('recentTournaments')}</p>
          <ul className="space-y-2">
            {tournaments.filter((tour) => tour.state === 'finished').slice(0, 5).map((tour) => (
              <li key={tour.id}>
                <Link to={`/tournament/${tour.id}`} className="flex items-center justify-between bg-felt-950/40 rounded-xl px-4 py-3 hover:bg-felt-900 text-sm">
                  <span>{tour.name}</span>
                  <span className="text-ink-400 font-mono">{formatMoney(tour.buy_in, tour.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tournaments.length === 0 && cashGames.length === 0 && (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">🎲</div>
          <h3 className="font-display text-2xl text-brass-shine">{t('firstNight')}</h3>
          <p className="text-ink-400 text-sm mt-1 mb-4">{t('firstNightHint')}</p>
          <Link to="/tournament/new"><Button>{t('startATournament')}</Button></Link>
        </Card>
      )}
    </div>
  );
}
