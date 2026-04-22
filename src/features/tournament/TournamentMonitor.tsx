import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTournament } from '@/hooks/useTournament';
import { useTournamentClock } from '@/hooks/useTournamentClock';
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
  const isLocalhost = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return (
    <div className="fixed inset-0 bg-felt-radial overflow-hidden text-ink-50">
      {/* Top bar — hidden in fullscreen */}
      {!clean && (
        <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 pt-4 pt-safe">
          <Link to={`/tournament/${tournament.id}`} className="font-display text-2xl text-brass-shine">
            ← {tournament.name}
          </Link>
          <div className="flex items-center gap-3 text-sm text-ink-300">
            <span className="pill bg-felt-800/70 border border-felt-700">
              {tournament.state.toUpperCase()}
            </span>
            <button
              onClick={() => setHideQr((v) => !v)}
              className="pill bg-felt-800/70 border border-felt-700 text-ink-200"
              title="Toggle QR code"
            >
              {hideQr ? 'show qr' : 'hide qr'}
            </button>
            <button
              onClick={toggleFullscreen}
              className="pill bg-brass-500/20 border border-brass-500/40 text-brass-100"
              title="Fullscreen (Esc to exit)"
            >
              ⛶ fullscreen
            </button>
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
              style={{ fontSize: 'clamp(0.75rem, 2.4vmin, 1.4rem)' }}
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
              <div className="text-ink-300 mt-3" style={{ fontSize: 'clamp(0.85rem, 2.4vmin, 1.4rem)' }}>
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
        // ─── PORTRAIT: stacked vertically with a 4-card stats strip on top ───
        <div className={`absolute inset-0 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-3 px-4 ${clean ? 'py-4' : 'pt-20 pb-4'}`}>
          <div className="grid grid-cols-4 gap-2">
            <BigStat label="Players left" value={`${alive.length}`} sub={`of ${players.length}`} />
            <BigStat label="Avg stack" value={formatChips(avgStack)} sub="chips" />
            <BigStat label="Prize pool" value={formatMoney(prizePool, currency)} sub={tournament.bounty_amount ? `+ ${formatMoney(tournament.bounty_amount * (buyIns + rebuys), currency)} bounty` : ''} />
            <BigStat label="Total chips" value={formatChips(totalChips)} sub={`${buyIns}/${rebuys}/${addons}`} />
          </div>

          {/* Clock area + payouts on the right */}
          <div className="grid grid-cols-[1fr_auto] gap-3 min-h-0">
            <div className="flex flex-col items-center justify-center text-center min-h-0">
              <div className="text-brass-300/70 uppercase tracking-[0.4em] text-xs mb-1">Level {clock.level?.level ?? 0}</div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={clock.levelIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="font-display leading-none text-brass-shine"
                  style={{ fontSize: 'clamp(3rem, 14vmin, 14rem)' }}
                >
                  {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '🏁'}
                </motion.div>
              </AnimatePresence>
              {clock.level?.ante ? (
                <div className="text-ink-300 mt-1" style={{ fontSize: 'clamp(0.85rem, 2.5vmin, 1.5rem)' }}>
                  ante {clock.level.ante}
                </div>
              ) : null}
              <motion.div
                className="font-mono leading-none mt-3 tabular-nums"
                style={{ fontSize: 'clamp(4rem, 22vmin, 22rem)' }}
                animate={danger ? { color: ['#ffffff', '#f87171', '#ffffff'] } : { color: '#ffffff' }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                {formatDuration(clock.msRemaining)}
              </motion.div>
              {nextLevel && (
                <div className="text-ink-300 mt-2" style={{ fontSize: 'clamp(0.75rem, 2vmin, 1.25rem)' }}>
                  Next: <span className="text-brass-200 font-semibold">{nextLevel.sb}/{nextLevel.bb}</span>
                  {nextLevel.breakAfter ? ' (break after)' : ''}
                </div>
              )}
            </div>
            <div className="card-felt p-3 w-[180px] overflow-y-auto no-scrollbar">
              <p className="label">Payouts</p>
              <ul className="space-y-1.5">
                {payouts.map((p) => (
                  <li key={p.place} className="flex items-center justify-between bg-felt-950/60 rounded-lg px-2 py-1.5 text-sm">
                    <span>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : formatPlace(p.place)}</span>
                    <span className="font-mono text-brass-200">{formatMoney(p.percent, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom: alive players ticker — shown only in portrait */}
          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-2">
              {alive.map((p) => (
                <div key={p.id} className="shrink-0 bg-felt-950/60 border border-felt-800 rounded-xl px-3 py-2 text-sm">
                  <div className="font-semibold">{p.guest_name ?? '🃏'}</div>
                  <div className="text-xs text-ink-400">
                    {p.rebuys > 0 && `🔁${p.rebuys} `}
                    {p.bounties_won > 0 && `💀${p.bounties_won}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* JOIN — bottom-left corner so it doesn't cover the right-side panel.
          Tiny in landscape, full-size in portrait. */}
      {!hideQr && (
        <div className={`absolute z-10 ${
          orientation === 'landscape' ? 'bottom-2 left-2' : 'bottom-4 left-4'
        } flex items-center gap-3 bg-felt-950/85 backdrop-blur-sm border border-felt-700/60 rounded-2xl p-2 ${
          clean ? 'opacity-80 hover:opacity-100 transition' : ''
        }`}>
          <div className="text-left">
            <div className="text-[9px] uppercase tracking-[0.3em] text-brass-300">Join</div>
            <div
              className="font-display tracking-[0.3em] text-brass-shine leading-none"
              style={{ fontSize: orientation === 'landscape' ? 'clamp(1rem, 4vmin, 2rem)' : 'clamp(1.5rem, 8vmin, 3rem)' }}
            >
              {tournament.join_code ?? '—'}
            </div>
            {orientation === 'portrait' && isLocalhost && (
              <div className="text-[9px] text-amber-400 mt-1">Open via LAN IP</div>
            )}
          </div>
          <QRCode value={joinUrl} size={orientation === 'landscape' ? 56 : (clean ? 80 : 110)} />
        </div>
      )}
    </div>
  );
}

function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-felt p-3 text-center min-w-0">
      <div className="text-[10px] uppercase tracking-[0.3em] text-ink-400 truncate">{label}</div>
      <div
        className="font-display text-brass-shine mt-1 tabular-nums truncate"
        style={{ fontSize: 'clamp(1.25rem, 5vmin, 3rem)' }}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-400 mt-1 truncate">{sub}</div>}
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
