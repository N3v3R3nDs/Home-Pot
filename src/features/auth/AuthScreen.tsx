import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resolveJoinCode } from '@/lib/joinCode';

type Mode = 'quick' | 'sign-in';

/** Convert a display name to a deterministic email for Supabase auth.
 *  "Lars Hansen" → "lars-hansen@home-pot.local". Same name → same account. */
function nameToEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'guest'}@home-pot.local`;
}

/** Pad the user's 4-digit PIN to a Supabase-accepted password. The 'pin-' prefix
 *  is invisible to the user — they just remember 4 digits. */
function pinToPassword(pin: string): string {
  return `pin-${pin}`;
}

export function AuthScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('quick');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [returning, setReturning] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Pre-fill the name from localStorage / current session so returning friends
  // don't have to type it.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('home-pot-name');
      if (stored) { setName(stored); setReturning(stored); }
    } catch { /* noop */ }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'quick') {
        const cleanedCode = code.trim().toUpperCase();
        const cleanedName = name.trim();
        const cleanedPin = pin.trim();
        if (cleanedCode.length < 3) throw new Error('Enter a join code');
        if (!cleanedName) throw new Error('What should we call you?');
        if (!/^\d{4}$/.test(cleanedPin)) throw new Error('PIN must be 4 digits');

        const userEmail = nameToEmail(cleanedName);
        const userPwd = pinToPassword(cleanedPin);

        // If currently signed in as a different identity (e.g. an old anon
        // session or a different account), sign out first so we don't conflict.
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          await supabase.auth.signOut();
        }

        // 1) Try to sign in (returning user, any device)
        const si = await supabase.auth.signInWithPassword({ email: userEmail, password: userPwd });

        if (si.error) {
          // Could be "wrong PIN for existing user" OR "user doesn't exist yet".
          // Try to sign up — if the email already exists, we know it's a wrong-PIN.
          const su = await supabase.auth.signUp({
            email: userEmail,
            password: userPwd,
            options: { data: { display_name: cleanedName } },
          });
          if (su.error) {
            const msg = su.error.message.toLowerCase();
            if (msg.includes('already') || msg.includes('registered') || msg.includes('exist')) {
              throw new Error(`Wrong PIN for "${cleanedName}". Try again, or pick a slightly different name.`);
            }
            throw su.error;
          }
        }

        // Make sure profile.display_name matches the typed name (might differ
        // in casing for a returning user whose original name was "Lars Hansen"
        // but who typed "lars hansen"). Friendly canonicalization.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await supabase.from('profiles')
            .update({ display_name: cleanedName })
            .eq('id', session.user.id);
        }

        try { localStorage.setItem('home-pot-name', cleanedName); } catch { /* noop */ }

        const target = await resolveJoinCode(cleanedCode);
        if (!target) throw new Error(`No game with code "${cleanedCode}"`);
        if (target.kind === 'tournament') navigate(`/tournament/${target.id}`);
        else navigate(`/cash/${target.id}`);
        return;
      }
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-5 pt-safe pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <motion.div
            className="mx-auto w-20 h-20 rounded-2xl bg-felt-radial border border-brass-500/30 grid place-items-center font-display text-brass-300 text-4xl shadow-glow mb-4"
            animate={{ rotate: [0, -3, 3, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            HP
          </motion.div>
          <h1 className="font-display text-5xl text-brass-shine tracking-wider">HOME POT</h1>
          <p className="text-ink-300 mt-2 text-sm">Pro poker night, in your pocket.</p>
        </div>

        <form onSubmit={submit} className="card-felt p-6 space-y-4">
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            {(['quick', 'sign-in'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition ${
                  mode === m ? 'bg-brass-500/20 text-brass-200 border border-brass-500/40' : 'text-ink-400 border border-transparent'
                }`}
              >
                {m === 'quick' ? '⚡ Quick join' : 'Host sign in'}
              </button>
            ))}
          </div>

          {mode === 'quick' && (
            <>
              {returning && (
                <div className="bg-brass-500/10 border border-brass-500/30 rounded-xl px-3 py-2 text-center text-sm text-brass-200">
                  Welcome back, <b>{returning}</b> 👋
                </div>
              )}

              <div>
                <label className="label">Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lars"
                  autoComplete="given-name"
                  className="input text-center text-lg"
                  required
                />
              </div>

              <div>
                <label className="label">PIN <span className="text-ink-500 normal-case font-normal">(4 digits, remember it)</span></label>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  inputMode="numeric"
                  pattern="\d{4}"
                  autoComplete="off"
                  className="w-full text-center font-mono text-3xl tracking-[0.5em] bg-felt-900/80 border-2 border-felt-700/60 rounded-xl py-3 text-ink-50 focus:outline-none focus:border-brass-400/60"
                  maxLength={4}
                  required
                />
              </div>

              <div>
                <label className="label">Join code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                  placeholder="CARD"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={4}
                  className="w-full text-center font-display text-5xl tracking-[0.5em] uppercase bg-felt-900/80 border-2 border-felt-700/60 rounded-2xl py-4 text-brass-shine focus:outline-none focus:border-brass-400/60"
                  required
                />
              </div>

              <p className="text-center text-[11px] text-ink-500">
                Same <b>name</b> + <b>PIN</b> = same identity, on any device, forever.
                {!returning && ' First time? Pick anything memorable.'}
              </p>
            </>
          )}

          {mode === 'sign-in' && (
            <>
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <p className="text-center text-[11px] text-ink-500">
                For hosts/admins only. Friends should use ⚡ Quick join.
              </p>
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {info && <p className="text-brass-300 text-sm">{info}</p>}

          <Button type="submit" full disabled={busy}>
            {busy ? 'Working…' :
              mode === 'quick' ? `Join ${code || 'game'}` : 'Deal me in'}
          </Button>
        </form>

        <p className="text-center text-xs text-ink-500 mt-6">
          Self-hosted • Your data stays on your network
        </p>
      </motion.div>
    </div>
  );
}
