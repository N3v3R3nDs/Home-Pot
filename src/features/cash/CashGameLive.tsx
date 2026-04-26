import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Sheet } from '@/components/ui/Sheet';
import { useConfirm } from '@/components/ui/Confirm';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/lib/i18n';
import type { Season } from '@/types/db';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { formatMoney } from '@/lib/format';
import { useCashGame } from '@/hooks/useCashGame';
import { useRedirectOnOrientation } from '@/hooks/useFullscreen';
import { suggestStartingStack, type ChipInventory, type Denomination } from '@/lib/chipSet';
import { Chip } from '@/components/Chip';
import { computeSettlements } from './settle';
import { recordBankTx } from '@/lib/bank';
import { renderCashShareCard, shareCard } from '@/lib/shareCard';
import type { CashGamePlayer, Profile } from '@/types/db';

export function CashGameLive() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currency, inventory } = useSettings();
  const toast = useToast();
  const {
    game, players, buyIns, profileMap,
    patchGame, patchPlayer, addPlayer: addPlayerLocal, addBuyIn,
  } = useCashGame(id);
  useRedirectOnOrientation('landscape', id ? `/cash/${id}/monitor` : '');
  const [adding, setAdding] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [defaultBuyIn, setDefaultBuyIn] = useState(500);
  const [seatingFor, setSeatingFor] = useState<{ profile_id?: string; guest?: string; name: string } | null>(null);
  const [seatAmount, setSeatAmount] = useState(500);
  const [seatFromBank, setSeatFromBank] = useState(false);
  const [topUpFor, setTopUpFor] = useState<CashGamePlayer | null>(null);
  const [topUpAmount, setTopUpAmount] = useState(500);
  const [cashOutFor, setCashOutFor] = useState<CashGamePlayer | null>(null);
  const [cashOutAmount, setCashOutAmount] = useState(0);
  const [topUpFromBank, setTopUpFromBank] = useState(false);
  const [leaveInBank, setLeaveInBank] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [recentGuests, setRecentGuests] = useState<string[]>([]);
  const confirm = useConfirm();
  const t = useT();

  // Load registered members + recent guest names so the host can re-seat the
  // same regulars in one tap (links by profile_id or guest_name → stats + bank
  // roll up across sessions).
  useEffect(() => {
    if (!adding) return;
    if (allProfiles.length > 0 && recentGuests.length > 0) return;
    (async () => {
      const [{ data: profs }, { data: tPlayers }, { data: cPlayers }] = await Promise.all([
        supabase.from('profiles').select('*').order('display_name'),
        supabase.from('tournament_players').select('guest_name, created_at')
          .not('guest_name', 'is', null)
          .order('created_at', { ascending: false }).limit(120),
        supabase.from('cash_game_players').select('guest_name, created_at')
          .not('guest_name', 'is', null)
          .order('created_at', { ascending: false }).limit(120),
      ]);
      if (profs) setAllProfiles(profs as Profile[]);
      const seen = new Map<string, number>();
      for (const r of [...(tPlayers ?? []), ...(cPlayers ?? [])]) {
        const name = ((r as { guest_name: string }).guest_name ?? '').trim();
        if (!name) continue;
        const ts = Date.parse((r as { created_at: string }).created_at);
        if (!seen.has(name) || ts > seen.get(name)!) seen.set(name, ts);
      }
      setRecentGuests(Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 24));
    })();
  }, [adding, allProfiles.length, recentGuests.length]);

  useEffect(() => {
    supabase.from('seasons').select('*').order('starts_on', { ascending: false })
      .then(({ data }) => setSeasons((data ?? []) as Season[]));
  }, []);


  const playerName = (p: CashGamePlayer) =>
    p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
  const playerAvatar = (p: CashGamePlayer) =>
    p.profile_id ? profileMap[p.profile_id]?.avatar_emoji ?? '🃏' : '👤';

  const totals = useMemo(() => {
    const map: Record<string, { in: number; out: number }> = {};
    for (const p of players) map[p.id] = { in: 0, out: p.cash_out ?? 0 };
    for (const b of buyIns) {
      if (map[b.cash_game_player_id]) map[b.cash_game_player_id].in += b.amount;
    }
    return map;
  }, [players, buyIns]);

  const totalOnTable = players.reduce(
    (s, p) => s + (totals[p.id]?.in ?? 0) - (p.cash_out ?? 0),
    0,
  );

  const positions = players.map((p) => {
    const t = totals[p.id] ?? { in: 0, out: 0 };
    return {
      id: p.id,
      name: playerName(p),
      net: (p.cash_out ?? 0) - t.in,        // null cash_out => still in: net is -in (down by their stack)
    };
  });

  const settlements = computeSettlements(positions);

  const openSeating = (profile_id: string | undefined, guest: string | undefined, name: string) => {
    setSeatAmount(defaultBuyIn);
    setSeatFromBank(false);
    setSeatingFor({ profile_id, guest, name });
  };

  const confirmSeat = async () => {
    if (!seatingFor || !id || !game) return;
    const { profile_id, guest } = seatingFor;
    const amount = seatAmount;
    const useBank = seatFromBank;
    setSeatingFor(null);
    setGuestName('');
    setAdding(false);
    setDefaultBuyIn(amount);

    const { data: p } = await supabase.from('cash_game_players').insert({
      cash_game_id: id,
      profile_id: profile_id ?? null,
      guest_name: guest ?? null,
    }).select().single();
    if (p) {
      addPlayerLocal(p as CashGamePlayer);
      if (amount > 0) {
        const { data: bi } = await supabase.from('cash_buy_ins').insert({
          cash_game_player_id: p.id, amount,
        }).select().single();
        if (bi) addBuyIn(bi as import('@/types/db').CashBuyIn);
        if (useBank) {
          await recordBankTx({
            profile_id, guest_name: guest, amount: -amount,
            currency: game.currency, kind: 'cash_buy_in',
            ref_table: 'cash_games', ref_id: id,
            note: `Buy-in for ${game.name}`,
          });
        }
      }
    }
  };

  const topUp = async () => {
    if (!topUpFor || !game) return;
    const target = topUpFor;
    const amount = topUpAmount;
    const useBank = topUpFromBank;
    setTopUpFor(null); setTopUpFromBank(false);

    const { data: bi } = await supabase.from('cash_buy_ins').insert({
      cash_game_player_id: target.id, amount,
    }).select().single();
    if (bi) addBuyIn(bi as import('@/types/db').CashBuyIn);

    if (useBank) {
      await recordBankTx({
        profile_id: target.profile_id, guest_name: target.guest_name,
        amount: -amount,
        currency: game.currency, kind: 'cash_buy_in',
        ref_table: 'cash_games', ref_id: id,
        note: `Top-up for ${game.name}`,
      });
    }
  };

  const saveRename = async () => {
    if (renaming === null || !renaming.trim() || !game) return;
    const newName = renaming.trim();
    patchGame({ name: newName });
    setRenaming(null);
    await supabase.from('cash_games').update({ name: newName }).eq('id', game.id);
  };
  const endCashGame = async () => {
    if (!game) return;
    const stillIn = players.filter((p) => p.cash_out === null);
    if (stillIn.length > 0) {
      const ok = await confirm({
        title: t('endCashGameQ'),
        message: t('endCashGameBody', { n: stillIn.length }),
        confirmLabel: t('endAnyway'),
      });
      if (!ok) return;
    }
    setShowAdmin(false);
    const endedAt = new Date().toISOString();
    patchGame({ state: 'finished', ended_at: endedAt });
    await supabase.from('cash_games').update({ state: 'finished', ended_at: endedAt }).eq('id', game.id);
    navigate('/history');
  };
  const deleteCashGame = async () => {
    if (!game) return;
    const ok = await confirm({
      title: t('deleteX', { name: game.name }),
      message: t('deleteCBody'),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!ok) return;
    setShowAdmin(false);
    navigate('/');
    await supabase.from('cash_games').update({ deleted_at: new Date().toISOString() }).eq('id', game.id);
  };

  const cashOut = async () => {
    if (!cashOutFor || !game) return;
    const target = cashOutFor;
    const amount = cashOutAmount;
    const useBank = leaveInBank;
    setCashOutFor(null); setLeaveInBank(false);

    patchPlayer(target.id, { cash_out: amount });

    await supabase.from('cash_game_players').update({ cash_out: amount }).eq('id', target.id);

    if (useBank && amount > 0) {
      await recordBankTx({
        profile_id: target.profile_id, guest_name: target.guest_name,
        amount,
        currency: game.currency, kind: 'cash_close',
        ref_table: 'cash_games', ref_id: id,
        note: `Left in bank from ${game.name}`,
      });
    }
  };

  const copySpectatorLink = () => {
    if (!game?.join_code) return;
    const url = `${window.location.origin}/c/${game.join_code}/view`;
    navigator.clipboard?.writeText(url);
    toast(t('spectatorLinkCopied'), 'success');
  };

  if (!game) return <div>Loading…</div>;

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-3xl text-brass-shine truncate">{game.name}</h1>
          <p className="text-ink-400 text-sm">
            {game.small_blind}/{game.big_blind} {game.currency} · {players.length} player{players.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {game.join_code && (
            <span
              className="font-display text-xl tracking-[0.4em] px-3 py-1.5 rounded-xl text-felt-950 shadow-glow"
              style={{ backgroundImage: 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)' }}
              title="Join code"
            >
              {game.join_code}
            </span>
          )}
          <Link
            to={`/cash/${game.id}/monitor`}
            className="btn-ghost text-sm !px-3 !py-2"
            title={t('tableMonitor')}
          >
            📺
          </Link>
          <button onClick={() => setShowAdmin(true)} className="btn-ghost text-sm !px-3 !py-2" title="More">
            ⋯
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t('onTheTable')} value={formatMoney(totalOnTable, currency)} />
        <StatCard label={t('totalBoughtIn')} value={formatMoney(players.reduce((s, p) => s + (totals[p.id]?.in ?? 0), 0), currency)} />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="label !mb-0">Players</p>
          <Button variant="ghost" className="!px-3 !py-2 text-xs" onClick={() => setAdding(true)}>＋ Add</Button>
        </div>
        <ul className="space-y-2">
          {players.map((p) => {
            const t = totals[p.id] ?? { in: 0, out: 0 };
            const net = (p.cash_out ?? 0) - t.in;
            const isOut = p.cash_out !== null;
            return (
              <motion.li key={p.id} layout className="bg-felt-950/60 rounded-xl p-3 border border-felt-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{playerAvatar(p)}</span>
                    <div>
                      <div className="font-semibold">{playerName(p)}{isOut && <span className="ml-2 pill bg-felt-800 text-ink-300">cashed out</span>}</div>
                      <div className="text-xs text-ink-400">In {formatMoney(t.in, currency)}{isOut && ` · Out ${formatMoney(p.cash_out ?? 0, currency)}`}</div>
                    </div>
                  </div>
                  <div className={`font-mono text-lg ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-ink-200'}`}>
                    {net >= 0 ? '+' : ''}{formatMoney(net, currency)}
                  </div>
                </div>
                {!isOut && (
                  <div className="mt-2 flex gap-2 justify-end">
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { setTopUpFor(p); setTopUpAmount(defaultBuyIn); }}>+ Buy-in</Button>
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { setCashOutFor(p); setCashOutAmount(t.in); }}>Cash out</Button>
                  </div>
                )}
              </motion.li>
            );
          })}
          {players.length === 0 && <li className="text-ink-400 text-sm">No players yet.</li>}
        </ul>
      </Card>

      {settlements.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <p className="label !mb-0">Settle up</p>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 text-xs"
              onClick={async () => {
                if (!game) return;
                const blob = await renderCashShareCard({
                  title: game.name,
                  totalOnTable,
                  totalBoughtIn: players.reduce((s, p) => s + (totals[p.id]?.in ?? 0), 0),
                  settlements,
                  currency,
                });
                await shareCard(blob, `${game.name.replace(/\s+/g, '-')}-settle.png`, `${game.name} — settle up`);
              }}
            >
              📤 Share
            </Button>
          </div>
          <ul className="space-y-2">
            {settlements.map((s, i) => {
              // Deep links — works if the recipient has Vipps / Venmo installed.
              // Vipps spec: vipps://send?phoneNumber=...&amount=...&currency=NOK
              // Venmo spec: venmo://paycharge?txn=pay&amount=...&note=...
              const noteText = encodeURIComponent(`Poker: ${game.name}`);
              const vipps = `vipps://send?amount=${s.amount.toFixed(0)}&currency=${currency}&comment=${noteText}`;
              const venmo = `venmo://paycharge?txn=pay&amount=${s.amount.toFixed(2)}&note=${noteText}`;
              return (
                <li key={i} className="bg-felt-950/60 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm"><span className="text-red-400">{s.fromName}</span> → <span className="text-emerald-400">{s.toName}</span></span>
                    <span className="font-mono text-brass-200">{formatMoney(s.amount, currency)}</span>
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    <a href={vipps} className="pill bg-brass-500/15 border border-brass-500/30 text-brass-200 text-[10px]">Vipps</a>
                    <a href={venmo} className="pill bg-brass-500/15 border border-brass-500/30 text-brass-200 text-[10px]">Venmo</a>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Sheet open={showAdmin} onClose={() => setShowAdmin(false)} title="Cash game">
        <div className="space-y-3">
          <Button variant="ghost" full onClick={() => { setRenaming(game.name); setShowAdmin(false); }}>
            ✏️ Rename
          </Button>
          {seasons.length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-widest text-ink-400 mb-1 block">🏷 Season</label>
              <select
                value={game.season_id ?? ''}
                onChange={async (e) => {
                  const v = e.target.value || null;
                  patchGame({ season_id: v });
                  await supabase.from('cash_games').update({ season_id: v }).eq('id', game.id);
                }}
                className="input w-full text-sm"
              >
                <option value="">— No season —</option>
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {game.join_code && (
            <Button variant="ghost" full onClick={copySpectatorLink}>
              {t('spectatorLink')}
            </Button>
          )}
          {game.state !== 'finished' && (
            <Button variant="ghost" full onClick={endCashGame}>
              🏁 End cash game now
              <span className="text-xs text-ink-400 ml-2">(moves to History)</span>
            </Button>
          )}
          <Button variant="danger" full onClick={deleteCashGame}>
            🗑 Delete cash game
          </Button>
          <p className="text-xs text-ink-400 text-center pt-2">
            Bank transactions are kept in the ledger for audit.
          </p>
        </div>
      </Sheet>

      <Sheet open={renaming !== null} onClose={() => setRenaming(null)} title="Rename cash game">
        <Input
          value={renaming ?? ''}
          onChange={(e) => setRenaming(e.target.value)}
          placeholder="Cash game name"
          autoFocus
        />
        <Button full className="mt-4" onClick={saveRename} disabled={!renaming?.trim()}>
          Save
        </Button>
      </Sheet>

      <Sheet open={adding} onClose={() => { setAdding(false); setGuestName(''); }} title="Add player">
        {(() => {
          const seatedProfileIds = new Set(players.map((p) => p.profile_id).filter(Boolean) as string[]);
          const seatedGuestNames = new Set(players.map((p) => p.guest_name?.toLowerCase()).filter(Boolean) as string[]);
          const availableProfiles = allProfiles.filter((p) => !seatedProfileIds.has(p.id));
          const availableGuests = recentGuests.filter((n) => !seatedGuestNames.has(n.toLowerCase()));
          if (availableProfiles.length === 0 && availableGuests.length === 0) return null;
          return (
            <div>
              <p className="label">Tap to seat — same person, same stats & bank</p>
              <div className="flex flex-wrap gap-1.5">
                {availableProfiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openSeating(p.id, undefined, p.display_name)}
                    className="pill bg-felt-900/60 border border-felt-700 hover:border-brass-500/40 transition"
                    title="Registered member — links to their account"
                  >
                    {p.avatar_emoji ?? '🃏'} {p.display_name}
                  </button>
                ))}
                {availableGuests.map((name) => (
                  <button
                    key={name}
                    onClick={() => openSeating(undefined, name, name)}
                    className="pill bg-felt-900/60 border border-felt-700 hover:border-brass-500/40 transition"
                    title="Recurring guest — links to their bank balance under this name"
                  >
                    👤 {name}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        <Input label="Or add a new guest" value={guestName} onChange={(e) => setGuestName(e.target.value)}
          placeholder="e.g. Lars" className="mt-3" />
        <Button
          full
          onClick={() => {
            const n = guestName.trim();
            if (!n) return;
            openSeating(undefined, n, n);
          }}
          className="mt-4"
          disabled={!guestName.trim()}
        >
          Continue with {guestName.trim() || '…'}
        </Button>
      </Sheet>

      <Sheet
        open={!!seatingFor}
        onClose={() => { setSeatingFor(null); setSeatFromBank(false); }}
        title={seatingFor ? `Buy-in for ${seatingFor.name}` : ''}
      >
        <NumberInput
          label="Buy-in amount"
          value={seatAmount}
          suffix={currency}
          min={0}
          onValueChange={setSeatAmount}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[200, 500, 1000, 1500, 2000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setSeatAmount(preset)}
              className={`pill border transition ${
                seatAmount === preset
                  ? 'bg-brass-500/20 border-brass-500/40 text-brass-100'
                  : 'bg-felt-900/60 border-felt-700 hover:border-brass-500/40'
              }`}
            >
              {formatMoney(preset, currency)}
            </button>
          ))}
        </div>
        <ChipSuggestion
          amount={seatAmount}
          smallBlind={game.small_blind}
          players={players.length + 1}
          inventory={inventory}
          currency={currency}
        />
        <BankToggle on={seatFromBank} setOn={setSeatFromBank} mode="from" amount={seatAmount} currency={currency} />
        <Button full onClick={confirmSeat} className="mt-4" disabled={seatAmount < 0}>
          Seat {seatingFor?.name ?? ''} for {formatMoney(seatAmount, currency)}{seatFromBank ? ' · from 🏦' : ''}
        </Button>
      </Sheet>

      <Sheet open={!!topUpFor} onClose={() => { setTopUpFor(null); setTopUpFromBank(false); }}
        title={topUpFor ? `Buy-in for ${playerName(topUpFor)}` : ''}>
        <NumberInput label="Amount" value={topUpAmount} suffix={currency} min={0}
          onValueChange={setTopUpAmount} />
        <ChipSuggestion
          amount={topUpAmount}
          smallBlind={game.small_blind}
          players={Math.max(players.length, 1)}
          inventory={inventory}
          currency={currency}
        />
        <BankToggle on={topUpFromBank} setOn={setTopUpFromBank} mode="from" amount={topUpAmount} currency={currency} />
        <Button full onClick={topUp} className="mt-4">Add buy-in{topUpFromBank ? ' · from 🏦' : ''}</Button>
      </Sheet>

      <Sheet open={!!cashOutFor} onClose={() => { setCashOutFor(null); setLeaveInBank(false); }}
        title={cashOutFor ? `Cash out ${playerName(cashOutFor)}` : ''}>
        <NumberInput label="Stack value at cash-out" value={cashOutAmount} suffix={currency} min={0}
          onValueChange={setCashOutAmount} />
        <BankToggle on={leaveInBank} setOn={setLeaveInBank} mode="to" amount={cashOutAmount} currency={currency} />
        <Button full onClick={cashOut} className="mt-4">Cash out{leaveInBank ? ' · leave in 🏦' : ''}</Button>
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

function ChipSuggestion({
  amount, smallBlind, players, inventory, currency,
}: {
  amount: number;
  smallBlind: number | null;
  players: number;
  inventory: ChipInventory;
  currency: string;
}) {
  if (amount <= 0) return null;
  const minChip = (smallBlind && smallBlind > 0 ? smallBlind : 1) as Denomination;
  // Headroom: assume at least 6 seats so the per-player cap leaves chips for
  // late-arrivers. Float up if more are already seated.
  const playerCount = Math.max(players, 6);
  const sug = suggestStartingStack(inventory, playerCount, amount, { smallestChip: minChip });
  const entries = (Object.entries(sug.perPlayer) as [string, number][])
    .map(([d, n]) => ({ d: Number(d) as Denomination, n }))
    .filter((e) => e.n > 0)
    .sort((a, b) => a.d - b.d);
  if (entries.length === 0) return null;
  const off = sug.actualTotal - amount;
  return (
    <div className="mt-3 card-felt p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-ink-400">
          Suggested chips
          {smallBlind ? <span className="ml-1.5 text-ink-500 normal-case tracking-normal">({smallBlind} SB)</span> : null}
        </div>
        <div className={`font-mono text-xs tabular-nums ${off === 0 ? 'text-ink-300' : 'text-brass-200'}`}>
          ={formatMoney(sug.actualTotal, currency)}
          {off !== 0 && <span className="text-ink-400 ml-1">({off > 0 ? '+' : ''}{off})</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {entries.map(({ d, n }) => (
          <div
            key={d}
            className="flex items-center gap-1.5 bg-felt-900/60 border border-felt-700 rounded-lg pl-1.5 pr-2 py-1"
          >
            <Chip denom={d} size="sm" />
            <span className="font-mono text-sm tabular-nums text-ink-100">×{n}</span>
          </div>
        ))}
      </div>
      {sug.warnings.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-400">{sug.warnings[0]}</p>
      )}
    </div>
  );
}

interface BankToggleProps {
  on: boolean;
  setOn: (v: boolean) => void;
  /** "from" = debit bank for buy-in. "to" = credit bank with cash-out. */
  mode: 'from' | 'to';
  amount: number;
  currency: string;
}

function BankToggle({ on, setOn, mode, amount, currency }: BankToggleProps) {
  const label = mode === 'from' ? 'Pay from bank 🏦' : 'Leave in bank 🏦';
  const sub = mode === 'from'
    ? `Debits ${formatMoney(amount, currency)} from their account.`
    : `Credits ${formatMoney(amount, currency)} to their account — no cash changes hands.`;
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className={`mt-3 w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
        on ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-200'
      }`}
    >
      <div>
        <div className="font-semibold text-sm">{label}</div>
        <div className="text-[11px] text-ink-400">{sub}</div>
      </div>
      <div className={`w-12 h-7 rounded-full relative transition ${on ? 'bg-brass-500' : 'bg-felt-700'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition ${on ? 'left-5' : 'left-0.5'}`} />
      </div>
    </button>
  );
}
