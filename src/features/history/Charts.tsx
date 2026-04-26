import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

/** Catmull-Rom → cubic Bézier. Smooth curves between every point. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function StatsCharts({ tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap }: Props) {
  const { currency } = useSettings();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

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
    return Object.values(byPlayer)
      .sort((a, b) => Math.abs(b.final) - Math.abs(a.final))
      .slice(0, 5)
      .map((s, i) => ({ ...s, color: COLORS[i % COLORS.length] }));
  }, [tournaments, tournPlayers, cashGames, cashPlayers, cashBuyIns, profileMap]);

  const monthly = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tournaments) {
      const d = new Date(t.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of cashGames) {
      const d = new Date(c.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [tournaments, cashGames]);

  if (series.length === 0 && monthly.length === 0) return null;

  // Geometry
  const W = 360, H = 180, PL = 8, PR = 8, PT = 14, PB = 22;
  const allDates = series.flatMap((s) => s.points.map((p) => p.date));
  const allNets  = series.flatMap((s) => s.points.map((p) => p.net));
  const xMin = allDates.length ? Math.min(...allDates) : Date.now() - 86400000;
  const xMax = allDates.length ? Math.max(...allDates) : Date.now();
  const yMinR = Math.min(0, ...allNets);
  const yMaxR = Math.max(0, ...allNets);
  // Add 8% headroom so the line never kisses the edges.
  const pad = Math.max(1, (yMaxR - yMinR) * 0.08);
  const yMin = yMinR - pad;
  const yMax = yMaxR + pad;
  const sx = (d: number) => PL + ((d - xMin) / Math.max(1, xMax - xMin)) * (W - PL - PR);
  const sy = (n: number) => H - PB - ((n - yMin) / Math.max(1, yMax - yMin)) * (H - PT - PB);

  const zeroY = sy(0);

  // Find nearest point per series for hover crosshair
  const hoverData = hoverX !== null
    ? series.map((s) => {
        let nearest = s.points[0];
        let bestDx = Infinity;
        for (const p of s.points) {
          const dx = Math.abs(sx(p.date) - hoverX);
          if (dx < bestDx) { bestDx = dx; nearest = p; }
        }
        return { series: s, point: nearest };
      })
    : null;

  const hoverDate = hoverData?.[0]?.point.date;

  const maxMonthly = Math.max(1, ...monthly.map(([, n]) => n));

  return (
    <div className="space-y-3">
      {series.length > 0 && (
        <Card>
          <div className="flex items-baseline justify-between mb-1">
            <p className="label !mb-0">Net over time · top 5</p>
            <p className="text-[10px] text-ink-500">tap a name to focus · drag chart for tooltip</p>
          </div>

          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto select-none touch-none"
              preserveAspectRatio="none"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - r.left) / r.width;
                setHoverX(PL + ratio * (W - PL - PR));
              }}
              onPointerLeave={() => setHoverX(null)}
            >
              <defs>
                {series.map((s) => (
                  <linearGradient key={`grad-${s.id}`} id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
                <filter id="chart-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* horizontal grid lines (subtle) */}
              {[0.25, 0.5, 0.75].map((q) => (
                <line key={q}
                  x1={PL} x2={W - PR}
                  y1={PT + q * (H - PT - PB)} y2={PT + q * (H - PT - PB)}
                  stroke="rgb(var(--ink-700))" strokeWidth={0.5} strokeOpacity={0.3} />
              ))}
              {/* zero baseline */}
              <line x1={PL} x2={W - PR} y1={zeroY} y2={zeroY}
                stroke="rgb(var(--brass-300))" strokeOpacity={0.45} strokeDasharray="3 3" strokeWidth={0.8} />

              {series.map((s) => {
                const pts = s.points.map((p) => ({ x: sx(p.date), y: sy(p.net) }));
                if (pts.length < 2) return null;
                const linePath = smoothPath(pts);
                const fillPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
                const isFocused = focused === s.id;
                const dim = focused !== null && !isFocused;
                const last = pts[pts.length - 1];

                return (
                  <g key={s.id} opacity={dim ? 0.18 : 1} style={{ transition: 'opacity 0.2s' }}>
                    {/* gradient fill below line, masked above the zero baseline */}
                    <motion.path
                      d={fillPath}
                      fill={`url(#grad-${s.id})`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                    />
                    {/* the line itself, drawing in over 1.2s */}
                    <motion.path
                      d={linePath}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={isFocused ? 2.6 : 1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter={isFocused ? 'url(#chart-glow)' : undefined}
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.2, ease: [0.22, 0.61, 0.36, 1] }}
                    />
                    {/* pulsing endpoint dot */}
                    <motion.circle
                      cx={last.x} cy={last.y}
                      fill={s.color}
                      animate={{ r: [3, 5.5, 3], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </g>
                );
              })}

              {/* hover crosshair + dots */}
              {hoverData && (
                <g pointerEvents="none">
                  <line x1={hoverX!} x2={hoverX!} y1={PT} y2={H - PB}
                        stroke="rgb(var(--ink-300))" strokeOpacity={0.4} strokeWidth={0.8} />
                  {hoverData.map(({ series: s, point }) => (
                    <circle key={s.id} cx={sx(point.date)} cy={sy(point.net)} r={4}
                            fill="rgb(var(--felt-950))" stroke={s.color} strokeWidth={2} />
                  ))}
                </g>
              )}
            </svg>

            {/* hover tooltip */}
            <AnimatePresence>
              {hoverData && hoverDate !== undefined && (
                <motion.div
                  key="tt"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute top-2 left-2 right-2 pointer-events-none"
                >
                  <div className="bg-felt-950/95 backdrop-blur border border-felt-700 rounded-lg px-2.5 py-1.5 text-[11px] inline-block">
                    <div className="text-ink-400 mb-0.5 font-mono">
                      {new Date(hoverDate).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}
                    </div>
                    <div className="space-y-0.5">
                      {hoverData
                        .slice()
                        .sort((a, b) => b.point.net - a.point.net)
                        .map(({ series: s, point }) => (
                          <div key={s.id} className="flex items-center gap-2 min-w-[140px]">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                            <span className="truncate text-ink-200">{s.name}</span>
                            <span className={`ml-auto font-mono ${point.net > 0 ? 'text-emerald-400' : point.net < 0 ? 'text-red-400' : 'text-ink-300'}`}>
                              {point.net >= 0 ? '+' : ''}{formatMoney(point.net, currency)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* legend / focus toggles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-xs mt-2">
            {series.map((s) => {
              const active = focused === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setFocused(active ? null : s.id)}
                  className={`flex items-center gap-1.5 truncate text-left rounded px-1 py-0.5 transition ${
                    active ? 'bg-felt-800/60' : 'hover:bg-felt-900/40'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color, boxShadow: active ? `0 0 8px ${s.color}` : undefined }} />
                  <span className="truncate">{s.name}</span>
                  <span className={`ml-auto font-mono ${s.final > 0 ? 'text-emerald-400' : s.final < 0 ? 'text-red-400' : 'text-ink-300'}`}>
                    {s.final >= 0 ? '+' : ''}{formatMoney(s.final, currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {monthly.length > 0 && (
        <Card>
          <p className="label">Sessions per month</p>
          <div className="flex items-end gap-1 h-28">
            {monthly.map(([key, n], i) => (
              <div key={key} className="flex-1 flex flex-col items-center gap-1 group" title={`${n} session${n === 1 ? '' : 's'}`}>
                <motion.div
                  className="w-full rounded-t-md relative overflow-hidden"
                  style={{
                    backgroundImage: 'linear-gradient(180deg, rgb(var(--shine-mid)) 0%, rgb(var(--shine-to)) 100%)',
                    boxShadow: '0 0 12px rgb(var(--shine-mid) / 0.35)',
                  }}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: `${(n / maxMonthly) * 100}%`, opacity: 1 }}
                  transition={{ duration: 0.55, delay: 0.05 * i, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  <span className="absolute inset-x-0 -top-4 text-center font-mono text-[10px] text-brass-200">{n}</span>
                </motion.div>
                <div className="text-[9px] text-ink-500 font-mono">{key.slice(2).replace('-', '/')}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
