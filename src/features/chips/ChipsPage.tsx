import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Chip } from '@/components/Chip';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useSettings } from '@/store/settings';
import { supabase } from '@/lib/supabase';
import { chipLabel, type Denomination } from '@/lib/chipSet';
import { formatChips, formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { planEvening } from './eveningPlanner';
import type { Tournament, TournamentPlayer, CashGame } from '@/types/db';

/**
 * "Tonight's chips" — unified planner that splits the dealer's physical
 * inventory between the tournament's starting stacks and the cash game's
 * per-buy-in bags. Live tournament/cash games auto-fill the form and the
 * cash-buy-ins-available counter updates as tournament players bust out.
 */
export function ChipsPage() {
  const { inventory, tournamentDefaults, cashDefaults } = useSettings();
  const t = useT();

  // Live tournament + cash game (the most recent running ones).
  const [liveTournament, setLiveTournament] = useState<Tournament | null>(null);
  const [livePlayers, setLivePlayers] = useState<TournamentPlayer[]>([]);
  const [liveCash, setLiveCash] = useState<CashGame | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from('tournaments').select('*')
          .in('state', ['running', 'paused'])
          .is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('cash_games').select('*')
          .eq('state', 'running')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      const tour = (t ?? [])[0] as Tournament | undefined;
      const cash = (c ?? [])[0] as CashGame | undefined;
      setLiveTournament(tour ?? null);
      setLiveCash(cash ?? null);
      if (tour) {
        const { data: ps } = await supabase.from('tournament_players')
          .select('*').eq('tournament_id', tour.id);
        if (!cancelled) setLivePlayers((ps ?? []) as TournamentPlayer[]);
      } else {
        setLivePlayers([]);
      }
    };
    void load();
    const ch = supabase.channel(`chips:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games' }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  // Form state — auto-fills from live game, or falls back to settings defaults.
  // Editable when planning a fresh evening; effectively read-only when tracking
  // (the user can still tweak to explore "what if" without affecting the game).
  const [tPlayers, setTPlayers] = useState(0);
  const [tStack, setTStack] = useState(0);
  const [cBuyIn, setCBuyIn] = useState(0);
  const [cSmall, setCSmall] = useState(0);
  // Source of truth flag — when changed by user, stop auto-syncing from live.
  const [overridden, setOverridden] = useState(false);

  // Auto-sync from live whenever they exist (until user overrides).
  useEffect(() => {
    if (overridden) return;
    setTPlayers(liveTournament ? livePlayers.length : 0);
    setTStack(liveTournament?.starting_stack ?? tournamentDefaults.buyIn * 50);
    setCBuyIn(liveCash ? Math.max(200, Math.floor((liveCash.big_blind ?? 10) * 50)) : 500);
    setCSmall(liveCash?.small_blind ?? cashDefaults.smallBlind ?? 5);
  }, [liveTournament, liveCash, livePlayers, overridden, tournamentDefaults, cashDefaults]);

  const bustedCount = livePlayers.filter((p) => p.eliminated_at !== null).length;
  const isTracking = !overridden && (!!liveTournament || !!liveCash);

  const plan = useMemo(() => planEvening({
    inventory,
    tournament: tPlayers > 0 && tStack > 0 ? {
      players: tPlayers,
      startingStack: tStack,
      busted: isTracking ? bustedCount : 0,
    } : null,
    cash: cBuyIn > 0 && cSmall > 0 ? {
      buyIn: cBuyIn,
      smallBlind: cSmall,
    } : null,
  }), [inventory, tPlayers, tStack, cBuyIn, cSmall, bustedCount, isTracking]);

  const tournamentTotalValue = plan.tournament
    ? Object.entries(plan.tournament.reserved).reduce(
        (s, [d, n]) => s + Number(d) * (n ?? 0), 0,
      )
    : 0;

  return (
    <div className="space-y-4 pb-4">
      <header>
        <h1 className="font-display text-3xl text-brass-shine">{t('chipsTitle')}</h1>
        <p className="text-ink-400 text-sm mt-1">
          {isTracking
            ? t('chipsTrackingSubtitle', { what: liveTournament ? t('chipsTrackingPlayers') : t('chipsTrackingCash') })
            : t('chipsPlanningSubtitle')}
        </p>
      </header>

      {/* Live tracking pill */}
      {isTracking && (
        <Card className="bg-brass-500/5 border border-brass-500/30">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-brass-100 text-sm">
              <span className="relative inline-block w-2 h-2 rounded-full bg-emerald-400">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
              </span>
              <span>
                <div className="font-semibold">{t('chipsTrackingLive')}</div>
                <div className="text-[11px] text-ink-400">
                  {liveTournament && `${liveTournament.name} · ${t('chipsAlive', { alive: livePlayers.length - bustedCount, total: livePlayers.length })}`}
                  {liveTournament && liveCash && ' · '}
                  {liveCash && t('chipsCashLabel', { name: liveCash.name })}
                </div>
              </span>
            </span>
            <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setOverridden(true)}>
              {t('chipsPlanSomethingElse')}
            </Button>
          </div>
        </Card>
      )}

      {/* Inputs (editable in planning mode; visible but soft when tracking) */}
      <Card>
        <p className="label">{t('chipsTournament')}</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label={t('chipsPlayers')}
            value={tPlayers}
            min={0}
            onValueChange={(n) => { setTPlayers(n); setOverridden(true); }}
          />
          <NumberInput
            label={t('chipsStartingStack')}
            value={tStack}
            min={0}
            suffix="chips"
            onValueChange={(n) => { setTStack(n); setOverridden(true); }}
          />
        </div>

        <p className="label mt-4">{t('chipsCashGame')}</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label={t('chipsBuyIn')}
            value={cBuyIn}
            min={0}
            onValueChange={(n) => { setCBuyIn(n); setOverridden(true); }}
          />
          <NumberInput
            label={t('chipsSmallBlind')}
            value={cSmall}
            min={0}
            onValueChange={(n) => { setCSmall(n); setOverridden(true); }}
          />
        </div>
        {overridden && (liveTournament || liveCash) && (
          <button
            onClick={() => setOverridden(false)}
            className="mt-3 text-[10px] uppercase tracking-widest text-brass-300 hover:text-brass-200"
          >
            {t('chipsResumeTracking')}
          </button>
        )}
      </Card>

      {/* Tournament reserve */}
      {plan.tournament && (
        <motion.div
          layout
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏆</span>
              <span>
                <div className="font-display text-emerald-200 text-lg">{t('chipsTournamentReserve')}</div>
                <div className="text-[11px] text-ink-400">
                  {t('chipsActiveStacks', { n: plan.tournament.activePlayers, s: plan.tournament.activePlayers === 1 ? '' : 's' })}
                  {bustedCount > 0 && isTracking && ` · ${t('chipsReturnedToDealer', { n: bustedCount })}`}
                </div>
              </span>
            </div>
            <div className="text-right">
              <div className="font-mono text-emerald-200 tabular-nums text-lg">
                <AnimatedNumber value={tournamentTotalValue} format={(n) => formatChips(Math.round(n))} />
              </div>
              <div className="text-[10px] text-ink-400">{t('chipsTotalReserved')}</div>
            </div>
          </div>

          <div className="bg-felt-950/40 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">{t('chipsPerPlayerStack')}</div>
            <ChipBag entries={plan.tournament.perPlayer} />
            <div className="mt-2 text-xs text-ink-400">
              {t('chipsTargetBuilt', {
                target: formatChips(plan.tournament.perPlayerTargetValue),
                built: formatChips(plan.tournament.perPlayerActualValue),
              })}
              {plan.tournament.perPlayerActualValue !== plan.tournament.perPlayerTargetValue
                && ` (${plan.tournament.perPlayerActualValue > plan.tournament.perPlayerTargetValue ? '+' : ''}${plan.tournament.perPlayerActualValue - plan.tournament.perPlayerTargetValue})`}
            </div>
          </div>

          {plan.tournament.warnings.length > 0 && (
            <ul className="text-xs text-amber-300 space-y-0.5">
              {plan.tournament.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </motion.div>
      )}

      {/* Cash bag from remainder */}
      {plan.cash && (
        <motion.div
          layout
          className="rounded-2xl border border-brass-500/30 bg-brass-500/5 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">💵</span>
              <span>
                <div className="font-display text-brass-200 text-lg">{t('chipsCashBag')}</div>
                <div className="text-[11px] text-ink-400">
                  {t('chipsBagSizedFor', { amount: formatChips(cBuyIn), sb: cSmall, bb: cSmall * 2 })}
                </div>
              </span>
            </div>
            <div className="text-right">
              <div className="font-mono text-brass-200 tabular-nums text-2xl">
                <AnimatedNumber value={plan.cash.buyInsAvailable} />
              </div>
              <div className="text-[10px] text-ink-400">{t('chipsBuyInsAvailable', { s: plan.cash.buyInsAvailable === 1 ? '' : 's' })}</div>
            </div>
          </div>

          <div className="bg-felt-950/40 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">{t('chipsPerBuyIn')}</div>
            <ChipBag entries={plan.cash.perBuyIn} />
            <div className="mt-2 text-xs text-ink-400">
              {t('chipsTargetBuilt', {
                target: formatChips(plan.cash.perBuyInTargetValue),
                built: formatChips(plan.cash.perBuyInActualValue),
              })}
            </div>
          </div>

          {plan.cash.warnings.length > 0 && (
            <ul className="text-xs text-amber-300 space-y-0.5">
              {plan.cash.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </motion.div>
      )}

      {/* Conflict warning when tournament + 1 cash buy-in over-commit a denom */}
      {plan.conflicts.length > 0 && (
        <Card className="border border-red-500/40 bg-red-500/5">
          <div className="flex items-start gap-2">
            <span className="text-xl">⚠️</span>
            <div className="text-sm">
              <div className="font-semibold text-red-300">{t('chipsInventoryShort')}</div>
              <div className="text-[12px] text-ink-300 mt-1">
                {t('chipsOverCommit')}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-red-300">
                {plan.conflicts.map((c) => (
                  <li key={c.denom}>{t('chipsShortBy', { label: chipLabel(c.denom), n: c.short })}</li>
                ))}
              </ul>
              <div className="text-[11px] text-ink-400 mt-2">
                {t('chipsTrimSuggest')}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Inventory snapshot — what's left if both reservations are claimed */}
      {plan.cash && (
        <Card>
          <p className="label">{t('chipsDealerFloat')}</p>
          <p className="text-xs text-ink-400 mb-3">{t('chipsDealerFloatHint')}</p>
          <ChipBag
            entries={plan.cash.remaining}
            empty={t('chipsNothingLeft')}
            grayscaleZero
          />
        </Card>
      )}
    </div>
  );
}

interface ChipBagProps {
  entries: Partial<Record<Denomination, number>>;
  empty?: string;
  grayscaleZero?: boolean;
}

function ChipBag({ entries, empty, grayscaleZero }: ChipBagProps) {
  const items = Object.entries(entries)
    .map(([d, n]) => ({ denom: Number(d) as Denomination, count: n ?? 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => a.denom - b.denom);

  if (items.length === 0) {
    return <p className="text-ink-400 text-xs italic">{empty ?? 'No chips.'}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ denom, count }) => (
        <motion.div
          key={denom}
          layout
          className={`flex flex-col items-center gap-1 bg-felt-900/40 border border-felt-700/60 rounded-xl px-2.5 py-2 ${
            grayscaleZero && count === 0 ? 'opacity-40' : ''
          }`}
        >
          <Chip denom={denom} size="sm" />
          <div className="font-mono text-sm text-ink-100 tabular-nums leading-none">×{count}</div>
          <div className="text-[9px] text-ink-500 leading-none">
            {formatMoney(denom * count, '')}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
