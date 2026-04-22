import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/Chip';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { DEFAULT_INVENTORY, DENOMINATIONS, totalChipValue, type Denomination } from '@/lib/chipSet';
import { formatChips } from '@/lib/format';
import { THEMES } from '@/lib/themes';

const EMOJIS = ['🃏', '🎩', '🍀', '🔥', '⚡', '👑', '🦈', '🐉', '🎯', '🚀', '💎', '🧠'];
const CURRENCIES = ['NOK', 'USD', 'EUR', 'SEK', 'DKK', 'GBP'];

export function Settings() {
  const { profile, updateProfile, signOut } = useAuth();
  const { currency, setCurrency, inventory, setInventory, soundEnabled, toggleSound, theme, setTheme } = useSettings();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [emoji, setEmoji] = useState(profile?.avatar_emoji ?? '🃏');
  const [invDraft, setInvDraft] = useState(inventory);

  const saveProfile = async () => {
    await updateProfile({ display_name: name, avatar_emoji: emoji });
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-brass-shine">Settings</h1>

      <Card>
        <p className="label">Profile</p>
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
        <Button variant="danger" full onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  );
}
