import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { useSettings } from '@/store/settings';
import { formatMoney } from '@/lib/format';
import type { CashBuyIn, CashGame, CashGamePlayer, Profile, Tournament, TournamentPlayer } from '@/types/db';

interface Props {
  tournaments: Tournament[];
  tournPlayers: TournamentPlayer[];
  cashGames: CashGame[];
  cashPlayers: CashGamePlayer[];
  cashBuyIns: CashBuyIn[];
  profileMap: Record<string, Profile>;
}

interface Point { date: number; net: number; }
interface Series { id: string; name: string; color: string; points: Point[]; final: number; }

const COLORS = ['#d8a920', '#3f9559', '#ec4899', '#06b6d4', '#a855f7', '#f97316', '#22c55e', '#eab308'];

/** Cumulative net-per-night line chart (top 5 players) + tournaments-per-month bar chart */
export function StatsCharts({ tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap }: Props) {
  const { currency } = useSettings();

  // Build per-player chronologically-sorted "events" (one per finished game) and
  // accumulate net.
  const series = useMemo<Series[]>(() => {
    const tMap = new Map(tournaments.map((t) => [t.id, t]));
    const cMap = new Map(cashGames.map((c) => [c.id, c]));
    const buyInTotals: Record<string, number> = {};
    for (const b of cashBuyIns) buyInTotals[b.cash_game_player_id] = (buyInTotals[b.cash_game_player_id] ?? 0) + Number(b.amount);

    interface Evt { who: string; name: string; date: number; delta: number; }
    const events: Evt[] = [];

    for (const p of tournPlayers) {
      const t = tMap.get(p.tournament_id); if (!t) continue;
      const who = p.profile_id ? `p:${p.profile_id}` : `g:${p.guest_name}`;
      const name = p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
      const spent = p.buy_ins * Number(t.buy_in) + p.rebuys * Number(t.rebuy_amount ?? 0) + p.addons * Number(t.addon_amount ?? 0);
      const bountyEarn = p.bounties_won * Number(t.bounty_amount);
      events.push({ who, name, date: Date.parse(t.created_at), delta: Number(p.prize ?? 0) + bountyEarn - spent });
    }
    for (const cp of cashPlayers) {
      const g = cMap.get(cp.cash_game_id); if (!g) continue;
      const who = cp.profile_id ? `p:${cp.profile_id}` : `g:${cp.guest_name}`;
      const name = cp.profile_id ? profileMap[cp.profile_id]?.display_name ?? '…' : (cp.guest_name ?? 'Guest');
      const cIn = buyInTotals[cp.id] ?? 0;
      events.push({ who, name, date: Date.parse(g.created_at), delta: Number(cp.cash_out ?? 0) - cIn });
    }
    events.sort((a, b) => a.date - b.date);

    const byPlayer: Record<string, Series> = {};
    for (const e of events) {
      if (!byPlayer[e.who]) {
        byPlayer[e.who] = { id: e.who, name: e.name, color: '#888', points: [{ date: e.date, net: 0 }], final: 0 };
      }
      const last = byPlayer[e.who].points[byPlayer[e.who].points.length - 1];
      const newNet = last.net + e.delta;
      byPlayer[e.who].points.push({ date: e.date, net: newNet });
      byPlayer[e.who].final = newNet;
    }
    // Top 5 by absolute final
    const top = Object.values(byPlayer)
      .sort((a, b) => Math.abs(b.final) - Math.abs(a.final))
      .slice(0, 5)
      .map((s, i) => ({ ...s, color: COLORS[i % COLORS.length] }));
    return top;
  }, [tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap]);

  // Per-month tournament count
  const monthly = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tournaments) {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const c of cashGames) {
      const d = new Date(c.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [tournaments, cashGames]);

  if (series.length === 0 && monthly.length === 0) return null;

  // Line chart geometry
  const W = 320, H = 140, P = 24;
  const allDates = series.flatMap((s) => s.points.map((p) => p.date));
  const allNets  = series.flatMap((s) => s.points.map((p) => p.net));
  const xMin = Math.min(...allDates, Date.now());
  const xMax = Math.max(...allDates, Date.now());
  const yMin = Math.min(0, ...allNets);
  const yMax = Math.max(0, ...allNets);
  const sx = (d: number) => P + ((d - xMin) / Math.max(1, xMax - xMin)) * (W - P * 2);
  const sy = (n: number) => H - P - ((n - yMin) / Math.max(1, yMax - yMin)) * (H - P * 2);

  const maxMonthly = Math.max(1, ...monthly.map(([, n]) => n));

  return (
    <div className="space-y-3">
      {series.length > 0 && (
        <Card>
          <p className="label">Net over time · top 5</p>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {/* Zero line */}
            <line x1={P} x2={W - P} y1={sy(0)} y2={sy(0)} stroke="rgb(var(--ink-700))" strokeDasharray="2 3" />
            {series.map((s) => {
              const d = s.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.date).toFixed(1)} ${sy(p.net).toFixed(1)}`)
                .join(' ');
              return (
                <g key={s.id}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={sx(s.points[s.points.length - 1].date)} cy={sy(s.final)} r={3} fill={s.color} />
                </g>
              );
            })}
          </svg>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-xs mt-2">
            {series.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="truncate">{s.name}</span>
                <span className={`ml-auto font-mono ${s.final > 0 ? 'text-emerald-400' : s.final < 0 ? 'text-red-400' : 'text-ink-300'}`}>
                  {s.final >= 0 ? '+' : ''}{formatMoney(s.final, currency)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {monthly.length > 0 && (
        <Card>
          <p className="label">Sessions per month</p>
          <div className="flex items-end gap-1 h-24">
            {monthly.map(([key, n]) => (
              <div key={key} className="flex-1 flex flex-col items-center gap-1 group">
                <div
                  className="w-full bg-brass-shine rounded-sm group-hover:brightness-110 transition"
                  style={{
                    height: `${(n / maxMonthly) * 100}%`,
                    backgroundImage: 'linear-gradient(180deg, rgb(var(--shine-mid)) 0%, rgb(var(--shine-to)) 100%)',
                  }}
                  title={`${n} session${n === 1 ? '' : 's'}`}
                />
                <div className="text-[9px] text-ink-500 font-mono">{key.slice(2).replace('-', '/')}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
