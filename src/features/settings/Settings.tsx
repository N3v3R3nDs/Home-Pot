import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/Chip';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { DEFAULT_INVENTORY, DENOMINATIONS, totalChipValue, type Denomination } from '@/lib/chipSet';
import { formatChips } from '@/lib/format';
import { THEMES } from '@/lib/themes';
import { LANGUAGES, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

const EMOJIS = ['🃏', '🎩', '🍀', '🔥', '⚡', '👑', '🦈', '🐉', '🎯', '🚀', '💎', '🧠'];
const CURRENCIES = ['NOK', 'USD', 'EUR', 'SEK', 'DKK', 'GBP'];

export function Settings() {
  const { profile, user, updateProfile, signOut } = useAuth();
  const { currency, setCurrency, inventory, setInventory, soundEnabled, toggleSound, theme, setTheme, language, setLanguage } = useSettings();
  const t = useT();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [emoji, setEmoji] = useState(profile?.avatar_emoji ?? '🃏');
  const [invDraft, setInvDraft] = useState(inventory);

  // Members directory + PIN reset
  interface Member { id: string; display_name: string; avatar_emoji: string | null; account_type: 'pin' | 'email' | 'anonymous' | 'unknown'; is_anonymous: boolean; }
  const [members, setMembers] = useState<Member[]>([]);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [newPin, setNewPin] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('members').select('*').order('display_name');
      setMembers((data ?? []) as Member[]);
    };
    load();
    // Refresh whenever a new profile is created or one is deleted/updated.
    const ch = supabase.channel('members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

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
        <div className="flex items-center justify-between mb-2">
          <p className="label !mb-0">Chip inventory</p>
          <button className="text-xs text-ink-400 underline" onClick={() => setInvDraft(DEFAULT_INVENTORY)}>reset</button>
        </div>
        <p className="text-xs text-ink-400 mb-3">Used for starting-stack suggestions, color-up alerts, and distribution math.</p>
        <div className="grid grid-cols-3 gap-2">
          {DENOMINATIONS.map((d) => (
            <div key={d} className="bg-felt-950/60 rounded-xl p-3 flex flex-col items-center gap-2">
              <Chip denom={d} size="md" />
              <input
                type="number"
                className="input !px-2 !py-1 text-center font-mono w-full"
                value={invDraft[d]}
                onChange={(e) => setInvDraft({ ...invDraft, [d]: Math.max(0, Number(e.target.value)) })}
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
            return (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-3">
                  <span className="text-xl">{m.avatar_emoji ?? '🃏'}</span>
                  <span>
                    <div className="font-semibold">{m.display_name} {isMe && <span className="text-xs text-brass-300">(you)</span>}</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-500">
                      {m.account_type === 'pin' ? 'quick-join · PIN' : m.account_type === 'email' ? 'email · password' : m.account_type}
                    </div>
                  </span>
                </span>
                {m.account_type === 'pin' && !isMe && (
                  <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { setResetting(m); setNewPin(''); setResetMsg(null); }}>
                    🔑 Reset PIN
                  </Button>
                )}
              </li>
            );
          })}
          {members.filter((m) => !m.is_anonymous).length === 0 && (
            <li className="py-2 text-ink-400 text-sm">No members yet.</li>
          )}
        </ul>
      </Card>

      <Card>
        <Button variant="danger" full onClick={signOut}>Sign out</Button>
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
    </div>
  );
}
