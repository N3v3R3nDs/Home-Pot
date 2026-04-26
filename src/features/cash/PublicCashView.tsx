import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { resolveJoinCode } from '@/lib/joinCode';
import { useT } from '@/lib/i18n';
import { MonitorBody } from './CashGameMonitor';

/**
 * No-login public cash-game view. URL: /c/<JOIN_CODE>/view
 *
 * Read-only — same monitor body the host sees, but with the back-link
 * suppressed and a "spectator" pill added. Anonymous sign-in unlocks RLS.
 */
export function PublicCashView() {
  const { code } = useParams<{ code: string }>();
  const [cashGameId, setCashGameId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) await supabase.auth.signInAnonymously();
      if (!code) return;
      const target = await resolveJoinCode(code);
      if (target?.kind === 'cash_game') setCashGameId(target.id);
      else setResolveError(t('codeNotFound', { code: code.toUpperCase() }));
    })();
  }, [code, t]);

  if (resolveError) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <div className="text-5xl mb-3">🃏</div>
          <h1 className="font-display text-2xl text-brass-shine mb-2">{t('notFound')}</h1>
          <p className="text-ink-300">{resolveError}</p>
        </div>
      </div>
    );
  }
  if (!cashGameId) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-300 font-display text-2xl text-brass-shine animate-pulse">
        {t('loading')}
      </div>
    );
  }
  return <MonitorBody cashGameId={cashGameId} spectator />;
}
