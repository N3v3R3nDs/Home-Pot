import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useConfirm } from '@/components/ui/Confirm';
import { useToast } from '@/components/ui/Toast';
import { Chip } from '@/components/Chip';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { DEFAULT_INVENTORY, DENOMINATIONS, totalChipValue, type Denomination } from '@/lib/chipSet';
import { formatChips } from '@/lib/format';
import { THEMES } from '@/lib/themes';
import { LANGUAGES, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { ensureNotificationPermission, notificationPermission } from '@/lib/notify';
import { ActivityFeed } from '@/features/dashboard/ActivityFeed';
import { SeasonAdmin } from '@/features/seasons/SeasonAdmin';
import { Link } from 'react-router-dom';

const EMOJIS = ['🃏', '🎩', '🍀', '🔥', '⚡', '👑', '🦈', '🐉', '🎯', '🚀', '💎', '🧠'];
const CURRENCIES = ['NOK', 'USD', 'EUR', 'SEK', 'DKK', 'GBP'];

export function Settings() {
  const { profile, user, updateProfile, signOut } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const confirmSignOut = async () => {
    if (!await confirm({
      title: 'Sign out?',
      message: 'You can sign back in anytime with your name + PIN (or email).',
      confirmLabel: 'Sign out',
      destructive: true,
    })) return;
    await signOut();
  };
  const { currency, setCurrency, inventory, setInventory, soundEnabled, toggleSound, theme, setTheme, language, setLanguage, largeText, toggleLargeText, tournamentDefaults, setTournamentDefaults } = useSettings();
  const [defDraft, setDefDraft] = useState(tournamentDefaults);
  const [defSavedAt, setDefSavedAt] = useState<number | null>(null);
  const saveDefaults = () => {
    setTournamentDefaults(defDraft);
    setDefSavedAt(Date.now());
    setTimeout(() => setDefSavedAt(null), 2200);
  };
  const t = useT();
  const [notifPerm, setNotifPerm] = useState(notificationPermission());
  const [name, setName] = useState(profile?.display_name ?? '');
  const [emoji, setEmoji] = useState(profile?.avatar_emoji ?? '🃏');
  const [invDraft, setInvDraft] = useState(inventory);

  // Members directory + PIN reset
  interface Member { id: string; display_name: string; avatar_emoji: string | null; account_type: 'pin' | 'email' | 'anonymous' | 'unknown'; is_anonymous: boolean; is_admin: boolean; }
  const [members, setMembers] = useState<Member[]>([]);
  const [resetting, setResetting] = useState<Member | null>(null);

  const deleteMember = async (m: Member) => {
    // Count what this profile is attached to so we can warn honestly.
    // host_id has ON DELETE CASCADE → those games go away with all their
    // players + buy-ins + bank txs. profile_id on tournament_players /
    // cash_game_players uses ON DELETE SET NULL → those rows survive
    // anonymously, preserving stats integrity.
    const [tHosted, cHosted, tPlayed, cPlayed] = await Promise.all([
      supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('host_id', m.id),
      supabase.from('cash_games').select('id', { count: 'exact', head: true }).eq('host_id', m.id),
      supabase.from('tournament_players').select('id', { count: 'exact', head: true }).eq('profile_id', m.id),
      supabase.from('cash_game_players').select('id', { count: 'exact', head: true }).eq('profile_id', m.id),
    ]);
    const hostedT = tHosted.count ?? 0;
    const hostedC = cHosted.count ?? 0;
    const playedT = tPlayed.count ?? 0;
    const playedC = cPlayed.count ?? 0;
    const lines: string[] = [];
    if (hostedT + hostedC > 0) {
      lines.push(`⚠ ${hostedT + hostedC} hosted game${hostedT + hostedC === 1 ? '' : 's'} will be DELETED with all players, buy-ins and bank entries.`);
    }
    if (playedT + playedC > 0) {
      lines.push(`${playedT + playedC} player record${playedT + playedC === 1 ? '' : 's'} will be anonymized (kept so stats stay correct).`);
    }
    if (lines.length === 0) {
      lines.push('Clean delete — no games attached to this member.');
    }
    const ok = await confirm({
      title: `Delete "${m.display_name}"?`,
      message: lines.join('\n\n') + '\n\nThis cannot be undone.',
      confirmLabel: '🗑 Delete forever',
      destructive: true,
    });
    if (!ok) return;
    // Calls the security-definer RPC defined in migration 11. Cascades the
    // profile + auth.users in one atomic op; refuses if caller isn't admin.
    const { error } = await supabase.rpc('delete_member', { p_user_id: m.id });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[Settings] deleteMember failed:', error);
      toast(`Couldn't delete: ${error.message}`, 'error');
      return;
    }
    toast(`${m.display_name} deleted.`, 'success');
  };
  const [newPin, setNewPin] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Past-game guests: people who showed up via guest_name on tournament_players
  // / cash_game_players but never signed up. Surfaced here so the host can
  // promote them into real PIN-based members and roll their history forward.
  interface Guest { name: string; appearances: number }
  const [guests, setGuests] = useState<Guest[]>([]);
  const [promoting, setPromoting] = useState<Guest | null>(null);
  const [promoteName, setPromoteName] = useState('');
  const [promotePin, setPromotePin] = useState('');
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('members').select('*').order('display_name');
      setMembers((data ?? []) as Member[]);
    };
    const loadGuests = async () => {
      // Pull every guest_name across both tables, then dedupe + count.
      const [{ data: tps }, { data: cps }] = await Promise.all([
        supabase.from('tournament_players').select('guest_name').not('guest_name', 'is', null),
        supabase.from('cash_game_players').select('guest_name').not('guest_name', 'is', null),
      ]);
      const counts = new Map<string, number>();
      for (const r of [...(tps ?? []), ...(cps ?? [])]) {
        const raw = ((r as { guest_name: string }).guest_name ?? '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      // Preserve original casing of the first occurrence.
      const original = new Map<string, string>();
      for (const r of [...(tps ?? []), ...(cps ?? [])]) {
        const raw = ((r as { guest_name: string }).guest_name ?? '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!original.has(key)) original.set(key, raw);
      }
      const list: Guest[] = Array.from(counts.entries())
        .map(([key, n]) => ({ name: original.get(key)!, appearances: n }))
        .sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));
      setGuests(list);
    };
    void load();
    void loadGuests();
    // Refresh members + guest list whenever profiles or player rows change.
    const ch = supabase.channel('members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load(); void loadGuests(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players' }, () => { void loadGuests(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_game_players' }, () => { void loadGuests(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const submitPromote = async () => {
    if (!promoting) return;
    const display = promoteName.trim();
    if (!display) { setPromoteMsg('Enter a display name'); return; }
    if (!/^\d{4}$/.test(promotePin)) { setPromoteMsg('PIN must be 4 digits'); return; }
    setPromoteBusy(true);
    const { error } = await supabase.rpc('promote_guest_to_member', {
      p_guest_name: promoting.name,
      p_display_name: display,
      p_pin: promotePin,
    });
    setPromoteBusy(false);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[Settings] promote_guest_to_member failed:', error);
      setPromoteMsg(error.message ?? 'Promotion failed');
      return;
    }
    setPromoteMsg(`✓ ${display} is now a member. They sign in with name "${display}" + PIN ${promotePin}.`);
    setPromoting(null);
    toast(`${display} promoted to member ✨`, 'success');
  };

  const submitReset = async () => {
    if (!resetting || !/^\d{4}$/.test(newPin)) {
      setResetMsg('PIN must be 4 digits');
      return;
    }
    const { error } = await supabase.rpc('reset_member_pin', {
      p_user_id: resetting.id, p_new_pin: newPin,
    });
    if (error) { setResetMsg(error.message); return; }
    setResetMsg(`✓ ${resetting.display_name}'s PIN is now ${newPin}. Tell them to sign in with that.`);
    setNewPin('');
    setTimeout(() => { setResetting(null); setResetMsg(null); }, 4000);
  };

  const saveProfile = async () => {
    await updateProfile({ display_name: name, avatar_emoji: emoji });
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-brass-shine">{t('settings')}</h1>

      <Card>
        <p className="label">{t('language')}</p>
        <div className="grid grid-cols-2 gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setLanguage(l.id)}
              className={`py-3 rounded-xl text-sm font-semibold border ${
                language === l.id ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-200'
              }`}
            >{l.native}</button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="label">{t('profile')}</p>
        <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mt-3">
          <p className="label">Avatar</p>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-11 h-11 rounded-xl text-2xl grid place-items-center border ${emoji === e ? 'bg-brass-500/15 border-brass-500/50' : 'bg-felt-900/60 border-felt-700'}`}
              >{e}</button>
            ))}
          </div>
        </div>
        <Button full className="mt-4" onClick={saveProfile}>Save profile</Button>
      </Card>

      <Card>
        <p className="label">Theme</p>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`text-left rounded-xl p-3 border transition ${
                  active ? 'border-brass-500/60 ring-2 ring-brass-500/40' : 'border-felt-700 hover:border-felt-600'
                }`}
                style={{
                  background: `linear-gradient(135deg, ${t.swatch[0]} 0%, ${t.swatch[1]} 100%)`,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-4 h-4 rounded-full border border-white/20" style={{ background: t.swatch[2] }} />
                  <span className="font-display text-base" style={{ color: t.swatch[2] }}>{t.label}</span>
                </div>
                <div className="text-[11px] text-white/70">{t.blurb}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="label !mb-0">Larger text</p>
            <p className="text-xs text-ink-400">Bumps app text size 18%. Helpful for older eyes / small phones.</p>
          </div>
          <button
            onClick={toggleLargeText}
            className={`w-14 h-8 rounded-full relative transition ${largeText ? 'bg-brass-500' : 'bg-felt-700'}`}
            aria-pressed={largeText}
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition ${largeText ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </Card>

      <Card>
        <p className="label">Tournament defaults</p>
        <p className="text-xs text-ink-400 mb-3">
          New tournaments start with these values pre-filled. You can still tweak per-tournament in the wizard.
        </p>
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {([
            ['rebuy', 'Re-buy', '🔁'],
            ['freezeout', 'Freezeout', '🧊'],
            ['reentry', 'Re-entry', '↻'],
            ['bounty', 'Bounty', '💀'],
          ] as const).map(([id, label, ico]) => (
            <button
              key={id}
              onClick={() => setDefDraft({ ...defDraft, tournamentType: id })}
              className={`p-2 rounded-xl border text-center text-xs ${
                defDraft.tournamentType === id ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-300'
              }`}
            >
              <div className="text-base">{ico}</div>
              <div className="font-semibold mt-0.5">{label}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Buy-in" value={defDraft.buyIn} suffix={currency} min={0} required
            onValueChange={(n) => setDefDraft({ ...defDraft, buyIn: n })} />
          <NumberInput label="Bounty" value={defDraft.bountyAmount} suffix={currency} min={0}
            onValueChange={(n) => setDefDraft({ ...defDraft, bountyAmount: n })} />
          <NumberInput label="Re-buy" value={defDraft.rebuyAmount} suffix={currency} min={0}
            onValueChange={(n) => setDefDraft({ ...defDraft, rebuyAmount: n })} />
          <NumberInput label="Add-on" value={defDraft.addonAmount} suffix={currency} min={0}
            onValueChange={(n) => setDefDraft({ ...defDraft, addonAmount: n })} />
          <NumberInput label="Re-buys until level" value={defDraft.rebuysUntilLevel} min={0}
            onValueChange={(n) => setDefDraft({ ...defDraft, rebuysUntilLevel: n })} />
          <div /> {/* spacer to keep next row aligned */}
          <NumberInput label="Rake %" value={defDraft.rakePercent} suffix="%" min={0} max={100} decimals
            onValueChange={(n) => setDefDraft({ ...defDraft, rakePercent: n })} />
          <NumberInput label="Dealer tip %" value={defDraft.dealerTipPercent} suffix="%" min={0} max={100} decimals
            onValueChange={(n) => setDefDraft({ ...defDraft, dealerTipPercent: n })} />
        </div>
        <Button full className="mt-3" onClick={saveDefaults}>
          {defSavedAt ? '✓ Saved' : 'Save defaults'}
        </Button>
      </Card>

      <Card>
        <p className="label">Currency</p>
        <div className="grid grid-cols-3 gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`py-2 rounded-xl font-mono text-sm border ${currency === c ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-200'}`}
            >{c}</button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="label !mb-0">Sound effects</p>
            <p className="text-xs text-ink-400">Blind-up chime, final-table fanfare, countdown tick.</p>
          </div>
          <button
            onClick={toggleSound}
            className={`w-14 h-8 rounded-full relative transition ${soundEnabled ? 'bg-brass-500' : 'bg-felt-700'}`}
            aria-pressed={soundEnabled}
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition ${soundEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="label !mb-0">Background alerts</p>
            <p className="text-xs text-ink-400">
              {notifPerm === 'granted'
                ? "On. We'll buzz when blinds go up while the app is in the background."
                : notifPerm === 'denied'
                ? 'Blocked by your browser. Re-enable in browser site settings.'
                : notifPerm === 'unsupported'
                ? "Your browser doesn't support notifications."
                : 'Tap to enable notifications.'}
            </p>
          </div>
          {notifPerm === 'default' && (
            <Button variant="ghost" className="!px-3 !py-2 text-xs"
                    onClick={async () => setNotifPerm(await ensureNotificationPermission())}>
              Enable
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <p className="label !mb-0">Chip inventory</p>
          <button className="text-xs text-ink-400 underline" onClick={() => setInvDraft(DEFAULT_INVENTORY)}>reset</button>
        </div>
        <p className="text-xs text-ink-400 mb-3">Used for starting-stack suggestions, color-up alerts, and distribution math.</p>
        <div className="grid grid-cols-3 gap-2">
          {DENOMINATIONS.map((d) => (
            <div key={d} className="bg-felt-950/60 rounded-xl p-3 flex flex-col items-center gap-2">
              <Chip denom={d} size="md" />
              <NumberInput
                className="!px-2 !py-1 text-center font-mono"
                value={invDraft[d]}
                min={0}
                onValueChange={(n) => setInvDraft({ ...invDraft, [d]: n })}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-ink-300">
          <span>Total value</span>
          <span className="font-mono text-brass-200">{formatChips(totalChipValue(invDraft as Record<Denomination, number>))}</span>
        </div>
        <Button full className="mt-3" onClick={() => setInventory(invDraft as Record<Denomination, number>)}>Save inventory</Button>
      </Card>

      <Card>
        <p className="label">Members</p>
        <p className="text-xs text-ink-400 mb-3">
          Tap a quick-join member to reset their PIN. Their account, stats and bank balance are preserved — only the PIN changes.
        </p>
        <ul className="divide-y divide-felt-800">
          {members.filter((m) => !m.is_anonymous).map((m) => {
            const isMe = m.id === user?.id;
            const meIsAdmin = members.find((x) => x.id === user?.id)?.is_admin ?? false;
            return (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-3">
                  <span className="text-xl">{m.avatar_emoji ?? '🃏'}</span>
                  <span>
                    <div className="font-semibold flex items-center gap-2">
                      {m.display_name}
                      {isMe && <span className="text-xs text-brass-300">(you)</span>}
                      {m.is_admin && <span className="pill bg-brass-500/20 text-brass-200 text-[9px]">ADMIN</span>}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-500">
                      {m.account_type === 'pin' ? 'quick-join · PIN' : m.account_type === 'email' ? 'email · password' : m.account_type}
                    </div>
                  </span>
                </span>
                <div className="flex gap-1">
                  {meIsAdmin && !isMe && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1.5 text-xs"
                      onClick={async () => {
                        await supabase.from('profiles').update({ is_admin: !m.is_admin }).eq('id', m.id);
                      }}
                    >{m.is_admin ? '↓' : '↑'} admin</Button>
                  )}
                  {m.account_type === 'pin' && !isMe && (
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { setResetting(m); setNewPin(''); setResetMsg(null); }}>
                      🔑 Reset PIN
                    </Button>
                  )}
                  {meIsAdmin && !isMe && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1.5 text-xs text-red-400/80 hover:text-red-400"
                      onClick={() => deleteMember(m)}
                      title={`Delete ${m.display_name}`}
                    >🗑</Button>
                  )}
                </div>
              </li>
            );
          })}
          {members.filter((m) => !m.is_anonymous).length === 0 && (
            <li className="py-2 text-ink-400 text-sm">No members yet.</li>
          )}
        </ul>

        {/* Past-game guests — surface them so the host can convert them into
            real PIN members. After promotion their existing tournament/cash
            history is re-pointed to the new profile so stats roll forward. */}
        {guests.length > 0 && (() => {
          const meIsAdmin = members.find((x) => x.id === user?.id)?.is_admin ?? false;
          // Hide guests whose name already matches a registered member.
          const memberNames = new Set(members.map((m) => m.display_name.toLowerCase()));
          const orphans = guests.filter((g) => !memberNames.has(g.name.toLowerCase()));
          if (orphans.length === 0) return null;
          return (
            <div className="mt-5 pt-4 border-t border-felt-800">
              <p className="label !mb-1">Guests from past games</p>
              <p className="text-xs text-ink-400 mb-3">
                People who played as guests but never signed up. Promote them to a real member and their existing buy-ins, knockouts and prizes carry over.
              </p>
              <ul className="divide-y divide-felt-800">
                {orphans.map((g) => (
                  <li key={g.name} className="flex items-center justify-between py-2.5">
                    <span className="flex items-center gap-3">
                      <span className="text-xl">👤</span>
                      <span>
                        <div className="font-semibold">{g.name}</div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-500">
                          {g.appearances} appearance{g.appearances === 1 ? '' : 's'} · guest only
                        </div>
                      </span>
                    </span>
                    {meIsAdmin && (
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1.5 text-xs"
                        onClick={() => {
                          setPromoting(g);
                          setPromoteName(g.name);
                          setPromotePin('');
                          setPromoteMsg(null);
                        }}
                      >🎟 Promote</Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </Card>

      <SeasonAdmin />

      <ActivityFeed />

      <Card>
        <Link to="/status" className="block text-center text-sm text-ink-300 hover:text-brass-200">
          🩺 System status
        </Link>
      </Card>

      <Card>
        <Button variant="danger" full onClick={confirmSignOut}>Sign out</Button>
      </Card>

      <Sheet open={!!resetting} onClose={() => { setResetting(null); setNewPin(''); setResetMsg(null); }}
             title={resetting ? `Reset PIN for ${resetting.display_name}` : ''}>
        <p className="text-ink-300 text-sm mb-4">
          Pick a new 4-digit PIN. Their stats, bank balance and tournament history are <b>not</b> affected — they just sign in with this PIN from now on.
        </p>
        <input
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          inputMode="numeric"
          autoComplete="off"
          className="w-full text-center font-mono text-3xl tracking-[0.5em] bg-felt-900/80 border-2 border-felt-700/60 rounded-xl py-3 text-ink-50 focus:outline-none focus:border-brass-400/60"
          maxLength={4}
        />
        {resetMsg && (
          <p className={`mt-3 text-sm text-center ${resetMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
            {resetMsg}
          </p>
        )}
        <Button full className="mt-4" onClick={submitReset} disabled={!/^\d{4}$/.test(newPin)}>
          Set new PIN
        </Button>
      </Sheet>

      <Sheet
        open={!!promoting}
        onClose={() => { if (!promoteBusy) { setPromoting(null); setPromoteMsg(null); } }}
        title={promoting ? `Promote ${promoting.name}` : ''}
      >
        <p className="text-ink-300 text-sm mb-4">
          Creates a real PIN-based member account for <b>{promoting?.name}</b>. Their {promoting?.appearances} previous appearance{promoting?.appearances === 1 ? '' : 's'} as a guest will be re-pointed to the new account, so stats and history carry over.
        </p>
        <Input
          label="Display name"
          value={promoteName}
          onChange={(e) => setPromoteName(e.target.value)}
          placeholder="Their name"
        />
        <label className="label mt-4 block">PIN (they sign in with this)</label>
        <input
          value={promotePin}
          onChange={(e) => setPromotePin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          inputMode="numeric"
          autoComplete="off"
          className="w-full text-center font-mono text-3xl tracking-[0.5em] bg-felt-900/80 border-2 border-felt-700/60 rounded-xl py-3 text-ink-50 focus:outline-none focus:border-brass-400/60"
          maxLength={4}
        />
        {promoteMsg && (
          <p className={`mt-3 text-sm text-center ${promoteMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
            {promoteMsg}
          </p>
        )}
        <Button
          full
          className="mt-4"
          onClick={submitPromote}
          disabled={promoteBusy || !promoteName.trim() || !/^\d{4}$/.test(promotePin)}
        >
          {promoteBusy ? 'Promoting…' : '🎟 Promote to member'}
        </Button>
      </Sheet>
    </div>
  );
}
