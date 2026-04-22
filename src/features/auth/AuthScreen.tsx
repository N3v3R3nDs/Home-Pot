import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resolveJoinCode } from '@/lib/joinCode';

type Mode = 'quick' | 'sign-in' | 'sign-up';

export function AuthScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('quick');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'quick') {
        const cleaned = code.trim().toUpperCase();
        if (cleaned.length < 3) throw new Error('Enter a join code');
        // Sign in anonymously first so we have a session to read with
        const sess = await supabase.auth.getSession();
        if (!sess.data.session) {
          const { error: aErr } = await supabase.auth.signInAnonymously();
          if (aErr) throw aErr;
        }
        const target = await resolveJoinCode(cleaned);
        if (!target) throw new Error(`No game with code "${cleaned}"`);
        if (target.kind === 'tournament') navigate(`/tournament/${target.id}`);
        else navigate(`/cash/${target.id}`);
        return;
      }
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: displayName || email.split('@')[0] } },
        });
        if (error) throw error;
        setInfo('Account created! Signing you in…');
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
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {(['quick', 'sign-in', 'sign-up'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition ${
                  mode === m ? 'bg-brass-500/20 text-brass-200 border border-brass-500/40' : 'text-ink-400 border border-transparent'
                }`}
              >
                {m === 'quick' ? '⚡ Quick join' : m === 'sign-in' ? 'Sign in' : 'Create'}
              </button>
            ))}
          </div>

          {mode === 'quick' && (
            <>
              <p className="text-center text-ink-300 text-sm">Got a code from the host?</p>
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
              <p className="text-center text-[11px] text-ink-500">Joins as a guest — no email needed. You'll pick your seat next.</p>
            </>
          )}

          {mode === 'sign-up' && (
            <Input
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Henning"
              required
            />
          )}
          {(mode === 'sign-in' || mode === 'sign-up') && (
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
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {info && <p className="text-brass-300 text-sm">{info}</p>}

          <Button type="submit" full disabled={busy}>
            {busy ? 'Working…' :
              mode === 'quick' ? `Join ${code || 'game'}` :
              mode === 'sign-in' ? 'Deal me in' : 'Create account'}
          </Button>
        </form>

        <p className="text-center text-xs text-ink-500 mt-6">
          Self-hosted • Your data stays on your network
        </p>
      </motion.div>
    </div>
  );
}
