import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { resolveJoinCode } from '@/lib/joinCode';
import { useTournament } from '@/hooks/useTournament';
import { useTournamentClock } from '@/hooks/useTournamentClock';
import { calculatePrizePool, distributePrizes } from './payouts';
import { formatChips, formatDuration, formatMoney, formatPlace } from '@/lib/format';

/**
 * No-login public tournament view. URL: /t/<JOIN_CODE>/view
 *
 * Read-only — perfect for spectators or someone who can't be at the table.
 * Uses the same realtime subscription as the host's monitor; just no controls.
 */
export function PublicTournamentView() {
  const { code } = useParams<{ code: string }>();
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Sign in anonymously if needed so RLS lets us read.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) await supabase.auth.signInAnonymously();
      if (!code) return;
      const target = await resolveJoinCode(code);
      if (target?.kind === 'tournament') setTournamentId(target.id);
      else setResolveError(`No tournament with code "${code.toUpperCase()}"`);
    })();
  }, [code]);

  if (resolveError) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <div className="text-5xl mb-3">🃏</div>
          <h1 className="font-display text-2xl text-brass-shine mb-2">Not found</h1>
          <p className="text-ink-300">{resolveError}</p>
        </div>
      </div>
    );
  }
  if (!tournamentId) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-300 font-display text-2xl text-brass-shine animate-pulse">
        loading…
      </div>
    );
  }
  return <PublicView tournamentId={tournamentId} />;
}

function PublicView({ tournamentId }: { tournamentId: string }) {
  const { tournament, players } = useTournament(tournamentId);
  const clock = useTournamentClock(tournament);

  if (!tournament) return null;
  const alive = players.filter((p) => p.eliminated_at === null);
  const buyIns = players.reduce((s, p) => s + p.buy_ins, 0);
  const rebuys = players.reduce((s, p) => s + p.rebuys, 0);
  const addons = players.reduce((s, p) => s + p.addons, 0);
  const prizePool = calculatePrizePool({
    buyIn: tournament.buy_in,
    rebuyAmount: tournament.rebuy_amount ?? 0,
    addonAmount: tournament.addon_amount ?? 0,
    bountyAmount: tournament.bounty_amount,
    buyIns, rebuys, addons,
    rakePercent: tournament.rake_percent,
    dealerTipPercent: tournament.dealer_tip_percent,
  });
  const totalChips = buyIns * tournament.starting_stack
    + rebuys * (tournament.rebuy_stack ?? tournament.starting_stack)
    + addons * (tournament.addon_stack ?? tournament.starting_stack);
  const avgStack = alive.length ? Math.round(totalChips / alive.length) : 0;
  const payouts = distributePrizes(prizePool, tournament.payout_structure);
  const next = tournament.blind_structure[clock.levelIndex + 1];
  const danger = clock.msRemaining < 60_000 && tournament.state === 'running';

  return (
    <div className="fixed inset-0 bg-felt-radial overflow-hidden text-ink-50">
      <header className="absolute top-3 inset-x-0 z-10 flex items-center justify-between px-4 pt-safe">
        <div className="font-display text-xl text-brass-shine truncate">{tournament.name}</div>
        <span className="pill bg-felt-800/70 border border-felt-700 text-xs">spectator</span>
      </header>

      <div className="absolute inset-0 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-3 px-3 pt-12 pb-3">
        <div className="grid grid-cols-3 gap-1.5">
          <CompactStat label="Players" value={`${alive.length}/${players.length}`} />
          <CompactStat label="Avg" value={formatChips(avgStack)} />
          <CompactStat label="Pool" value={formatMoney(prizePool, tournament.currency)} />
        </div>

        <div className="flex flex-col items-center justify-center text-center min-h-0">
          <div className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold" style={{ fontSize: 'clamp(0.7rem, 2.5vmin, 1.25rem)' }}>
            Level {clock.level?.level ?? 0}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={clock.levelIndex}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="font-display leading-none text-brass-shine mt-1"
              style={{ fontSize: 'clamp(2.75rem, 14vmin, 11rem)' }}
            >
              {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
            </motion.div>
          </AnimatePresence>
          <motion.div
            className="font-mono leading-none mt-3 tabular-nums"
            style={{ fontSize: 'clamp(4.5rem, 24vmin, 18rem)' }}
            animate={danger ? { color: ['#fff', '#f87171', '#fff'] } : { color: '#fff' }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            {formatDuration(clock.msRemaining)}
          </motion.div>
          {next && (
            <div className="text-ink-300 mt-2" style={{ fontSize: 'clamp(0.75rem, 2vmin, 1.1rem)' }}>
              Next: <span className="text-brass-200 font-semibold">{next.sb}/{next.bb}</span>
            </div>
          )}
        </div>

        {payouts.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-2 justify-center min-w-max px-2">
              {payouts.map((p) => (
                <div key={p.place} className="shrink-0 bg-felt-950/70 border border-felt-800 rounded-xl px-3 py-1.5 flex items-center gap-2 text-sm">
                  <span>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : formatPlace(p.place)}</span>
                  <span className="font-mono text-brass-200">{formatMoney(p.percent, tournament.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-felt px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-widest text-ink-400">{label}</div>
      <div className="font-display text-brass-shine tabular-nums" style={{ fontSize: 'clamp(0.85rem, 4vw, 1.25rem)' }}>{value}</div>
    </div>
  );
}
