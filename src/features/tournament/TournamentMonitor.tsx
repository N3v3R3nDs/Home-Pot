import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { useTournament } from '@/hooks/useTournament';
import { useTournamentClock } from '@/hooks/useTournamentClock';
import { useAutoAdvance } from '@/hooks/useAutoAdvance';
import { useSettings } from '@/store/settings';
import { calculatePrizePool, distributePrizes } from './payouts';
import { formatChips, formatDuration, formatMoney, formatPlace } from '@/lib/format';
import { requestWakeLock, releaseWakeLock } from '@/lib/wakeLock';
import { useFullscreen, useOrientation, useRedirectOnOrientation, useAutoFullscreen } from '@/hooks/useFullscreen';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';
import { LevelUpFanfare } from '@/components/LevelUpFanfare';
import { StatusPill } from '@/components/StatusPill';
import { JoinBadge } from '@/components/JoinBadge';
import { EmptyStateBadge } from '@/components/EmptyStateBadge';
import { CelebrationOverlay, type Celebration } from '@/components/CelebrationOverlay';
import { eliminationSound, finalTableSound, levelExpiredSound, winnerSound } from '@/lib/sounds';
import { RecapCard } from './RecapCard';

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
  const { currency, soundEnabled } = useSettings();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const orientation = useOrientation();
  useRedirectOnOrientation('portrait', id ? `/tournament/${id}` : '');
  useAutoFullscreen();
  // QR hidden by default — it covers a corner and looks busy. Host taps the
  // toggle in the header when they actually want latecomers to scan in.
  const [hideQr, setHideQr] = useState(true);

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

  // Celebration milestones — fire once per transition (first bust, final table,
  // heads-up, champion). Refs gate against re-fire on remount + realtime echo.
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const lastAliveRef = useRef<number | null>(null);
  const lastStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tournament || tournament.state === 'setup') {
      lastAliveRef.current = alive.length;
      lastStateRef.current = tournament?.state ?? null;
      return;
    }
    const prev = lastAliveRef.current;
    const total = players.length;
    if (prev !== null && total > 1) {
      // First bust
      if (prev === total && alive.length === total - 1) {
        setCelebration({
          id: `first-bust-${Date.now()}`,
          glyph: '💥',
          title: 'First blood',
          subtitle: `${total - 1} of ${total} remain`,
          tint: 'crimson',
          durationMs: 2200,
        });
        if (soundEnabled) eliminationSound();
      }
      // Final table (crossing 9)
      else if (prev > 9 && alive.length === 9) {
        setCelebration({
          id: `final-table-${Date.now()}`,
          glyph: '🏆',
          title: 'Final table',
          subtitle: '9 left · play tightens',
          durationMs: 2500,
        });
        if (soundEnabled) finalTableSound();
      }
      // Heads-up (crossing 2)
      else if (prev > 2 && alive.length === 2) {
        setCelebration({
          id: `heads-up-${Date.now()}`,
          glyph: '⚔️',
          title: 'Heads-up',
          subtitle: 'one hand decides it',
          durationMs: 2500,
        });
        if (soundEnabled) finalTableSound();
      }
    }
    lastAliveRef.current = alive.length;
    // Champion (state → finished)
    if (lastStateRef.current && lastStateRef.current !== 'finished' && tournament.state === 'finished') {
      const champ = players.find((p) => p.finishing_position === 1);
      const champName = champ?.guest_name ?? 'Champion';
      setCelebration({
        id: `champ-${Date.now()}`,
        glyph: '🥇',
        title: champName,
        subtitle: 'tournament champion',
        tint: 'emerald',
        durationMs: 4000,
      });
      if (soundEnabled) winnerSound();
    }
    lastStateRef.current = tournament.state;
  }, [alive.length, players, tournament, soundEnabled]);

  // "Time's up" cue when running in manual mode (auto-advance off) and the
  // clock hits 0:00. Fires once per (level, level_started_at) tuple so it
  // doesn't repeat. Auto-advance mode skips — the new level's blindUp from
  // LevelUpFanfare covers that case. Same logic as TournamentLive so the
  // host hears it whether they're on the live view or the broadcast.
  const expiredKeyRef = useRef<string | null>(null);
  const prevMsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!tournament) return;
    const ms = clock.msRemaining;
    const prev = prevMsRef.current;
    prevMsRef.current = ms;
    if (tournament.state !== 'running' || tournament.auto_advance) return;
    if (clock.levelIndex >= tournament.blind_structure.length - 1) return;
    if (prev === null || prev <= 0 || ms > 0) return;
    const key = `${tournament.id}:${tournament.current_level}:${tournament.level_started_at ?? ''}`;
    if (expiredKeyRef.current === key) return;
    expiredKeyRef.current = key;
    if (soundEnabled) levelExpiredSound();
  }, [clock.msRemaining, clock.levelIndex, soundEnabled, tournament]);
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

  // Fanfare intensity ramps up as we approach the final table.
  const fanfareIntensity: 'soft' | 'epic' = alive.length <= 9 ? 'epic' : 'soft';

  return (
    <div className="fixed inset-0 bg-felt-radial overflow-hidden text-ink-50">
      <AmbientBackdrop variant="felt" />
      <CelebrationOverlay celebration={celebration} onDone={() => setCelebration(null)} />
      <LevelUpFanfare
        levelNumber={(clock.level?.level ?? 0)}
        blindsLabel={clock.level ? `${clock.level.sb}/${clock.level.bb}` : ''}
        ante={clock.level?.ante}
        intensity={fanfareIntensity}
      />
      {/* Top bar — sits in flow (not absolute) so it never overlaps content.
          Compact on portrait phones: title truncates, controls icon-only. */}
      {!clean && (
        <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 px-3 sm:px-6 pt-3 pt-safe">
          <Link to={`/tournament/${tournament.id}`} className="font-display text-lg sm:text-2xl text-brass-shine truncate min-w-0 flex items-center gap-2">
            ← {tournament.name}
          </Link>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusPill topic={`monitor:${tournament.id}`} />
            <span className="pill bg-felt-800/70 border border-felt-700 hidden sm:inline-flex">
              {tournament.state.toUpperCase()}
            </span>
            {/* Monitor is broadcast-only — controls (auto-advance, pause,
                level ◀/▶) live in the vertical/Live view. We keep just the
                two display affordances: QR toggle and fullscreen. */}
            <button
              onClick={() => setHideQr((v) => !v)}
              className="w-11 h-11 grid place-items-center rounded-full bg-felt-800/70 border border-felt-700 text-ink-200"
              title={hideQr ? 'Show join QR' : 'Hide join QR'}
            >{hideQr ? '📲' : '🚫'}</button>
            <button
              onClick={toggleFullscreen}
              className="w-11 h-11 grid place-items-center rounded-full bg-brass-500/20 border border-brass-500/40 text-brass-100"
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
      {tournament.state === 'finished' ? (
        <div className="absolute inset-0 z-10 grid place-items-center px-4 overflow-y-auto py-8">
          <RecapCard tournament={tournament} players={players} />
        </div>
      ) : tournament.state === 'setup' ? (
        <div className="absolute inset-0 z-10 grid place-items-center">
          <EmptyStateBadge
            glyph="🎰"
            title="Waiting for the host to start"
            subtitle={`${players.length} player${players.length === 1 ? '' : 's'} on the roster · the timer kicks off when "Start" is tapped.`}
          />
        </div>
      ) : orientation === 'landscape' ? (
        // ─── LANDSCAPE: clock dominates left, stats stacked on the right ─────
        <div className={`absolute inset-0 z-10 flex gap-3 px-3 py-3 ${clean ? '' : 'pt-14'}`}>
          {/* Left: clock + blinds (takes most of the width) */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
            <div
              className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold"
              style={{ fontSize: 'clamp(1.2rem, 4.4vmin, 2.6rem)' }}
            >
              Level {clock.level?.level ?? 0}
            </div>
            {/* Blinds stay perfectly centered on the screen. The ante hangs
                off the *right edge of the blinds element itself* via an
                absolute child of an inline-block wrapper — so the centered
                blinds aren't pulled off-center by the ante's width. */}
            <div className="text-center mt-2">
              <div className="relative inline-block align-baseline">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={clock.levelIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="font-display leading-none text-brass-shine"
                    style={{ fontSize: 'clamp(4rem, 22vmin, 18rem)' }}
                  >
                    {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
                  </motion.div>
                </AnimatePresence>
                {clock.level?.ante ? (
                  <span
                    className="absolute left-full bottom-[0.15em] ml-2 sm:ml-3 font-sans text-ink-400 lowercase tracking-wide whitespace-nowrap"
                    style={{ fontSize: 'clamp(0.85rem, 2.4vmin, 1.4rem)' }}
                  >
                    ante {clock.level.ante}
                  </span>
                ) : null}
              </div>
            </div>
            <motion.div
              className="font-mono leading-none mt-4 tabular-nums"
              style={{ fontSize: 'clamp(6rem, 50vmin, 32rem)' }}
              animate={danger ? { color: ['#ffffff', '#f87171', '#ffffff'] } : { color: '#ffffff' }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              {formatDuration(clock.msRemaining)}
            </motion.div>
            {nextLevel && (
              <div className="text-ink-300 mt-4" style={{ fontSize: 'clamp(1.4rem, 4.4vmin, 2.8rem)' }}>
                Next: <span className="text-brass-200 font-semibold">{nextLevel.sb}/{nextLevel.bb}</span>
                {nextLevel.breakAfter ? ' (break)' : ''}
              </div>
            )}
          </div>

          {/* Right: stats stack + payouts (slim to give the clock more room) */}
          <div className="flex flex-col gap-2 w-[24%] max-w-[320px] min-w-[200px] overflow-hidden">
            <CompactStatNum label="Players" value={alive.length} suffix={`/${players.length}`} />
            <CompactStatNum label="Avg stack" value={avgStack} format={(n) => formatChips(Math.round(n))} />
            <CompactStatNum label="Prize pool" value={prizePool} format={(n) => formatMoney(Math.round(n), currency)} />
            <div className="card-felt p-3 flex-1 min-h-0 overflow-y-auto no-scrollbar">
              <div className="uppercase tracking-widest text-ink-400 mb-2" style={{ fontSize: 'clamp(0.6rem, 1.4vmin, 0.85rem)' }}>Payouts</div>
              <ul className="space-y-1.5">
                {payouts.map((p) => (
                  <li key={p.place} className="flex items-center justify-between gap-2" style={{ fontSize: 'clamp(0.95rem, 2.2vmin, 1.5rem)' }}>
                    <span>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : formatPlace(p.place)}</span>
                    <span className="font-mono text-brass-200 tabular-nums">{formatMoney(p.percent, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        // ─── PORTRAIT: pure flex column. Stats on top, clock fills, payouts
        //               and alive ticker stack at the bottom. No side column. ─
        <div className={`absolute inset-0 z-10 flex flex-col gap-3 px-3 ${clean ? 'py-3' : 'pt-16 pb-3'}`}>
          {/* Compact 4-col stats — text shrinks to fit narrow phones */}
          <div className="grid grid-cols-4 gap-1.5 shrink-0">
            <TightStatNum label="Players" value={alive.length} suffix={`/${players.length}`} />
            <TightStatNum label="Avg" value={avgStack} format={(n) => formatChips(Math.round(n))} />
            <TightStatNum label="Pool" value={prizePool} format={(n) => formatMoney(Math.round(n), currency)} />
            <TightStatNum label="Chips" value={totalChips} format={(n) => formatChips(Math.round(n))} />
          </div>

          {/* Clock fills the available height */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
            <div
              className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold"
              style={{ fontSize: 'clamp(1rem, 3.4vmin, 1.75rem)' }}
            >
              Level {clock.level?.level ?? 0}
            </div>
            <div className="text-center mt-1">
              <div className="relative inline-block align-baseline">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={clock.levelIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="font-display leading-none text-brass-shine"
                    style={{ fontSize: 'clamp(2.75rem, 14vmin, 11rem)' }}
                  >
                    {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
                  </motion.div>
                </AnimatePresence>
                {clock.level?.ante ? (
                  <span
                    className="absolute left-full bottom-[0.15em] ml-1.5 sm:ml-2 font-sans text-ink-400 lowercase tracking-wide whitespace-nowrap"
                    style={{ fontSize: 'clamp(0.7rem, 2vmin, 1.1rem)' }}
                  >
                    ante {clock.level.ante}
                  </span>
                ) : null}
              </div>
            </div>
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

      {/* End-of-level prompt: shows when timer hits 0 and auto_advance is OFF.
          Backdrop dims the screen so the CTA is unmissable; pulsing scale +
          shimmer draws the eye from across the room. */}
      <AnimatePresence>
        {clock.msRemaining === 0 && tournament.state === 'running' && !tournament.auto_advance &&
          clock.levelIndex < tournament.blind_structure.length - 1 && (() => {
            const nextLvl = tournament.blind_structure[clock.levelIndex + 1];
            return (
              <motion.div
                key="next-level-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 grid place-items-center bg-felt-950/55 backdrop-blur-sm pointer-events-none"
              >
                <motion.button
                  initial={{ y: 20, opacity: 0, scale: 0.96 }}
                  animate={{
                    y: 0,
                    opacity: 1,
                    scale: [1, 1.04, 1],
                  }}
                  transition={{
                    y: { duration: 0.35 },
                    opacity: { duration: 0.35 },
                    scale: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
                  }}
                  onClick={() => void advanceShortcut(1)}
                  className="relative rounded-3xl shadow-glow font-display text-felt-950 overflow-hidden pointer-events-auto"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, rgb(var(--shine-from)) 0%, rgb(var(--shine-mid)) 50%, rgb(var(--shine-to)) 100%)',
                    paddingInline: 'clamp(2rem, 6vmin, 4.5rem)',
                    paddingBlock: 'clamp(1.5rem, 5vmin, 3.5rem)',
                  }}
                >
                  {/* Shimmer sweep */}
                  <motion.span
                    aria-hidden
                    className="absolute inset-y-0 -left-1/3 w-1/3 pointer-events-none"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)' }}
                    animate={{ x: ['0%', '550%'] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <div className="relative flex items-center gap-3 sm:gap-5 leading-none">
                    <span className="font-mono" style={{ fontSize: 'clamp(2.5rem, 8vmin, 5rem)' }}>▶</span>
                    <div className="text-left">
                      <div style={{ fontSize: 'clamp(1.6rem, 5vmin, 3.2rem)' }}>Next level</div>
                      <div className="font-sans uppercase tracking-widest opacity-80 mt-1" style={{ fontSize: 'clamp(0.8rem, 2.2vmin, 1.4rem)' }}>
                        {nextLvl?.sb}/{nextLvl?.bb}{nextLvl?.ante ? ` · ante ${nextLvl.ante}` : ''}
                        {nextLvl?.breakAfter ? ' · break' : ''}
                      </div>
                    </div>
                  </div>
                </motion.button>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* JOIN — corner badge with a subtle shine sweep. */}
      {!hideQr && <JoinBadge code={tournament.join_code} url={joinUrl} faded={clean} />}
    </div>
  );
}

function CompactStatNum({ label, value, suffix = '', format }: { label: string; value: number; suffix?: string; format?: (n: number) => string }) {
  return (
    <div className="card-felt px-3 py-2.5 flex items-center justify-between min-w-0 gap-2">
      <div className="uppercase tracking-widest text-ink-400 truncate" style={{ fontSize: 'clamp(0.65rem, 1.4vmin, 0.95rem)' }}>{label}</div>
      <div className="font-display text-brass-shine tabular-nums truncate" style={{ fontSize: 'clamp(1.1rem, 4.2vmin, 2rem)' }}>
        <AnimatedNumber value={value} format={format} />{suffix}
      </div>
    </div>
  );
}

function TightStatNum({ label, value, suffix = '', format }: { label: string; value: number; suffix?: string; format?: (n: number) => string }) {
  return (
    <div className="card-felt px-2 py-1.5 text-center min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-ink-400 truncate">{label}</div>
      <div
        className="font-display text-brass-shine tabular-nums truncate leading-tight"
        style={{ fontSize: 'clamp(0.85rem, 4vw, 1.25rem)' }}
      >
        <AnimatedNumber value={value} format={format} />{suffix}
      </div>
    </div>
  );
}
