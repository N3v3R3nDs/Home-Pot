import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTournament } from '@/hooks/useTournament';
import { useTournamentClock } from '@/hooks/useTournamentClock';
import { useAutoAdvance } from '@/hooks/useAutoAdvance';
import { useRedirectOnOrientation } from '@/hooks/useFullscreen';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useConfirm } from '@/components/ui/Confirm';
import { useUndo } from '@/components/ui/Undo';
import { QRCode } from '@/components/QRCode';
import { supabase } from '@/lib/supabase';
import { recordBankTx } from '@/lib/bank';
import { haptic } from '@/lib/haptics';
import { generateJoinCode } from '@/lib/joinCode';
import { useT } from '@/lib/i18n';
import { renderShareCard, shareCard } from '@/lib/shareCard';
import type { Season } from '@/types/db';
import { HandTimer } from '@/components/HandTimer';
import { calculatePrizePool, distributePrizes } from './payouts';
import { formatChips, formatDuration, formatMoney, formatPlace } from '@/lib/format';
import { colorUpCandidates, DENOMINATIONS, planColorUp, type Denomination } from '@/lib/chipSet';
import { Chip } from '@/components/Chip';
import { blindUpSound, eliminationSound, finalTableSound, tickSound } from '@/lib/sounds';
import { notify } from '@/lib/notify';
import type { Profile, TournamentPlayer } from '@/types/db';

export function TournamentLive() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const { currency, soundEnabled } = useSettings();
  const { tournament, players, loading, patchTournament, patchPlayer } = useTournament(id);
  const confirm = useConfirm();
  const undo = useUndo();
  const t = useT();
  const clock = useTournamentClock(tournament);
  useAutoAdvance(tournament, clock.msRemaining, patchTournament);
  useRedirectOnOrientation('landscape', id ? `/tournament/${id}/monitor` : '');

  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});
  const [eliminating, setEliminating] = useState<TournamentPlayer | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [chipUp, setChipUp] = useState<{ player: TournamentPlayer; kind: 'rebuy' | 'addon' } | null>(null);
  const [chipUpFromBank, setChipUpFromBank] = useState(false);
  const [claimName, setClaimName] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [editingPlayer, setEditingPlayer] = useState<TournamentPlayer | null>(null);
  const [editPosDraft, setEditPosDraft] = useState<number>(0);
  const autoClaimedRef = useRef(false);

  const openEditPlayer = (p: TournamentPlayer) => {
    setEditPosDraft(p.finishing_position ?? 0);
    setEditingPlayer(p);
  };
  const saveEditPlayer = async () => {
    if (!editingPlayer) return;
    const newPos = Math.max(1, editPosDraft);
    const newPrize = payouts.find((x) => x.place === newPos)?.percent ?? 0;
    const patch = {
      finishing_position: newPos,
      prize: newPrize,
      eliminated_at: editingPlayer.eliminated_at ?? new Date().toISOString(),
    };
    patchPlayer(editingPlayer.id, patch);
    setEditingPlayer(null);
    await supabase.from('tournament_players').update(patch).eq('id', editingPlayer.id);
  };
  const unbustPlayer = async (p: TournamentPlayer) => {
    if (!await confirm({
      title: `Bring ${playerName(p)} back?`,
      message: 'Reverses their elimination — they go back into the alive list with their prize cleared.',
      confirmLabel: 'Bring back',
    })) return;
    const patch = { eliminated_at: null, eliminated_by: null, finishing_position: null, prize: 0 };
    patchPlayer(p.id, patch);
    setEditingPlayer(null);
    await supabase.from('tournament_players').update(patch).eq('id', p.id);
  };
  const removePlayer = async (p: TournamentPlayer) => {
    if (!await confirm({
      title: `Remove ${playerName(p)} entirely?`,
      message: 'Deletes their entry from this tournament. Their stats stay in History under previous tournaments.',
      destructive: true,
      confirmLabel: 'Remove',
    })) return;
    setEditingPlayer(null);
    await supabase.from('tournament_players').delete().eq('id', p.id);
  };

  useEffect(() => {
    supabase.from('seasons').select('*').order('starts_on', { ascending: false })
      .then(({ data }) => setSeasons((data ?? []) as Season[]));
  }, []);

  // Lookup display names for joined profiles
  useEffect(() => {
    const ids = players.map((p) => p.profile_id).filter(Boolean) as string[];
    if (!ids.length) return;
    supabase.from('profiles').select('*').in('id', ids).then(({ data }) => {
      if (!data) return;
      setProfileMap(Object.fromEntries((data as Profile[]).map((p) => [p.id, p])));
    });
  }, [players]);

  const alive = useMemo(() => players.filter((p) => p.eliminated_at === null), [players]);
  const out = useMemo(
    () => players.filter((p) => p.eliminated_at !== null).sort(
      (a, b) => (b.finishing_position ?? 0) - (a.finishing_position ?? 0),
    ),
    [players],
  );

  const buyIns = players.reduce((s, p) => s + p.buy_ins, 0);
  const rebuys = players.reduce((s, p) => s + p.rebuys, 0);
  const addons = players.reduce((s, p) => s + p.addons, 0);
  const prizePool = tournament ? calculatePrizePool({
    buyIn: tournament.buy_in,
    rebuyAmount: tournament.rebuy_amount ?? 0,
    addonAmount: tournament.addon_amount ?? 0,
    bountyAmount: tournament.bounty_amount,
    buyIns, rebuys, addons,
    rakePercent: tournament.rake_percent,
    dealerTipPercent: tournament.dealer_tip_percent,
  }) : 0;
  const bountyPool = tournament ? (buyIns + rebuys) * tournament.bounty_amount : 0;
  const totalChipsInPlay = tournament
    ? buyIns * tournament.starting_stack +
      rebuys * (tournament.rebuy_stack ?? tournament.starting_stack) +
      addons * (tournament.addon_stack ?? tournament.starting_stack)
    : 0;
  const avgStack = alive.length ? Math.round(totalChipsInPlay / alive.length) : 0;
  const payouts = tournament ? distributePrizes(prizePool, tournament.payout_structure) : [];

  // Sounds: blind-up + final-table + countdown ticks
  const lastLevelRef = useRef<number | null>(null);
  const lastAliveRef = useRef<number | null>(null);
  useEffect(() => {
    if (!tournament) return;
    if (lastLevelRef.current !== null && lastLevelRef.current !== tournament.current_level) {
      if (soundEnabled) blindUpSound();
      const lvl = tournament.blind_structure[tournament.current_level];
      if (lvl) notify(`Blinds up · ${lvl.sb}/${lvl.bb}`, tournament.name);
    }
    lastLevelRef.current = tournament.current_level;
  }, [tournament, soundEnabled]);
  useEffect(() => {
    if (!tournament || !soundEnabled) return;
    if (lastAliveRef.current !== null && lastAliveRef.current > 9 && alive.length === 9) {
      finalTableSound();
    }
    lastAliveRef.current = alive.length;
  }, [alive.length, tournament, soundEnabled]);
  useEffect(() => {
    if (!soundEnabled || !tournament || tournament.state !== 'running') return;
    const sec = Math.ceil(clock.msRemaining / 1000);
    if (sec > 0 && sec <= 5) tickSound();
  }, [clock.msRemaining, soundEnabled, tournament]);

  // Color-up suggestions
  const colorUps = clock.level ? colorUpCandidates(clock.level.bb) : [];

  if (loading) return <div className="text-ink-300">{t('loading')}</div>;
  if (!tournament) return <div className="text-ink-300">—</div>;

  // ---------- Actions: optimistic first, DB second ------------------------
  const startOrResume = async () => {
    const updates: Partial<typeof tournament> = { state: 'running' };
    if (tournament.state === 'setup') {
      updates.level_started_at = new Date().toISOString();
      updates.current_level = 0;
      updates.pause_elapsed_ms = 0;
    } else if (tournament.state === 'paused' && tournament.paused_at) {
      const addedPause = Date.now() - Date.parse(tournament.paused_at);
      updates.pause_elapsed_ms = tournament.pause_elapsed_ms + addedPause;
      updates.paused_at = null;
    }
    patchTournament(updates);  // instant UI
    await supabase.from('tournaments').update(updates).eq('id', tournament.id);
  };
  const pause = async () => {
    const pausedAt = new Date().toISOString();
    patchTournament({ state: 'paused', paused_at: pausedAt });
    await supabase.from('tournaments').update({ state: 'paused', paused_at: pausedAt }).eq('id', tournament.id);
  };
  const advanceLevel = async (by: number) => {
    const next = Math.max(0, Math.min(tournament.blind_structure.length - 1, tournament.current_level + by));
    const updates = {
      current_level: next,
      level_started_at: new Date().toISOString(),
      pause_elapsed_ms: 0,
      paused_at: tournament.state === 'paused' ? null : tournament.paused_at,
      state: tournament.state === 'setup' ? 'running' as const : tournament.state,
    };
    patchTournament(updates);
    await supabase.from('tournaments').update(updates).eq('id', tournament.id);
  };
  const shareResults = async () => {
    setShowAdmin(false);
    const podium = players
      .filter((p) => p.finishing_position && p.finishing_position <= 3)
      .map((p) => ({
        place: p.finishing_position!,
        name: playerName(p),
        prize: Number(p.prize ?? 0),
      }))
      .sort((a, b) => a.place - b.place);
    if (podium.length === 0) return;
    try {
      const blob = await renderShareCard({
        title: tournament.name,
        subtitle: new Date(tournament.created_at).toLocaleDateString('nb-NO', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        }),
        podium,
        currency: tournament.currency,
      });
      await shareCard(blob, `${tournament.name.replace(/\s+/g, '-')}.png`, tournament.name);
    } catch (e) {
      console.error('share card failed', e);
    }
  };

  const cloneTournament = async () => {
    if (!user) return;
    setShowAdmin(false);
    let inserted: { id: string } | null = null;
    for (let i = 0; i < 5 && !inserted; i++) {
      const code = generateJoinCode();
      const res = await supabase.from('tournaments').insert({
        host_id: user.id,
        name: `${tournament.name} (copy)`,
        buy_in: tournament.buy_in,
        rebuy_amount: tournament.rebuy_amount,
        addon_amount: tournament.addon_amount,
        starting_stack: tournament.starting_stack,
        rebuy_stack: tournament.rebuy_stack,
        addon_stack: tournament.addon_stack,
        bounty_amount: tournament.bounty_amount,
        rebuys_until_level: tournament.rebuys_until_level,
        blind_structure: tournament.blind_structure,
        payout_structure: tournament.payout_structure,
        chip_distribution: tournament.chip_distribution,
        currency: tournament.currency,
        join_code: code,
      }).select().single();
      if (!res.error) inserted = res.data as { id: string };
    }
    if (inserted) navigate(`/tournament/${inserted.id}`);
  };

  const saveRename = async () => {
    if (renaming === null || !renaming.trim()) return;
    const newName = renaming.trim();
    patchTournament({ name: newName });
    setRenaming(null);
    await supabase.from('tournaments').update({ name: newName }).eq('id', tournament.id);
  };
  const endTournament = async () => {
    if (!await confirm({
      title: t('endTournamentQ'),
      message: t('endTournamentBody'),
      confirmLabel: t('endNow'),
    })) return;
    setShowAdmin(false);
    patchTournament({ state: 'finished' });
    // Write FIRST, then navigate — guarantees the realtime UPDATE has been
    // emitted by the time the dashboard / history screens render.
    await supabase.from('tournaments').update({ state: 'finished' }).eq('id', tournament.id);
    navigate('/history');
  };
  const deleteTournament = async () => {
    if (!await confirm({
      title: t('deleteX', { name: tournament.name }),
      message: t('deleteTBody'),
      confirmLabel: t('delete'),
      destructive: true,
    })) return;
    setShowAdmin(false);
    navigate('/');
    await supabase.from('tournaments').update({ deleted_at: new Date().toISOString() }).eq('id', tournament.id);
  };
  const confirmChipUp = async () => {
    if (!chipUp) return;
    const { player: p, kind } = chipUp;
    const amount = kind === 'rebuy'
      ? Number(tournament.rebuy_amount ?? tournament.buy_in)
      : Number(tournament.addon_amount ?? tournament.buy_in);
    const patch = kind === 'rebuy' ? { rebuys: p.rebuys + 1 } : { addons: p.addons + 1 };
    patchPlayer(p.id, patch);
    setChipUp(null);
    await supabase.from('tournament_players').update(patch).eq('id', p.id);
    if (chipUpFromBank && amount > 0) {
      await recordBankTx({
        profile_id: p.profile_id, guest_name: p.guest_name,
        amount: -amount,
        currency: tournament.currency,
        kind: 'tournament_buy_in',
        ref_table: 'tournaments', ref_id: tournament.id,
        note: `${kind === 'rebuy' ? 'Re-buy' : 'Add-on'} for ${tournament.name}`,
      });
    }
    setChipUpFromBank(false);
  };
  const eliminate = async (target: TournamentPlayer, killerId?: string) => {
    const place = alive.length;
    const payout = payouts.find((p) => p.place === place)?.percent ?? 0;
    const targetPatch = {
      eliminated_at: new Date().toISOString(),
      eliminated_by: killerId ?? null,
      finishing_position: place,
      prize: payout,
    };
    // Snapshot prior state for undo
    const priorTargetState = {
      eliminated_at: target.eliminated_at,
      eliminated_by: target.eliminated_by,
      finishing_position: target.finishing_position,
      prize: target.prize,
    };
    const killer = killerId ? players.find((p) => p.id === killerId) : null;
    const priorKillerBounties = killer?.bounties_won ?? 0;

    patchPlayer(target.id, targetPatch);
    if (soundEnabled) eliminationSound();
    haptic('warning');
    setEliminating(null);

    // Show undo toast — DB writes happen on commit (5s timeout)
    undo({
      message: `${playerName(target)} busted ${formatPlace(place)}`,
      onUndo: () => {
        patchPlayer(target.id, priorTargetState);
        if (killer) patchPlayer(killer.id, { bounties_won: priorKillerBounties });
        // Best-effort DB rollback in case the commit-write somehow already fired:
        void supabase.from('tournament_players').update(priorTargetState).eq('id', target.id);
        if (killer) void supabase.from('tournament_players')
          .update({ bounties_won: priorKillerBounties }).eq('id', killer.id);
      },
      onConfirm: async () => {
        await supabase.from('tournament_players').update(targetPatch).eq('id', target.id);
        if (killer && tournament.bounty_amount > 0) {
          patchPlayer(killer.id, { bounties_won: priorKillerBounties + 1 });
          await supabase.from('tournament_players')
            .update({ bounties_won: priorKillerBounties + 1 })
            .eq('id', killer.id);
        }
      },
    });

    // Win-condition: when only ONE player would be left alive after this bust,
    // auto-mark them as 1st. Guarded:
    //  - target hadn't already busted (prevents double-fire on rapid taps)
    //  - the remaining player isn't already eliminated (prevents duplicate 1st)
    //  - nobody else already holds finishing_position 1
    if (alive.length === 2 && target.eliminated_at === null) {
      const remaining = alive.find((p) => p.id !== target.id);
      const someoneElseAlready1st = players.some(
        (p) => p.id !== remaining?.id && p.finishing_position === 1,
      );
      if (remaining && remaining.eliminated_at === null && !someoneElseAlready1st) {
        const winnerPrize = payouts.find((p) => p.place === 1)?.percent ?? 0;
        const winnerPatch = {
          eliminated_at: new Date().toISOString(),
          finishing_position: 1,
          prize: winnerPrize,
        };
        patchPlayer(remaining.id, winnerPatch);
        patchTournament({ state: 'finished' });
        await supabase.from('tournament_players')
          .update(winnerPatch)
          .eq('id', remaining.id)
          .is('eliminated_at', null);  // CAS — only mark if still alive on server
        await supabase.from('tournaments').update({ state: 'finished' }).eq('id', tournament.id);
      }
    }
  };

  const playerName = (p: TournamentPlayer) =>
    p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
  const playerAvatar = (p: TournamentPlayer) =>
    p.profile_id ? profileMap[p.profile_id]?.avatar_emoji ?? '🃏' : '👤';

  const nextLevel = tournament.blind_structure[clock.levelIndex + 1];

  return (
    <div className="space-y-4 pb-4">
      {tournament.state === 'running' && <HandTimer />}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-3xl text-brass-shine leading-tight truncate">{tournament.name}</h1>
          <p className="text-ink-400 text-sm mt-1">
            {t(tournament.state === 'paused' ? 'paused' : tournament.state === 'running' ? 'running' : tournament.state === 'finished' ? 'finished' : 'paused').toUpperCase()} · {alive.length}/{players.length} {t('alive').toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {tournament.join_code && (
            <button
              onClick={() => setShowShare(true)}
              className="font-display text-2xl tracking-[0.4em] px-3 py-1.5 rounded-xl bg-brass-shine text-felt-950 shadow-glow"
              style={{ backgroundImage: 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)' }}
              title="Join code — tap to share"
            >
              {tournament.join_code}
            </button>
          )}
          <Link to={`/tournament/${tournament.id}/monitor`} className="btn-ghost text-sm !px-3 !py-2">
            📺
          </Link>
          <button onClick={() => setShowAdmin(true)} className="btn-ghost text-sm !px-3 !py-2" title="More">
            ⋯
          </button>
        </div>
      </header>

      {/* Big timer */}
      <Card className="bg-felt-radial relative overflow-hidden">
        <div className="grid grid-cols-3 gap-3 mb-3 text-center">
          <div>
            <div className="stat-label">Level</div>
            <div className="stat-value">{(clock.level?.level ?? 0)}</div>
          </div>
          <div>
            <div className="stat-label">Blinds</div>
            <div className="stat-value text-brass-200">
              {clock.level ? `${clock.level.sb}/${clock.level.bb}` : '—'}
            </div>
            {clock.level?.ante ? <div className="text-xs text-ink-400">ante {clock.level.ante}</div> : null}
          </div>
          <div>
            <div className="stat-label">Next</div>
            <div className="stat-value text-ink-200">
              {nextLevel ? `${nextLevel.sb}/${nextLevel.bb}` : '🏁'}
            </div>
          </div>
        </div>
        <motion.div
          className="font-display text-7xl tabular-nums text-center text-ink-50"
          animate={clock.msRemaining < 5000 && tournament.state === 'running' ? { color: ['#fff', '#f87171', '#fff'] } : {}}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {formatDuration(clock.msRemaining)}
        </motion.div>
        <div className="mt-4 flex gap-2">
          {tournament.state === 'running' ? (
            <Button variant="ghost" full onClick={pause}>{t('pause')}</Button>
          ) : (
            <Button full onClick={startOrResume}>{tournament.state === 'setup' ? t('start') : t('resume')}</Button>
          )}
          <Button variant="ghost" onClick={() => advanceLevel(-1)} disabled={clock.levelIndex === 0}>◀ {t('level')}</Button>
          <Button variant="ghost" onClick={() => advanceLevel(1)}>{t('level')} ▶</Button>
        </div>
      </Card>

      {/* Money */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('prizePool')} value={formatMoney(prizePool, currency)} />
        <StatCard label={t('bountyPool')} value={tournament.bounty_amount ? formatMoney(bountyPool, currency) : '—'} />
        <StatCard label={t('avgStack')} value={formatChips(avgStack)} />
      </div>

      {/* Color-up alert with smart swap math */}
      <AnimatePresence>
        {colorUps.length > 0 && (() => {
          // Estimate per-player chips of the doomed denominations from the
          // chip_distribution stored on the tournament (best info we have).
          const dist = (tournament.chip_distribution ?? {}) as Partial<Record<string, number>>;
          const perPlayer: Partial<Record<Denomination, number>> = {};
          for (const d of colorUps) perPlayer[d] = Number(dist[String(d)] ?? 0);
          const available = DENOMINATIONS.filter((d) => !colorUps.includes(d) && d > Math.max(...colorUps));
          const plan = planColorUp(perPlayer, colorUps, available);
          return (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="card-felt p-4 border-amber-500/40"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🎨</span>
                <div className="flex-1">
                  <div className="font-semibold text-amber-300">Color-up time</div>
                  <div className="text-xs text-ink-300">
                    {colorUps.map((d) => `T${d}`).join(', ')} are smaller than 5% of the BB.
                  </div>
                </div>
                <div className="flex gap-1">
                  {colorUps.map((d) => <Chip key={d} denom={d as Denomination} size="sm" />)}
                </div>
              </div>
              {plan.removedValuePerPlayer > 0 && plan.give.length > 0 && (
                <div className="bg-felt-950/60 rounded-lg px-3 py-2 mt-2 text-xs text-ink-200">
                  <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-1">
                    Swap (per player)
                  </div>
                  Collect {colorUps.map((d) => {
                    const n = perPlayer[d] ?? 0;
                    return n > 0 ? `${n}× T${d}` : null;
                  }).filter(Boolean).join(', ')}
                  {' → give back '}
                  {plan.give.map((g) => `${g.count}× T${g.give}`).join(' + ')}
                  {plan.remainder > 0 && <span className="text-amber-300"> · race off T{plan.remainder}</span>}
                </div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Payouts */}
      <Card>
        <p className="label">{t('payoutsLive')}</p>
        <div className="grid grid-cols-2 gap-2">
          {payouts.map((p) => (
            <div key={p.place} className="flex items-center justify-between bg-felt-950/60 rounded-lg px-3 py-2">
              <span className="text-ink-200 text-sm">
                {p.place === 1 ? '🥇 1st' : p.place === 2 ? '🥈 2nd' : p.place === 3 ? '🥉 3rd' : `${formatPlace(p.place)}`}
              </span>
              <span className="font-mono text-brass-200">{formatMoney(p.percent, currency)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Alive players */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="label !mb-0">{t('alive')} — {alive.length}</p>
        </div>
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {alive.map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 60, transition: { duration: 0.25 } }}
                className="flex items-center justify-between bg-felt-950/50 rounded-xl px-4 py-3 border border-felt-800"
              >
                <button
                  onClick={() => openEditPlayer(p)}
                  className="flex items-center gap-3 text-left"
                  title="Edit / remove"
                >
                  <span className="text-xl">{playerAvatar(p)}</span>
                  <div>
                    <div className="font-semibold">{playerName(p)}</div>
                    <div className="text-xs text-ink-400 flex gap-3 items-center">
                      {p.late_reg && p.entry_level && <span className="pill bg-amber-500/20 text-amber-200 text-[9px]">late · L{p.entry_level}</span>}
                      {p.rebuys > 0 && <span>🔁 {p.rebuys}</span>}
                      {p.addons > 0 && <span>➕ {p.addons}</span>}
                      {p.bounties_won > 0 && <span>💀 {p.bounties_won}</span>}
                    </div>
                  </div>
                </button>
                <div className="flex gap-1">
                  {tournament.tournament_type !== 'freezeout' && clock.levelIndex < tournament.rebuys_until_level && (
                    <Button variant="ghost" className="!px-3 !py-2 text-xs" onClick={() => setChipUp({ player: p, kind: 'rebuy' })}>{t('re')}</Button>
                  )}
                  <Button variant="ghost" className="!px-3 !py-2 text-xs" onClick={() => setChipUp({ player: p, kind: 'addon' })}>{t('add')}</Button>
                  <Button variant="danger" className="!px-3 !py-2 text-xs" onClick={() => setEliminating(p)}>{t('bust')}</Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      {/* Eliminated */}
      {out.length > 0 && (
        <Card>
          <p className="label">{t('eliminated')}</p>
          <ul className="space-y-1">
            {out.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => openEditPlayer(p)}
                  className="w-full flex items-center justify-between text-sm bg-felt-950/40 hover:bg-felt-900/60 rounded-lg px-3 py-2 transition"
                >
                  <span>{playerAvatar(p)} {playerName(p)}</span>
                  <span className="font-mono text-ink-300">
                    {p.finishing_position && formatPlace(p.finishing_position)} · {formatMoney(p.prize, currency)}
                    <span className="text-ink-500 ml-2 text-xs">✏️</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet
        open={!!editingPlayer}
        onClose={() => setEditingPlayer(null)}
        title={editingPlayer ? `Edit ${playerName(editingPlayer)}` : ''}
      >
        {editingPlayer && (
          <div className="space-y-4">
            <div>
              <label className="label">Finishing position</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditPosDraft((v) => Math.max(1, v - 1))}
                  className="w-12 h-12 rounded-xl bg-felt-800 text-2xl"
                >−</button>
                <input
                  type="number"
                  value={editPosDraft}
                  min={1}
                  onChange={(e) => setEditPosDraft(Math.max(1, Number(e.target.value)))}
                  className="input text-center font-mono text-2xl flex-1"
                />
                <button
                  onClick={() => setEditPosDraft((v) => v + 1)}
                  className="w-12 h-12 rounded-xl bg-felt-800 text-2xl"
                >+</button>
              </div>
              <p className="text-[11px] text-ink-400 mt-2 text-center">
                Prize will auto-update to {formatMoney(payouts.find((x) => x.place === editPosDraft)?.percent ?? 0, currency)}
              </p>
            </div>
            <Button full onClick={saveEditPlayer}>Save position</Button>
            <div className="border-t border-felt-800 pt-4 space-y-2">
              {editingPlayer.eliminated_at !== null && (
                <Button variant="ghost" full onClick={() => unbustPlayer(editingPlayer)}>
                  ↩ Bring back into the game
                </Button>
              )}
              <Button variant="danger" full onClick={() => removePlayer(editingPlayer)}>
                🗑 Remove from tournament entirely
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* SEAT CLAIM — auto-claims a matching seat when the user lands on the
          tournament if their stored name matches a roster slot. Otherwise
          shows a sheet to tap their name. */}
      {(() => {
        const userSeated = !!user && players.some((p) => p.profile_id === user.id);
        const showSeat = !!user && !userSeated && tournament.state !== 'finished';
        // Anyone except the host can be replaced — the host owns the night.
        const claimable = players.filter((p) => p.profile_id !== tournament.host_id);
        const seatName = (p: TournamentPlayer) =>
          p.guest_name ?? (p.profile_id ? profileMap[p.profile_id]?.display_name : null) ?? 'Open seat';
        const seatAvatar = (p: TournamentPlayer) =>
          p.profile_id ? profileMap[p.profile_id]?.avatar_emoji ?? '🃏' : '👤';
        const userHasRealName = !!profile?.display_name && profile.display_name !== 'Guest';
        const claimSeat = async (p: TournamentPlayer) => {
          if (!user) return;
          // Optimistic — flip the seat owner instantly so the sheet closes.
          patchPlayer(p.id, { profile_id: user.id, guest_name: null });
          await supabase.from('tournament_players')
            .update({ profile_id: user.id, guest_name: null })
            .eq('id', p.id);
          if (!userHasRealName) {
            const newName = seatName(p);
            if (newName && newName !== 'Open seat') {
              await supabase.from('profiles')
                .update({ display_name: newName })
                .eq('id', user.id);
              await refreshProfile();
            }
          }
        };

        // Auto-claim: if the user has a stored name and one of the roster
        // slots matches it (case-insensitive), claim it silently.
        if (showSeat && userHasRealName && !autoClaimedRef.current) {
          const target = claimable.find((p) =>
            seatName(p).toLowerCase() === profile!.display_name.toLowerCase(),
          );
          if (target) {
            autoClaimedRef.current = true;
            void claimSeat(target);
          }
        }
        const addNew = async () => {
          if (!user || !claimName.trim()) return;
          // If the tournament has already started, mark as late registration
          // so stats can distinguish them from full-stack starters.
          const isLate = tournament.state !== 'setup' && clock.levelIndex > 0;
          await supabase.from('tournament_players').insert({
            tournament_id: tournament.id,
            profile_id: user.id,
            late_reg: isLate,
            entry_level: isLate ? clock.levelIndex + 1 : null,
          });
          await supabase.from('profiles')
            .update({ display_name: claimName.trim() })
            .eq('id', user.id);
          await refreshProfile();
          setClaimName('');
        };
        return (
          <Sheet open={showSeat} onClose={() => { /* required, but UX-wise nothing to dismiss */ }} title="Take your seat">
            <p className="text-ink-300 text-sm mb-4">Tap your name on the roster to claim your seat — your buy-ins, knockouts and prize will all be tracked under it.</p>
            {claimable.length > 0 ? (
              <ul className="space-y-2 mb-4">
                {claimable.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => claimSeat(p)}
                      className="w-full flex items-center justify-between bg-felt-900/60 hover:bg-brass-500/15 border border-felt-700 hover:border-brass-500/50 rounded-xl px-4 py-3 text-left transition"
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-xl">{seatAvatar(p)}</span>
                        <span className="font-semibold">{seatName(p)}</span>
                      </span>
                      <span className="text-brass-300">claim →</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-400 text-sm mb-4">No claimable seats on the roster.</p>
            )}
            <div className="border-t border-felt-800 pt-4">
              <p className="label">Not on the list?</p>
              <Input
                value={claimName}
                onChange={(e) => setClaimName(e.target.value)}
                placeholder="Your name"
              />
              <Button full className="mt-3" onClick={addNew} disabled={!claimName.trim()}>
                Add me as a new player
              </Button>
            </div>
          </Sheet>
        );
      })()}

      {/* Invite sheet — friends scan, type the code, or copy the link */}
      <Sheet open={showShare} onClose={() => setShowShare(false)} title="Invite the table">
        {(() => {
          const url = typeof window !== 'undefined' ? window.location.href : '';
          const isLocal = typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
          return (
            <div className="text-center">
              {tournament.join_code && (
                <>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-brass-300 mb-2">Join code</div>
                  <div className="font-display text-7xl tracking-[0.5em] text-brass-shine mb-4">
                    {tournament.join_code}
                  </div>
                </>
              )}
              <p className="text-ink-300 text-sm mb-4">Open the app and tap “Quick join”, or scan the QR.</p>
              <div className="flex justify-center mb-4">
                <QRCode value={url} size={220} />
              </div>
              <div className="bg-felt-950/70 rounded-xl px-3 py-2 font-mono text-xs text-ink-200 break-all mb-3">{url}</div>
              <Button variant="ghost" full onClick={() => navigator.clipboard?.writeText(url)}>
                Copy player link
              </Button>
              {tournament.join_code && (
                <Button
                  variant="ghost"
                  full
                  className="mt-2"
                  onClick={() => {
                    const publicUrl = `${window.location.origin}/t/${tournament.join_code}/view`;
                    navigator.clipboard?.writeText(publicUrl);
                  }}
                >
                  📺 Copy spectator link (no login)
                </Button>
              )}
              {isLocal && (
                <p className="text-amber-400 text-xs mt-3">
                  ⚠ You're on <span className="font-mono">localhost</span> — friends on other phones can't reach this URL.
                  Open the app via the LAN IP (e.g. <span className="font-mono">http://10.0.0.14:5173</span>) so QR/link works.
                </p>
              )}
            </div>
          );
        })()}
      </Sheet>

      {/* Admin / lifecycle */}
      <Sheet open={showAdmin} onClose={() => setShowAdmin(false)} title="Tournament">
        <div className="space-y-3">
          <Button variant="ghost" full onClick={() => { setRenaming(tournament.name); setShowAdmin(false); }}>
            ✏️ {t('rename')}
          </Button>
          {seasons.length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-widest text-ink-400 mb-1 block">🏷 Season</label>
              <select
                value={tournament.season_id ?? ''}
                onChange={async (e) => {
                  const v = e.target.value || null;
                  patchTournament({ season_id: v });
                  await supabase.from('tournaments').update({ season_id: v }).eq('id', tournament.id);
                }}
                className="input w-full text-sm"
              >
                <option value="">— No season —</option>
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={async () => {
              const next = !tournament.auto_advance;
              patchTournament({ auto_advance: next });
              await supabase.from('tournaments').update({ auto_advance: next }).eq('id', tournament.id);
            }}
            className="w-full flex items-center justify-between rounded-xl border px-4 py-3 bg-felt-900/60 border-felt-700 text-ink-100"
          >
            <span>
              <div className="font-semibold text-sm text-left">{t('autoAdvance')}</div>
              <div className="text-[11px] text-ink-400 text-left">{t('autoAdvanceHint')}</div>
            </span>
            <span className={`w-12 h-7 rounded-full relative ${tournament.auto_advance ? 'bg-brass-500' : 'bg-felt-700'}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition ${tournament.auto_advance ? 'left-5' : 'left-0.5'}`} />
            </span>
          </button>
          <Button variant="ghost" full onClick={cloneTournament}>
            {t('cloneForNextTime')}
          </Button>
          {tournament.state === 'finished' && (
            <Button variant="ghost" full onClick={shareResults}>
              {t('shareResultsCard')}
            </Button>
          )}
          {tournament.state !== 'finished' && (
            <Button variant="ghost" full onClick={endTournament}>
              {t('endTournamentNow')}
              <span className="text-xs text-ink-400 ml-2">{t('movesToHistory')}</span>
            </Button>
          )}
          <Button variant="danger" full onClick={deleteTournament}>
            {t('deleteTournament')}
          </Button>
          <p className="text-xs text-ink-400 text-center pt-2">
            {t('bankTxKept')}
          </p>
        </div>
      </Sheet>

      <Sheet open={renaming !== null} onClose={() => setRenaming(null)} title={t('rename')}>
        <Input
          value={renaming ?? ''}
          onChange={(e) => setRenaming(e.target.value)}
          placeholder={t('tournamentName')}
          autoFocus
        />
        <Button full className="mt-4" onClick={saveRename} disabled={!renaming?.trim()}>
          {t('save')}
        </Button>
      </Sheet>

      {/* Re-buy / Add-on confirmation with bank option */}
      <Sheet
        open={!!chipUp}
        onClose={() => { setChipUp(null); setChipUpFromBank(false); }}
        title={chipUp ? `${chipUp.kind === 'rebuy' ? 'Re-buy' : 'Add-on'} for ${playerName(chipUp.player)}` : ''}
      >
        {chipUp && (() => {
          const amount = chipUp.kind === 'rebuy'
            ? Number(tournament.rebuy_amount ?? tournament.buy_in)
            : Number(tournament.addon_amount ?? tournament.buy_in);
          return (
            <>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-widest text-ink-400">Amount</div>
                <div className="font-display text-4xl text-brass-shine mt-1">{formatMoney(amount, tournament.currency)}</div>
              </div>
              <BankToggle on={chipUpFromBank} setOn={setChipUpFromBank} amount={amount} currency={tournament.currency} />
              <Button full onClick={confirmChipUp} className="mt-4">
                Record {chipUp.kind === 'rebuy' ? 're-buy' : 'add-on'}{chipUpFromBank ? ' · from 🏦' : ''}
              </Button>
            </>
          );
        })()}
      </Sheet>

      {/* Bust target picker */}
      <Sheet open={!!eliminating} onClose={() => setEliminating(null)} title={`Bust ${eliminating ? playerName(eliminating) : ''}`}>
        {eliminating && (
          <>
            <p className="text-ink-300 text-sm mb-4">Who knocked them out? {tournament.bounty_amount > 0 && '(bounty payout)'}</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {alive.filter((p) => p.id !== eliminating.id).map((k) => (
                <button
                  key={k.id}
                  onClick={() => eliminate(eliminating, k.id)}
                  className="flex items-center gap-2 bg-felt-950/60 hover:bg-felt-800 border border-felt-700 rounded-xl p-3"
                >
                  <span className="text-xl">{playerAvatar(k)}</span>
                  <span className="font-semibold text-sm">{playerName(k)}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" full onClick={() => eliminate(eliminating)}>No bounty / unknown</Button>
          </>
        )}
      </Sheet>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-felt-card border border-felt-800 rounded-xl p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-ink-400">{label}</div>
      <div className="font-display text-2xl text-brass-200 mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function BankToggle({ on, setOn, amount, currency }: {
  on: boolean; setOn: (v: boolean) => void; amount: number; currency: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className={`mt-3 w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
        on ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-200'
      }`}
    >
      <div>
        <div className="font-semibold text-sm">Pay from bank 🏦</div>
        <div className="text-[11px] text-ink-400">Debits {formatMoney(amount, currency)} from their account.</div>
      </div>
      <div className={`w-12 h-7 rounded-full relative transition ${on ? 'bg-brass-500' : 'bg-felt-700'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition ${on ? 'left-5' : 'left-0.5'}`} />
      </div>
    </button>
  );
}
