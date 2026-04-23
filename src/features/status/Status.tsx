import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

interface Check {
  name: string;
  ok: boolean | null;
  detail?: string;
  ms?: number;
}

/** Quick health page — tap from Settings to verify the stack works end-to-end.
 *  Useful for debugging on a phone without opening the browser console. */
export function Status() {
  const [checks, setChecks] = useState<Check[]>([
    { name: 'PWA online', ok: navigator.onLine },
    { name: 'Auth session', ok: null },
    { name: 'REST query', ok: null },
    { name: 'Realtime subscription', ok: null },
    { name: 'Service worker', ok: null },
  ]);

  useEffect(() => {
    const run = async () => {
      const updates: Check[] = [];

      // 1. PWA online
      updates.push({ name: 'PWA online', ok: navigator.onLine });

      // 2. Auth session
      const t0 = performance.now();
      const { data: { session } } = await supabase.auth.getSession();
      updates.push({
        name: 'Auth session',
        ok: !!session,
        detail: session ? `as ${session.user.email ?? 'anonymous'}` : 'no session',
        ms: Math.round(performance.now() - t0),
      });

      // 3. REST query
      const t1 = performance.now();
      const { error: restErr } = await supabase.from('profiles').select('id').limit(1);
      updates.push({
        name: 'REST query',
        ok: !restErr,
        detail: restErr ? restErr.message : 'reached profiles',
        ms: Math.round(performance.now() - t1),
      });

      // 4. Realtime subscription (with timeout)
      const t2 = performance.now();
      const realtimeOk = await new Promise<boolean>((resolve) => {
        const ch = supabase.channel('status-probe')
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') { supabase.removeChannel(ch); resolve(true); }
            else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
              supabase.removeChannel(ch); resolve(false);
            }
          });
        setTimeout(() => { supabase.removeChannel(ch); resolve(false); }, 4000);
      });
      updates.push({
        name: 'Realtime subscription',
        ok: realtimeOk,
        detail: realtimeOk ? 'connected' : 'no echo',
        ms: Math.round(performance.now() - t2),
      });

      // 5. Service worker
      const swOk = 'serviceWorker' in navigator
        ? !!(await navigator.serviceWorker.getRegistration())
        : false;
      updates.push({
        name: 'Service worker',
        ok: swOk,
        detail: swOk ? 'registered' : 'not registered',
      });

      setChecks(updates);
    };
    run();
  }, []);

  const allOk = checks.every((c) => c.ok === true);
  const anyFailed = checks.some((c) => c.ok === false);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl text-brass-shine">System status</h1>
        <p className="text-sm mt-1">
          {allOk ? <span className="text-emerald-400">All systems go ✅</span>
            : anyFailed ? <span className="text-red-400">Something's down — check below.</span>
            : <span className="text-ink-300">Running checks…</span>}
        </p>
      </header>
      <Card>
        <ul className="divide-y divide-felt-800">
          {checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between py-3">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-ink-400">{c.detail ?? '…'}</div>
              </div>
              <div className="text-right">
                <div className={`text-xl ${c.ok === true ? 'text-emerald-400' : c.ok === false ? 'text-red-400' : 'text-ink-400'}`}>
                  {c.ok === true ? '✓' : c.ok === false ? '✗' : '…'}
                </div>
                {c.ms !== undefined && <div className="text-[10px] text-ink-500">{c.ms} ms</div>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <div className="text-xs text-ink-400 grid grid-cols-2 gap-x-3 gap-y-1">
          <span>Build mode</span><span className="text-ink-200 font-mono">{import.meta.env.MODE}</span>
          <span>User agent</span><span className="text-ink-200 font-mono truncate">{navigator.userAgent.slice(0, 24)}…</span>
          <span>Viewport</span><span className="text-ink-200 font-mono">{window.innerWidth}×{window.innerHeight}</span>
          <span>Online</span><span className="text-ink-200 font-mono">{String(navigator.onLine)}</span>
        </div>
      </Card>
    </div>
  );
}
