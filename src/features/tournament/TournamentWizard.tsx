import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/Chip';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { supabase } from '@/lib/supabase';
import { BLIND_TEMPLATES, estimatedFinishTime, recommendedTemplateId, templateById, totalDurationMin } from './BlindStructures';
import { PAYOUT_PRESETS, presetById } from './payouts';
import { generateJoinCode } from '@/lib/joinCode';
import {
  suggestStartingStack,
  suggestStackSize,
  totalChipValue,
  type Denomination,
} from '@/lib/chipSet';
import { formatChips, formatMoney } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import { useEffect } from 'react';
import { useSeason } from '@/store/season';
import { useT } from '@/lib/i18n';
import type { Profile, TournamentTemplate } from '@/types/db';

type Step = 'setup' | 'players' | 'structure' | 'review';

interface PlayerPick { profileId?: string; guestName?: string; }

export function TournamentWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currency, inventory } = useSettings();

  const [step, setStep] = useState<Step>('setup');

  const toast = useToast();
  const t = useT();
  const { activeSeasonId } = useSeason();

  // setup
  const [name, setName] = useState(`Poker night ${new Date().toLocaleDateString('nb-NO')}`);
  const [buyIn, setBuyIn] = useState(200);
  const [rebuyAmount, setRebuyAmount] = useState(200);
  const [addonAmount, setAddonAmount] = useState(200);
  const [bountyAmount, setBountyAmount] = useState(0);
  const [rebuysUntilLevel, setRebuysUntilLevel] = useState(6);
  const [rakePercent, setRakePercent] = useState(0);
  const [dealerTipPercent, setDealerTipPercent] = useState(0);
  const [tournamentType, setTournamentType] = useState<'rebuy' | 'freezeout' | 'reentry' | 'bounty'>('rebuy');

  // templates
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  useEffect(() => {
    supabase.from('tournament_templates').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setTemplates((data ?? []) as TournamentTemplate[]);
    });
  }, []);

  const applyTemplate = (tpl: TournamentTemplate) => {
    setName(tpl.name);
    setBuyIn(Number(tpl.buy_in));
    setRebuyAmount(Number(tpl.rebuy_amount ?? 0));
    setAddonAmount(Number(tpl.addon_amount ?? 0));
    setBountyAmount(Number(tpl.bounty_amount));
    setRebuysUntilLevel(tpl.rebuys_until_level);
    setRakePercent(Number(tpl.rake_percent));
    setDealerTipPercent(Number(tpl.dealer_tip_percent));
    setStackSize(tpl.starting_stack);
    toast(t('loadedTemplate', { name: tpl.name }), 'success');
  };

  const saveAsTemplate = async () => {
    if (!user) return;
    const tpl = {
      owner_id: user.id, name,
      buy_in: buyIn, rebuy_amount: rebuyAmount, addon_amount: addonAmount,
      starting_stack: effectiveStack, rebuy_stack: effectiveStack,
      addon_stack: Math.round(effectiveStack * 1.5),
      bounty_amount: bountyAmount, rebuys_until_level: rebuysUntilLevel,
      blind_structure: template.levels, payout_structure: payoutSlots,
      rake_percent: rakePercent, dealer_tip_percent: dealerTipPercent, currency,
    };
    const { error } = await supabase.from('tournament_templates').insert(tpl);
    if (error) toast(error.message, 'error'); else toast(t('templateSaved'), 'success');
  };

  // players
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [picked, setPicked] = useState<PlayerPick[]>([]);
  const [guestDraft, setGuestDraft] = useState('');
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  // structure
  const [templateId, setTemplateId] = useState('home-night');
  const [autoTemplate, setAutoTemplate] = useState(true);
  const [payoutPresetId, setPayoutPresetId] = useState('standard');
  const [stackSize, setStackSize] = useState(0);

  const playerCount = picked.length;
  const recommendedId = recommendedTemplateId(playerCount);

  // Auto-follow the recommendation until the user picks something explicitly.
  const effectiveTemplateId = autoTemplate ? recommendedId : templateId;
  const template = useMemo(() => templateById(effectiveTemplateId), [effectiveTemplateId]);
  const payoutPreset = useMemo(() => presetById(payoutPresetId), [payoutPresetId]);

  const effectiveStack = stackSize || (playerCount > 0 ? suggestStackSize(inventory, playerCount) : template.recommendedStack);
  const smallestBlind = (template.levels[0]?.sb ?? 25) as Denomination;
  const stackSuggestion = useMemo(
    () => playerCount > 0
      ? suggestStartingStack(inventory, playerCount, effectiveStack, { smallestChip: smallestBlind })
      : null,
    [inventory, playerCount, effectiveStack, smallestBlind],
  );
  const payoutSlots = useMemo(() => payoutPreset.pick(Math.max(playerCount, 1)), [payoutPreset, playerCount]);
  const totalPool = playerCount * (buyIn - bountyAmount);
  const totalBountyPool = playerCount * bountyAmount;

  const loadProfiles = async () => {
    if (profilesLoaded) return;
    const { data } = await supabase.from('profiles').select('*').order('display_name');
    if (data) setAllProfiles(data as Profile[]);
    setProfilesLoaded(true);
    if (user && !picked.find((p) => p.profileId === user.id)) {
      setPicked((prev) => [{ profileId: user.id }, ...prev]);
    }
  };

  const togglePicked = (p: PlayerPick) => {
    setPicked((prev) => {
      const exists = prev.find(
        (x) => (p.profileId && x.profileId === p.profileId) || (p.guestName && x.guestName === p.guestName),
      );
      if (exists) return prev.filter((x) => x !== exists);
      return [...prev, p];
    });
  };

  const addGuest = () => {
    if (!guestDraft.trim()) return;
    setPicked((prev) => [...prev, { guestName: guestDraft.trim() }]);
    setGuestDraft('');
  };

  const stepIndex = ['setup', 'players', 'structure', 'review'].indexOf(step);

  const create = async () => {
    if (!user) return;
    // Try a few times in case of (very unlikely) join-code collision.
    let inserted: { id: string } | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < 5 && !inserted; i++) {
      const code = generateJoinCode();
      const res = await supabase
        .from('tournaments')
        .insert({
          host_id: user.id,
          name,
          buy_in: buyIn,
          rebuy_amount: rebuyAmount,
          addon_amount: addonAmount,
          starting_stack: effectiveStack,
          rebuy_stack: effectiveStack,
          addon_stack: Math.round(effectiveStack * 1.5),
          bounty_amount: bountyAmount,
          rebuys_until_level: rebuysUntilLevel,
          blind_structure: template.levels,
          payout_structure: payoutSlots,
          chip_distribution: stackSuggestion?.perPlayer ?? null,
          currency,
          join_code: code,
          rake_percent: rakePercent,
          dealer_tip_percent: dealerTipPercent,
          tournament_type: tournamentType,
          season_id: activeSeasonId,
        })
        .select()
        .single();
      if (!res.error) inserted = res.data as { id: string };
      else lastErr = res.error;
    }
    const t = inserted;
    const error = inserted ? null : lastErr as Error;
    if (error || !t) {
      alert(error?.message ?? 'Failed to create tournament');
      return;
    }
    if (picked.length) {
      await supabase.from('tournament_players').insert(
        picked.map((p) => ({
          tournament_id: t.id,
          profile_id: p.profileId ?? null,
          guest_name: p.guestName ?? null,
        })),
      );
    }
    navigate(`/tournament/${t.id}`);
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl text-brass-shine">{t('newTournament')}</h1>
        <p className="text-ink-400 text-sm mt-1">{t('stepXofY', { x: stepIndex + 1, y: 4, label: t(`step${step.charAt(0).toUpperCase() + step.slice(1)}` as 'stepSetup') })}</p>
        <div className="mt-3 h-1.5 bg-felt-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-brass-shine"
            initial={{ width: 0 }}
            animate={{ width: `${((stepIndex + 1) / 4) * 100}%` }}
            transition={{ type: 'spring', damping: 20 }}
          />
        </div>
      </header>

      {step === 'setup' && (
        <Card className="space-y-4">
          {templates.length > 0 && (
            <div>
              <p className="label">{t('loadTemplate')}</p>
              <div className="flex flex-wrap gap-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="pill bg-felt-800/70 border border-felt-700 hover:border-brass-500/50"
                  >📋 {tpl.name}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="label">{t('format')}</p>
            <div className="grid grid-cols-4 gap-2">
              {([
                ['rebuy', t('formatRebuy'), '🔁'],
                ['freezeout', t('formatFreezeout'), '🧊'],
                ['reentry', t('formatReentry'), '↻'],
                ['bounty', t('formatBounty'), '💀'],
              ] as const).map(([id, label, ico]) => (
                <button
                  key={id}
                  onClick={() => setTournamentType(id)}
                  className={`p-2 rounded-xl border text-center text-xs ${
                    tournamentType === id ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-300'
                  }`}
                >
                  <div className="text-lg">{ico}</div>
                  <div className="font-semibold mt-1">{label}</div>
                </button>
              ))}
            </div>
          </div>
          <Input label={t('tournamentName')} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('buyIn')} type="number" value={buyIn} suffix={currency}
              onChange={(e) => setBuyIn(Number(e.target.value))} />
            <Input label={t('bounty')} type="number" value={bountyAmount} suffix={currency}
              onChange={(e) => setBountyAmount(Number(e.target.value))}
              hint={t('bountyHint')} />
            <Input label={t('rebuy')} type="number" value={rebuyAmount} suffix={currency}
              onChange={(e) => setRebuyAmount(Number(e.target.value))} />
            <Input label={t('addon')} type="number" value={addonAmount} suffix={currency}
              onChange={(e) => setAddonAmount(Number(e.target.value))} />
            <Input label={t('rebuysUntilLevel')} type="number" value={rebuysUntilLevel}
              onChange={(e) => setRebuysUntilLevel(Number(e.target.value))} />
            <Input label={t('rakePercent')} type="number" value={rakePercent} suffix="%"
              onChange={(e) => setRakePercent(Number(e.target.value))}
              hint={t('rakeHint')} />
            <Input label={t('dealerTipPercent')} type="number" value={dealerTipPercent} suffix="%"
              onChange={(e) => setDealerTipPercent(Number(e.target.value))}
              hint={t('dealerTipHint')} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={saveAsTemplate}>{t('saveAsTemplate')}</Button>
            <Button full onClick={() => { setStep('players'); loadProfiles(); }}>
              {t('nextPickPlayers')}
            </Button>
          </div>
        </Card>
      )}

      {step === 'players' && (
        <Card className="space-y-4">
          <div>
            <p className="label">Friends</p>
            <div className="space-y-2">
              {allProfiles.map((p) => {
                const on = !!picked.find((x) => x.profileId === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePicked({ profileId: p.id })}
                    className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition ${
                      on ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700/60 text-ink-100'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-xl">{p.avatar_emoji ?? '🃏'}</span>
                      <span className="font-semibold">{p.display_name}</span>
                      {p.id === user?.id && <span className="pill bg-brass-500/20 text-brass-200">You · Host</span>}
                    </span>
                    <span className="text-2xl leading-none">{on ? '✓' : '＋'}</span>
                  </button>
                );
              })}
              {allProfiles.length === 0 && (
                <p className="text-ink-400 text-sm">No registered friends yet — add guests below for tonight, they can sign up later.</p>
              )}
            </div>
          </div>

          <div>
            <p className="label">Guest player</p>
            <div className="flex gap-2">
              <Input
                value={guestDraft}
                onChange={(e) => setGuestDraft(e.target.value)}
                placeholder="e.g. Lars"
                onKeyDown={(e) => e.key === 'Enter' && addGuest()}
              />
              <Button variant="ghost" type="button" onClick={addGuest}>Add</Button>
            </div>
            {picked.filter((p) => p.guestName).length > 0 && (
              <ul className="mt-2 space-y-1">
                {picked.filter((p) => p.guestName).map((p) => (
                  <li key={p.guestName} className="flex items-center justify-between text-sm bg-felt-900/60 rounded-lg px-3 py-2">
                    <span>👤 {p.guestName}</span>
                    <button className="text-red-400" onClick={() => togglePicked(p)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-ink-200">{playerCount} player{playerCount === 1 ? '' : 's'}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('setup')}>Back</Button>
              <Button onClick={() => setStep('structure')} disabled={playerCount < 2}>Next →</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'structure' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-2">
              <p className="label !mb-0">Blind structure</p>
              <span className="text-[10px] text-ink-400">
                ≈ {totalDurationMin(template)} min · ends ~{estimatedFinishTime(template)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BLIND_TEMPLATES.map((t) => {
                const active = effectiveTemplateId === t.id;
                const recommended = t.id === recommendedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setAutoTemplate(false);
                      setTemplateId(t.id);
                      if (!stackSize) setStackSize(t.recommendedStack);
                    }}
                    className={`relative rounded-xl p-3 text-left border transition ${
                      active ? 'bg-brass-500/15 border-brass-500/50' : 'bg-felt-900/60 border-felt-700/60'
                    }`}
                  >
                    {recommended && (
                      <span className="absolute -top-2 right-2 pill bg-brass-500 text-felt-950 text-[9px]">
                        recommended
                      </span>
                    )}
                    <div className="font-display text-lg text-brass-200">{t.name}</div>
                    <div className="text-[10px] text-ink-400 leading-tight">{t.description}</div>
                    <div className="text-[10px] text-brass-300 mt-1 font-mono">
                      ≈ {totalDurationMin(t)} min · ~{estimatedFinishTime(t)}
                    </div>
                  </button>
                );
              })}
            </div>
            {!autoTemplate && effectiveTemplateId !== recommendedId && (
              <button
                onClick={() => setAutoTemplate(true)}
                className="text-[11px] text-ink-400 underline mt-2"
              >
                ↩ use recommended for {playerCount} players
              </button>
            )}
          </Card>

          <Card>
            <p className="label">Payouts</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {PAYOUT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPayoutPresetId(p.id)}
                  className={`rounded-xl p-3 text-sm font-semibold border transition ${
                    payoutPresetId === p.id ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700/60 text-ink-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {payoutSlots.map((s) => (
                <div key={s.place} className="flex items-center justify-between bg-felt-950/60 rounded-lg px-3 py-2 text-sm">
                  <span className="text-ink-300">{s.place === 1 ? '🥇' : s.place === 2 ? '🥈' : s.place === 3 ? '🥉' : `${s.place}th`}</span>
                  <span className="font-mono text-brass-200">{s.percent}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <p className="label">Starting stack</p>
            <Input
              type="number"
              value={effectiveStack}
              onChange={(e) => setStackSize(Number(e.target.value))}
              suffix="chips"
              hint={`Inventory holds ${formatChips(totalChipValue(inventory))} total chip value across all chips.`}
            />
            {stackSuggestion && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-widest text-ink-400 mb-2">Per-player chip distribution</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stackSuggestion.perPlayer).map(([d, n]) => (
                    <div key={d} className="flex items-center gap-2 bg-felt-950/70 rounded-lg px-3 py-2">
                      <Chip denom={Number(d) as Denomination} size="sm" />
                      <span className="font-mono text-sm">×{n}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink-300">
                  Effective stack: <span className="font-mono text-brass-200">{formatChips(stackSuggestion.actualTotal)}</span>
                  {' · '}
                  Total chips out: <span className="font-mono text-brass-200">{formatChips(stackSuggestion.actualTotal * playerCount)}</span>
                </p>
                {stackSuggestion.warnings.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {stackSuggestion.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-400">⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('players')}>Back</Button>
            <Button onClick={() => setStep('review')}>Next →</Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <Card>
            <h2 className="font-display text-2xl text-brass-shine mb-3">{name}</h2>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Players" value={String(playerCount)} />
              <Stat label="Buy-in" value={formatMoney(buyIn, currency)} />
              <Stat label="Stack" value={formatChips(effectiveStack)} />
              <Stat label="Pool" value={formatMoney(totalPool, currency)} />
              <Stat label="Bounty pool" value={bountyAmount ? formatMoney(totalBountyPool, currency) : '—'} />
              <Stat label="Levels" value={String(template.levels.length)} />
            </div>
          </Card>

          <Card>
            <p className="label">Blinds</p>
            <div className="grid grid-cols-4 gap-1 text-xs font-mono">
              <div className="text-ink-400 uppercase">Lvl</div>
              <div className="text-ink-400 uppercase">SB / BB</div>
              <div className="text-ink-400 uppercase">Ante</div>
              <div className="text-ink-400 uppercase text-right">Min</div>
              {template.levels.map((l) => (
                <FragmentRow key={l.level} level={l} />
              ))}
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('structure')}>Back</Button>
            <Button onClick={create}>Start tournament 🚀</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-felt-950/60 rounded-xl p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-ink-400">{label}</div>
      <div className="font-display text-2xl text-brass-200 mt-1">{value}</div>
    </div>
  );
}

function FragmentRow({ level }: { level: import('@/types/db').BlindLevel }) {
  return (
    <>
      <div className="text-ink-200">{level.level}</div>
      <div className="text-ink-100">{level.sb} / {level.bb}</div>
      <div className="text-ink-300">{level.ante ?? '—'}</div>
      <div className="text-right text-ink-300">{level.durationMin}{level.breakAfter && ' ⏸'}</div>
    </>
  );
}
