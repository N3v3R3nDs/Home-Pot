import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { useTournament } from '@/hooks/useTournament';
import { useTournamentClock } from '@/hooks/useTournamentClock';
import { useAutoAdvance } from '@/hooks/useAutoAdvance';
import { useSettings } from '@/store/settings';
import { calculatePrizePool, distributePrizes } from './payouts';
import { formatChips, formatDuration, formatMoney, formatPlace } from '@/lib/format';
import { requestWakeLock, releaseWakeLock } from '@/lib/wakeLock';
import { QRCode } from '@/components/QRCode';
import { useFullscreen, useOrientation } from '@/hooks/useFullscreen';

/**
 * The monitor view — designed for a large screen / TV / extra phone propped
 * on the table. No nav bar. Wake lock on. Massive timer. Auto-scaling
 * prize pool, payouts, players left, and avg stack.
 */
export function TournamentMonitor() {
  const { id } = useParams<{ id: string }>();
  const { tournament, players } = useTournament(id);
  const clock = useTournamentClock(tournament);
  useAutoAdvance(tournament, clock.msRemaining);
  const { currency } = useSettings();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const orientation = useOrientation();
  const [hideQr, setHideQr] = useState(false);

  // In fullscreen mode (or landscape on a smaller viewport) we want the
  // cleanest possible "broadcast" feel — no nav, no chrome, big numbers.
  const clean = isFullscreen;

  useEffect(() => {
    requestWakeLock();
    return () => { releaseWakeLock(); };
  }, []);

  // Keyboard shortcuts: SPACE = pause/resume, ←/→ = level, F = fullscreen
  const togglePauseShortcut = useCallback(async () => {
    if (!tournament) return;
    if (tournament.state === 'running') {
      await supabase.from('tournaments').update({ state: 'paused', paused_at: new Date().toISOString() }).eq('id', tournament.id);
    } else if (tournament.state === 'paused' && tournament.paused_at) {
      const addedPause = Date.now() - Date.parse(tournament.paused_at);
      await supabase.from('tournaments').update({
        state: 'running', paused_at: null,
        pause_elapsed_ms: tournament.pause_elapsed_ms + addedPause,
      }).eq('id', tournament.id);
    } else if (tournament.state === 'setup') {
      await supabase.from('tournaments').update({
        state: 'running',
        level_started_at: new Date().toISOString(),
        current_level: 0, pause_elapsed_ms: 0,
      }).eq('id', tournament.id);
    }
  }, [tournament]);
  const advanceShortcut = useCallback(async (by: number) => {
    if (!tournament) return;
    const next = Math.max(0, Math.min(tournament.blind_structure.length - 1, tournament.current_level + by));
    await supabase.from('tournaments').update({
      current_level: next,
      level_started_at: new Date().toISOString(),
      pause_elapsed_ms: 0,
      paused_at: tournament.state === 'paused' ? null : tournament.paused_at,
    }).eq('id', tournament.id);
  }, [tournament]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); void togglePauseShortcut(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); void advanceShortcut(1); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); void advanceShortcut(-1); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePauseShortcut, advanceShortcut, toggleFullscreen]);

  const alive = players.filter((p) => p.eliminated_at === null);
  const buyIns = players.reduce((s, p) => s + p.buy_ins, 0);
  const rebuys = players.reduce((s, p) => s + p.rebuys, 0);
  const addons = players.reduce((s, p) => s + p.addons, 0);

  const prizePool = useMemo(() => tournament ? calculatePrizePool({
    buyIn: tournament.buy_in,
    rebuyAmount: tournament.rebuy_amount ?? 0,
    addonAmount: tournament.addon_amount ?? 0,
    bountyAmount: tournament.bounty_amount,
    buyIns, rebuys, addons,
    rakePercent: tournament.rake_percent,
    dealerTipPercent: tournament.dealer_tip_percent,
  }) : 0, [tournament, buyIns, rebuys, addons]);

  const totalChips = tournament
    ? buyIns * tournament.starting_stack +
      rebuys * (tournament.rebuy_stack ?? tournament.starting_stack) +
      addons * (tournament.addon_stack ?? tournament.starting_stack)
    : 0;
  const avgStack = alive.length ? Math.round(totalChips / alive.length) : 0;

  const payouts = tournament ? distributePrizes(prizePool, tournament.payout_structure) : [];
  const nextLevel = tournament?.blind_structure[clock.levelIndex + 1];

  if (!tournament) return <div className="grid place-items-center h-screen text-ink-200">Loading…</div>;

  const danger = clock.msRemaining < 60_000 && tournament.state === 'running';

  // QR encodes the *live* screen URL (so scanning takes friends straight to controls).
  const joinUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/tournament/${tournament.id}`
    : '';

  return (
    <div className="fixed inset-0 bg-felt-radial overflow-hidden text-ink-50">
      {/* Top bar — sits in flow (not absolute) so it never overlaps content.
          Compact on portrait phones: title truncates, controls icon-only. */}
      {!clean && (
        <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 px-3 sm:px-6 pt-3 pt-safe">
          <Link to={`/tournament/${tournament.id}`} className="font-display text-lg sm:text-2xl text-brass-shine truncate min-w-0">
            ← {tournament.name}
          </Link>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="pill bg-felt-800/70 border border-felt-700 hidden sm:inline-flex">
              {tournament.state.toUpperCase()}
            </span>
            <button
              onClick={async () => {
                await supabase.from('tournaments').update({ auto_advance: !tournament.auto_advance }).eq('id', tournament.id);
              }}
              className={`w-9 h-9 grid place-items-center rounded-full border ${
                tournament.auto_advance
                  ? 'bg-brass-500/20 border-brass-500/40 text-brass-100'
                  : 'bg-felt-800/70 border-felt-700 text-ink-300'
              }`}
              title={tournament.auto_advance ? 'Auto-advance ON (tap to disable)' : 'Auto-advance OFF (tap to enable)'}
            >{tournament.auto_advance ? '⏭' : '✋'}</button>
            <button
              onClick={() => setHideQr((v) => !v)}
              className="w-9 h-9 grid place-items-center rounded-full bg-felt-800/70 border border-felt-700 text-ink-200"
              title={hideQr ? 'Show QR' : 'Hide QR'}
            >{hideQr ? '◫' : '⊟'}</button>
            <button
              onClick={toggleFullscreen}
              className="w-9 h-9 grid place-items-center rounded-full bg-brass-500/20 border border-brass-500/40 text-brass-100"
              title="Fullscreen (Esc to exit)"
            >⛶</button>
          </div>
        </header>
      )}

      {/* Floating exit-fullscreen hint */}
      {clean && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-20 text-ink-400/60 hover:text-ink-200 text-xs uppercase tracking-widest"
          title="Exit fullscreen (Esc)"
        >
          ⛶ exit
        </button>
      )}

      {/* Body — fluid layout that always fits the viewport.
          - Uses vmin so font sizes scale with the *smaller* dimension (height in landscape)
          - min-h-0 / overflow-hidden lets the clock area shrink instead of pushing content off-screen
          - In landscape we shift to a denser side-by-side layout */}
      {orientation === 'landscape' ? (
        // ─── LANDSCAPE: clock dominates left, stats stacked on the right ─────
        <div className={`absolute inset-0 flex gap-3 px-3 py-3 ${clean ? '' : 'pt-14'}`}>
          {/* Left: clock + blinds (takes most of the width) */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
            <div
              className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold"
              style={{ fontSize: 'clamp(1rem, 3.4vmin, 2rem)' }}
            >
              Level {clock.level?.level ?? 0}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={clock.levelIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="font-display leading-none text-brass-shine mt-2"
                style={{ fontSize: 'clamp(3rem, 16vmin, 13rem)' }}
              >
                {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
              </motion.div>
            </AnimatePresence>
            {clock.level?.ante ? (
              <div className="text-ink-300 mt-1" style={{ fontSize: 'clamp(0.85rem, 2.8vmin, 1.5rem)' }}>
                ante {clock.level.ante}
              </div>
            ) : null}
            <motion.div
              className="font-mono leading-none mt-3 tabular-nums"
              style={{ fontSize: 'clamp(4.5rem, 38vmin, 24rem)' }}
              animate={danger ? { color: ['#ffffff', '#f87171', '#ffffff'] } : { color: '#ffffff' }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              {formatDuration(clock.msRemaining)}
            </motion.div>
            {nextLevel && (
              <div className="text-ink-300 mt-3" style={{ fontSize: 'clamp(1.1rem, 3.4vmin, 2rem)' }}>
                Next: <span className="text-brass-200 font-semibold">{nextLevel.sb}/{nextLevel.bb}</span>
                {nextLevel.breakAfter ? ' (break)' : ''}
              </div>
            )}
          </div>

          {/* Right: stats stack + payouts (slim to give the clock more room) */}
          <div className="flex flex-col gap-2 w-[22%] max-w-[260px] min-w-[170px] overflow-hidden">
            <CompactStat label="Players" value={`${alive.length}/${players.length}`} />
            <CompactStat label="Avg stack" value={formatChips(avgStack)} />
            <CompactStat label="Prize pool" value={formatMoney(prizePool, currency)} />
            <div className="card-felt p-2 flex-1 min-h-0 overflow-y-auto no-scrollbar">
              <div className="text-[9px] uppercase tracking-widest text-ink-400 mb-1">Payouts</div>
              <ul className="space-y-1">
                {payouts.map((p) => (
                  <li key={p.place} className="flex items-center justify-between text-sm">
                    <span>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : formatPlace(p.place)}</span>
                    <span className="font-mono text-brass-200">{formatMoney(p.percent, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        // ─── PORTRAIT: pure flex column. Stats on top, clock fills, payouts
        //               and alive ticker stack at the bottom. No side column. ─
        <div className={`absolute inset-0 flex flex-col gap-3 px-3 ${clean ? 'py-3' : 'pt-16 pb-3'}`}>
          {/* Compact 4-col stats — text shrinks to fit narrow phones */}
          <div className="grid grid-cols-4 gap-1.5 shrink-0">
            <TightStat label="Players" value={`${alive.length}/${players.length}`} />
            <TightStat label="Avg" value={formatChips(avgStack)} />
            <TightStat label="Pool" value={formatMoney(prizePool, currency)} />
            <TightStat label="Chips" value={formatChips(totalChips)} />
          </div>

          {/* Clock fills the available height */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
            <div
              className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold"
              style={{ fontSize: 'clamp(1rem, 3.4vmin, 1.75rem)' }}
            >
              Level {clock.level?.level ?? 0}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={clock.levelIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="font-display leading-none text-brass-shine mt-1"
                style={{ fontSize: 'clamp(2.75rem, 14vmin, 11rem)' }}
              >
                {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
              </motion.div>
            </AnimatePresence>
            {clock.level?.ante ? (
              <div className="text-ink-300 mt-1" style={{ fontSize: 'clamp(0.75rem, 2vmin, 1.1rem)' }}>
                ante {clock.level.ante}
              </div>
            ) : null}
            <motion.div
              className="font-mono leading-none mt-3 tabular-nums"
              style={{ fontSize: 'clamp(4.5rem, 24vmin, 18rem)' }}
              animate={danger ? { color: ['#ffffff', '#f87171', '#ffffff'] } : { color: '#ffffff' }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              {formatDuration(clock.msRemaining)}
            </motion.div>
            {nextLevel && (
              <div className="text-ink-300 mt-2" style={{ fontSize: 'clamp(1rem, 3vmin, 1.5rem)' }}>
                Next: <span className="text-brass-200 font-semibold">{nextLevel.sb}/{nextLevel.bb}</span>
                {nextLevel.breakAfter ? ' (break)' : ''}
              </div>
            )}
          </div>

          {/* Payouts as horizontal pills (only top 3 visible, rest scroll) */}
          {payouts.length > 0 && (
            <div className="shrink-0 overflow-x-auto no-scrollbar">
              <div className="flex gap-2 justify-center min-w-max px-2">
                {payouts.map((p) => (
                  <div key={p.place} className="shrink-0 bg-felt-950/70 border border-felt-800 rounded-xl px-3 py-1.5 flex items-center gap-2 text-sm">
                    <span>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : formatPlace(p.place)}</span>
                    <span className="font-mono text-brass-200">{formatMoney(p.percent, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alive players ticker */}
          <div className="shrink-0 overflow-x-auto no-scrollbar">
            <div className="flex gap-1.5">
              {alive.map((p) => (
                <div key={p.id} className="shrink-0 bg-felt-950/60 border border-felt-800 rounded-lg px-2.5 py-1.5 text-xs">
                  <div className="font-semibold">{p.guest_name ?? '🃏'}</div>
                  {(p.rebuys > 0 || p.bounties_won > 0) && (
                    <div className="text-[10px] text-ink-400">
                      {p.rebuys > 0 && `🔁${p.rebuys} `}
                      {p.bounties_won > 0 && `💀${p.bounties_won}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* End-of-level prompt: shows when timer hits 0 and auto_advance is OFF */}
      {clock.msRemaining === 0 && tournament.state === 'running' && !tournament.auto_advance &&
        clock.levelIndex < tournament.blind_structure.length - 1 && (() => {
          const nextLvl = tournament.blind_structure[clock.levelIndex + 1];
          return (
            <button
              onClick={() => advanceShortcut(1)}
              className="absolute inset-x-6 top-1/2 -translate-y-1/2 z-30 mx-auto max-w-md rounded-2xl py-6 px-6 shadow-glow font-display text-3xl text-felt-950"
              style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--shine-from)) 0%, rgb(var(--shine-mid)) 50%, rgb(var(--shine-to)) 100%)' }}
            >
              ▶ Next level
              <div className="text-xs font-sans uppercase tracking-widest mt-1 opacity-80">
                {nextLvl?.sb}/{nextLvl?.bb}
              </div>
            </button>
          );
        })()}

      {/* JOIN — corner badge. Tiny in both orientations so it never covers the
          clock or eats into the layout. Tap header "show QR" to toggle. */}
      {!hideQr && (
        <div className={`absolute z-10 bottom-2 left-2 flex items-center gap-2 bg-felt-950/85 backdrop-blur-sm border border-felt-700/60 rounded-xl p-1.5 ${
          clean ? 'opacity-80 hover:opacity-100 transition' : ''
        }`}>
          <div className="text-left pl-1">
            <div className="text-[9px] uppercase tracking-[0.3em] text-brass-300 leading-none">Join</div>
            <div
              className="font-display tracking-[0.25em] text-brass-shine leading-none"
              style={{ fontSize: 'clamp(0.95rem, 3.5vmin, 1.6rem)' }}
            >
              {tournament.join_code ?? '—'}
            </div>
          </div>
          <QRCode value={joinUrl} size={56} />
        </div>
      )}
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-felt px-3 py-2 flex items-center justify-between min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-ink-400 truncate">{label}</div>
      <div className="font-display text-brass-shine tabular-nums truncate" style={{ fontSize: 'clamp(0.95rem, 3.5vmin, 1.5rem)' }}>{value}</div>
    </div>
  );
}

function TightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-felt px-2 py-1.5 text-center min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-ink-400 truncate">{label}</div>
      <div
        className="font-display text-brass-shine tabular-nums truncate leading-tight"
        style={{ fontSize: 'clamp(0.85rem, 4vw, 1.25rem)' }}
      >
        {value}
      </div>
    </div>
  );
}
