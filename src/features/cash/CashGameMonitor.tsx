import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCashGame } from '@/hooks/useCashGame';
import { useSettings } from '@/store/settings';
import { useT } from '@/lib/i18n';
import { useFullscreen, useOrientation, useRedirectOnOrientation } from '@/hooks/useFullscreen';
import { requestWakeLock, releaseWakeLock } from '@/lib/wakeLock';
import { QRCode } from '@/components/QRCode';
import { formatMoney } from '@/lib/format';
import {
  computePlayerStats, tableTotal, totalBoughtIn, totalCashedOut,
  topUpChampion, biggestStake, hotSeat, biggestSingleBuyIn,
  sessionDurationMs, buyInPace, activityFeed, ago, formatLongDuration,
} from './cashStats';

/**
 * Big-screen monitor for cash games. Mirrors TournamentMonitor but the cash
 * world has no clock or levels — so the "drama" comes from a rotating hero
 * card cycling through derived stats and a live activity ticker. Everything
 * shown is honestly derived from logged events; no fake stack tracking.
 */
export function CashGameMonitor() {
  const { id } = useParams<{ id: string }>();
  useRedirectOnOrientation('portrait', id ? `/cash/${id}` : '');
  return <MonitorBody cashGameId={id} />;
}

interface MonitorBodyProps {
  cashGameId: string | undefined;
  /** Hides controls (used by PublicCashView for spectators). */
  spectator?: boolean;
}

export function MonitorBody({ cashGameId, spectator = false }: MonitorBodyProps) {
  const { game, players, buyIns, profileMap, loading } = useCashGame(cashGameId);
  const { currency } = useSettings();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const orientation = useOrientation();
  const t = useT();
  const [hideQr, setHideQr] = useState(false);

  // Tick once a second so durations and "ago" labels update live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    requestWakeLock();
    return () => { releaseWakeLock(); };
  }, []);

  // Keyboard shortcut for fullscreen, mirrors TournamentMonitor.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFullscreen]);

  const stats = useMemo(
    () => game ? computePlayerStats(players, buyIns, profileMap, now) : [],
    [game, players, buyIns, profileMap, now],
  );
  const seated = stats.filter((p) => p.isSeated);
  const cashedOut = stats.filter((p) => !p.isSeated);

  const onTable = tableTotal(stats);
  const totalIn = totalBoughtIn(stats);
  const totalOut = totalCashedOut(stats);
  const topChamp = topUpChampion(stats);
  const biggest = biggestStake(stats);
  const hot = hotSeat(stats);
  const biggestBI = biggestSingleBuyIn(buyIns);
  const sessionMs = game ? sessionDurationMs(game, now) : 0;
  const pace = game ? buyInPace(stats, game, now) : null;
  const feed = useMemo(
    () => activityFeed(players, buyIns, profileMap),
    [players, buyIns, profileMap],
  );

  // Hero card rotation — only include cards that have data. Skipping prevents
  // empty-state awkwardness early in the night.
  const heroCards = useMemo(() => {
    const cards: HeroCard[] = [];
    if (onTable > 0) cards.push({
      key: 'table',
      emoji: '💰',
      label: t('onTheTable'),
      value: formatMoney(onTable, currency),
      sub: stats.length > 0
        ? `${players.length} ${t('seated').toLowerCase()} · ${formatMoney(totalIn, currency)} ${t('inLabel').toLowerCase()}`
        : '',
    });
    if (sessionMs > 60_000) cards.push({
      key: 'session',
      emoji: '⏱',
      label: t('sessionRunning'),
      value: formatLongDuration(sessionMs),
      sub: pace !== null
        ? `${buyIns.length} ${t('buyInsLabel').toLowerCase()} · ~${pace.toFixed(1)}/${t('perHour')}`
        : `${buyIns.length} ${t('buyInsLabel').toLowerCase()}`,
    });
    if (topChamp && topChamp.topUps >= 1) cards.push({
      key: 'champ',
      emoji: '🪙',
      label: t('topUpChampion'),
      value: topChamp.name,
      sub: t('nTopUps', { n: topChamp.topUps }),
    });
    if (biggest && biggest.totalIn > 0) cards.push({
      key: 'biggest',
      emoji: '💸',
      label: t('biggestStake'),
      value: biggest.name,
      sub: formatMoney(biggest.totalIn, currency),
    });
    if (hot) cards.push({
      key: 'hot',
      emoji: '🔥',
      label: t('hotSeat'),
      value: hot.name,
      sub: formatLongDuration(hot.durationMs),
    });
    if (totalIn > 0) cards.push({
      key: 'motion',
      emoji: '🎰',
      label: t('moneyInMotion'),
      value: formatMoney(totalIn, currency),
      sub: totalOut > 0 ? `${formatMoney(totalOut, currency)} ${t('cashedOut')}` : `${biggestBI > 0 ? `${t('biggestBuyIn')}: ${formatMoney(biggestBI, currency)}` : ''}`,
    });
    if (feed.length > 0) {
      const latest = feed[0];
      cards.push({
        key: 'latest',
        emoji: latest.kind === 'top_up' ? '➕' : latest.kind === 'buy_in' ? '🆕' : '👋',
        label: t('latestAction'),
        value: latest.kind === 'top_up'
          ? t('toppedUp', { name: latest.playerName, amount: formatMoney(latest.amount ?? 0, currency) })
          : latest.kind === 'buy_in'
          ? t('boughtIn', { name: latest.playerName, amount: formatMoney(latest.amount ?? 0, currency) })
          : t('joinedTable', { name: latest.playerName }),
        sub: `${ago(latest.at, now)} ${t('agoSuffix')}`,
      });
    }
    return cards;
  }, [onTable, stats, players.length, totalIn, sessionMs, pace, buyIns.length, topChamp, biggest, hot, totalOut, biggestBI, feed, now, currency, t]);

  const [heroIdx, setHeroIdx] = useState(0);
  useEffect(() => {
    if (heroCards.length <= 1) return;
    const i = setInterval(() => setHeroIdx((v) => (v + 1) % heroCards.length), 8000);
    return () => clearInterval(i);
  }, [heroCards.length]);
  // Keep index in range when card list shrinks.
  useEffect(() => {
    if (heroIdx >= heroCards.length && heroCards.length > 0) setHeroIdx(0);
  }, [heroIdx, heroCards.length]);

  if (loading) return <div className="grid place-items-center h-screen text-ink-200">{t('loading')}</div>;
  if (!game) return <div className="grid place-items-center h-screen text-ink-200">{t('loading')}</div>;

  const clean = isFullscreen;
  const joinUrl = typeof window !== 'undefined' && game.join_code
    ? `${window.location.origin}/c/${game.join_code}/view`
    : '';
  const hero = heroCards[Math.min(heroIdx, heroCards.length - 1)];

  return (
    <div className="fixed inset-0 bg-felt-radial overflow-hidden text-ink-50">
      {!clean && (
        <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 px-3 sm:px-6 pt-3 pt-safe">
          {spectator ? (
            <div className="font-display text-lg sm:text-2xl text-brass-shine truncate min-w-0">
              {game.name}
            </div>
          ) : (
            <Link to={`/cash/${game.id}`} className="font-display text-lg sm:text-2xl text-brass-shine truncate min-w-0">
              ← {game.name}
            </Link>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="pill bg-felt-800/70 border border-felt-700 hidden sm:inline-flex">
              {game.small_blind ?? 0}/{game.big_blind ?? 0}
            </span>
            {spectator && (
              <span className="pill bg-felt-800/70 border border-felt-700 text-xs">{t('spectator')}</span>
            )}
            <button
              onClick={() => setHideQr((v) => !v)}
              className="w-9 h-9 grid place-items-center rounded-full bg-felt-800/70 border border-felt-700 text-ink-200"
              title={hideQr ? t('showQr') : t('hideQr')}
            >{hideQr ? '◫' : '⊟'}</button>
            <button
              onClick={toggleFullscreen}
              className="w-9 h-9 grid place-items-center rounded-full bg-brass-500/20 border border-brass-500/40 text-brass-100"
              title={t('fullscreen')}
            >⛶</button>
          </div>
        </header>
      )}

      {clean && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-20 text-ink-400/60 hover:text-ink-200 text-xs uppercase tracking-widest"
          title={t('exitFullscreen')}
        >⛶ {t('exit')}</button>
      )}

      {orientation === 'landscape' ? (
        <div className={`absolute inset-0 flex gap-3 px-3 py-3 ${clean ? '' : 'pt-14'}`}>
          {/* Left: hero card dominates */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
            <HeroDisplay hero={hero} totalCards={heroCards.length} activeIdx={heroIdx} />
          </div>

          {/* Right: stats stack + seated list */}
          <div className="flex flex-col gap-2 w-[28%] max-w-[320px] min-w-[200px] overflow-hidden">
            <CompactStat label={t('seated')} value={`${seated.length}`} />
            <CompactStat label={t('cashedOutShort')} value={`${cashedOut.length}`} />
            <CompactStat label={t('buyInsLabel')} value={`${buyIns.length}`} />
            <SeatedList players={seated} currency={currency} t={t} now={now} compact />
          </div>
        </div>
      ) : (
        <div className={`absolute inset-0 flex flex-col gap-3 px-3 ${clean ? 'py-3' : 'pt-16 pb-3'}`}>
          <div className="grid grid-cols-3 gap-1.5 shrink-0">
            <TightStat label={t('seated')} value={`${seated.length}`} />
            <TightStat label={t('buyInsLabel')} value={`${buyIns.length}`} />
            <TightStat label={t('totalBoughtIn')} value={formatMoney(totalIn, currency)} />
          </div>

          <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
            <HeroDisplay hero={hero} totalCards={heroCards.length} activeIdx={heroIdx} />
          </div>

          <SeatedList players={seated} currency={currency} t={t} now={now} compact={false} />
        </div>
      )}

      {/* Activity ticker — bottom strip, animates new entries in */}
      {feed.length > 0 && (
        <ActivityTicker feed={feed.slice(0, 4)} currency={currency} t={t} now={now} />
      )}

      {/* JOIN — corner badge */}
      {!hideQr && game.join_code && (
        <div className={`absolute z-10 bottom-2 left-2 flex items-center gap-2 bg-felt-950/85 backdrop-blur-sm border border-felt-700/60 rounded-xl p-1.5 ${
          clean ? 'opacity-80 hover:opacity-100 transition' : ''
        }`}>
          <div className="text-left pl-1">
            <div className="text-[9px] uppercase tracking-[0.3em] text-brass-300 leading-none">{t('joinLabel')}</div>
            <div
              className="font-display tracking-[0.25em] text-brass-shine leading-none"
              style={{ fontSize: 'clamp(0.95rem, 3.5vmin, 1.6rem)' }}
            >
              {game.join_code}
            </div>
          </div>
          <QRCode value={joinUrl} size={56} />
        </div>
      )}

      {/* Finished overlay */}
      {game.state === 'finished' && (
        <div className="absolute inset-x-0 top-1/3 z-20 grid place-items-center pointer-events-none">
          <div className="font-display text-felt-950 px-8 py-4 rounded-2xl shadow-glow text-3xl"
            style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--shine-from)) 0%, rgb(var(--shine-mid)) 50%, rgb(var(--shine-to)) 100%)' }}>
            🏁 {t('finished')}
          </div>
        </div>
      )}
    </div>
  );
}

interface HeroCard {
  key: string;
  emoji: string;
  label: string;
  value: string;
  sub: string;
}

function HeroDisplay({ hero, totalCards, activeIdx }: { hero: HeroCard | undefined; totalCards: number; activeIdx: number }) {
  if (!hero) return (
    <div className="text-ink-300 font-display" style={{ fontSize: 'clamp(1.5rem, 5vmin, 3rem)' }}>
      …
    </div>
  );
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={hero.key}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center gap-2 max-w-full px-4"
      >
        <div className="text-brass-300/80 uppercase tracking-[0.5em] font-semibold flex items-center gap-3"
          style={{ fontSize: 'clamp(0.85rem, 2.6vmin, 1.5rem)' }}>
          <span style={{ fontSize: 'clamp(1.5rem, 4vmin, 2.5rem)' }}>{hero.emoji}</span>
          {hero.label}
        </div>
        <div
          className="font-display leading-none text-brass-shine tabular-nums break-words text-center"
          style={{ fontSize: 'clamp(2.5rem, 14vmin, 11rem)' }}
        >
          {hero.value}
        </div>
        {hero.sub && (
          <div className="text-ink-300 mt-1 text-center" style={{ fontSize: 'clamp(0.85rem, 2.4vmin, 1.4rem)' }}>
            {hero.sub}
          </div>
        )}
        {totalCards > 1 && (
          <div className="flex gap-1 mt-3 opacity-60">
            {Array.from({ length: totalCards }).map((_, i) => (
              <span
                key={i}
                className={`block w-1.5 h-1.5 rounded-full ${
                  i === activeIdx ? 'bg-brass-300' : 'bg-felt-700'
                }`}
              />
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function SeatedList({
  players, currency, t, now, compact,
}: {
  players: ReturnType<typeof computePlayerStats>;
  currency: string;
  t: ReturnType<typeof useT>;
  now: number;
  compact: boolean;
}) {
  if (players.length === 0) {
    return (
      <div className="card-felt p-3 text-center text-ink-400 text-xs">
        {t('noOneSeated')}
      </div>
    );
  }
  return (
    <div className={`card-felt ${compact ? 'p-2 flex-1 min-h-0 overflow-y-auto no-scrollbar' : 'p-2 max-h-[35vh] overflow-y-auto no-scrollbar'}`}>
      <div className="text-[9px] uppercase tracking-widest text-ink-400 mb-1 px-1">{t('seated')}</div>
      <ul className="space-y-1">
        {players.map((p) => (
          <li key={p.player.id} className="flex items-center justify-between gap-2 px-1.5 py-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-base shrink-0">{p.avatar}</span>
              <span className="truncate font-semibold" style={{ fontSize: 'clamp(0.8rem, 1.7vmin, 1.05rem)' }}>{p.name}</span>
              {p.topUps > 0 && (
                <span className="pill bg-brass-500/15 border border-brass-500/30 text-brass-200 text-[9px] shrink-0">
                  🪙{p.topUps}
                </span>
              )}
            </span>
            <span className="text-right shrink-0">
              <div className="font-mono text-brass-200 tabular-nums leading-tight" style={{ fontSize: 'clamp(0.8rem, 1.7vmin, 1.05rem)' }}>
                {formatMoney(p.totalIn, currency)}
              </div>
              <div className="text-[9px] text-ink-400 leading-tight">{ago(p.seatedSince, now)}</div>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityTicker({
  feed, currency, t, now,
}: {
  feed: ReturnType<typeof activityFeed>;
  currency: string;
  t: ReturnType<typeof useT>;
  now: number;
}) {
  return (
    <div className="absolute bottom-2 right-2 z-10 max-w-[60%] sm:max-w-[40%]">
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {feed.map((e) => (
            <motion.li
              key={`${e.kind}-${e.playerId}-${e.at}`}
              layout
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.3 }}
              className="bg-felt-950/80 backdrop-blur-sm border border-felt-700/60 rounded-lg px-2.5 py-1 text-[11px] text-ink-200 truncate"
            >
              <span className="text-ink-400 mr-1.5">{ago(e.at, now)}</span>
              {e.kind === 'top_up' && t('toppedUp', { name: e.playerName, amount: formatMoney(e.amount ?? 0, currency) })}
              {e.kind === 'buy_in' && t('boughtIn', { name: e.playerName, amount: formatMoney(e.amount ?? 0, currency) })}
              {e.kind === 'join' && t('joinedTable', { name: e.playerName })}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
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
