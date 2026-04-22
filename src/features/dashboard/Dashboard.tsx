import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useAuth } from '@/store/auth';
import { formatMoney } from '@/lib/format';
import type { CashGame, Tournament } from '@/types/db';

type Action = { kind: 'tournament' | 'cash_game'; id: string; name: string };

export function Dashboard() {
  const { profile } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [cashGames, setCashGames] = useState<CashGame[]>([]);
  const [acting, setActing] = useState<Action | null>(null);

  const endIt = async () => {
    if (!acting) return;
    const table = acting.kind === 'tournament' ? 'tournaments' : 'cash_games';
    const updates = acting.kind === 'tournament'
      ? { state: 'finished' }
      : { state: 'finished', ended_at: new Date().toISOString() };
    await supabase.from(table).update(updates).eq('id', acting.id);
    setActing(null);
  };
  const deleteIt = async () => {
    if (!acting) return;
    if (!confirm(`Delete "${acting.name}"? This cannot be undone.`)) return;
    const table = acting.kind === 'tournament' ? 'tournaments' : 'cash_games';
    await supabase.from(table).delete().eq('id', acting.id);
    setActing(null);
  };

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('cash_games').select('*').order('created_at', { ascending: false }).limit(20),
      ]);
      setTournaments((t ?? []) as Tournament[]);
      setCashGames((c ?? []) as CashGame[]);
    };
    load();

    const ch = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_games' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const live = tournaments.filter((t) => t.state === 'running' || t.state === 'paused');
  const liveCash = cashGames.filter((c) => c.state === 'running');

  return (
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className="text-ink-300">Welcome back, <span className="text-brass-300 font-semibold">{profile?.display_name ?? 'player'}</span> 🃏</p>
        <h1 className="font-display text-4xl text-brass-shine">Tonight's poker</h1>
      </motion.section>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/tournament/new" className="card-felt p-5 text-center group hover:border-brass-500/50 transition">
          <div className="text-4xl mb-2">🏆</div>
          <div className="font-display text-xl text-brass-shine">Tournament</div>
          <div className="text-xs text-ink-400 mt-1">Set up & run</div>
        </Link>
        <Link to="/cash/new" className="card-felt p-5 text-center group hover:border-brass-500/50 transition">
          <div className="text-4xl mb-2">💵</div>
          <div className="font-display text-xl text-brass-shine">Cash Game</div>
          <div className="text-xs text-ink-400 mt-1">Live ledger</div>
        </Link>
      </div>

      {live.length > 0 && (
        <Card>
          <p className="label">Live tournaments</p>
          <ul className="space-y-2">
            {live.map((t) => (
              <li key={t.id} className="flex items-center bg-felt-950/60 rounded-xl hover:bg-felt-900">
                <Link to={`/tournament/${t.id}`} className="flex-1 flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-ink-400">
                      Lvl {t.current_level + 1} · {t.state}{t.join_code ? ` · ${t.join_code}` : ''}
                    </div>
                  </div>
                  <span className="text-brass-300 text-2xl">→</span>
                </Link>
                <button
                  onClick={() => setActing({ kind: 'tournament', id: t.id, name: t.name })}
                  className="px-3 py-3 text-ink-400 hover:text-ink-100"
                  title="Manage"
                >⋯</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {liveCash.length > 0 && (
        <Card>
          <p className="label">Live cash games</p>
          <ul className="space-y-2">
            {liveCash.map((c) => (
              <li key={c.id} className="flex items-center bg-felt-950/60 rounded-xl hover:bg-felt-900">
                <Link to={`/cash/${c.id}`} className="flex-1 flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-ink-400">{c.small_blind}/{c.big_blind} · {c.currency}{c.join_code ? ` · ${c.join_code}` : ''}</div>
                  </div>
                  <span className="text-brass-300 text-2xl">→</span>
                </Link>
                <button
                  onClick={() => setActing({ kind: 'cash_game', id: c.id, name: c.name })}
                  className="px-3 py-3 text-ink-400 hover:text-ink-100"
                  title="Manage"
                >⋯</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet open={!!acting} onClose={() => setActing(null)} title={acting?.name ?? ''}>
        <div className="space-y-3">
          <Button variant="ghost" full onClick={endIt}>
            🏁 End now (move to History)
          </Button>
          <Button variant="danger" full onClick={deleteIt}>
            🗑 Delete permanently
          </Button>
        </div>
      </Sheet>

      {tournaments.filter((t) => t.state === 'finished').length > 0 && (
        <Card>
          <p className="label">Recent tournaments</p>
          <ul className="space-y-2">
            {tournaments.filter((t) => t.state === 'finished').slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link to={`/tournament/${t.id}`} className="flex items-center justify-between bg-felt-950/40 rounded-xl px-4 py-3 hover:bg-felt-900 text-sm">
                  <span>{t.name}</span>
                  <span className="text-ink-400 font-mono">{formatMoney(t.buy_in, t.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tournaments.length === 0 && cashGames.length === 0 && (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">🎲</div>
          <h3 className="font-display text-2xl text-brass-shine">First night?</h3>
          <p className="text-ink-400 text-sm mt-1 mb-4">Set up a tournament or cash game to start tracking.</p>
          <Link to="/tournament/new"><Button>Start a tournament →</Button></Link>
        </Card>
      )}
    </div>
  );
}
