import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { useSeason } from '@/store/season';
import { formatMoney } from '@/lib/format';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { seasonPointsForPlace } from '@/features/tournament/payouts';
import type { Profile, Tournament, TournamentPlayer } from '@/types/db';

interface SeasonPot {
  season_id: string | null;
  season_name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  pot: number;
  contributing_tournaments: number;
  contributing_entries: number;
}

interface Props {
  tournaments: Tournament[];
  tournPlayers: TournamentPlayer[];
  profileMap: Record<string, Profile>;
}

/**
 * Pro centerpiece tile for the leaderboard tab when the active season runs
 * with a per-entry carve. Shows the accumulated pot (animated count-up),
 * how many tournaments + entries fed it, and the season-points standings
 * derived from finishing positions across every tournament in the season.
 *
 * Renders nothing when no season is active or the active season has no carve.
 */
export function SeasonPotCard({ tournaments, tournPlayers, profileMap }: Props) {
  const { currency } = useSettings();
  const { activeSeasonId } = useSeason();
  const [pots, setPots] = useState<SeasonPot[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('season_pots').select('*');
      if (!cancelled) setPots((data ?? []) as SeasonPot[]);
    };
    void load();
    // Light polling — pot accumulates as games finish, so we just refresh
    // whenever this card is visible. Tournaments realtime triggers reload too.
    const id = setInterval(() => { if (!cancelled) void load(); }, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const active = useMemo(
    () => pots.find((p) => p.season_id === activeSeasonId) ?? null,
    [pots, activeSeasonId],
  );

  // Season-points standings: derived purely from finishing_position across
  // tournaments scoped to the active season. Honest read on who's leading
  // for the final-table seats.
  const standings = useMemo(() => {
    if (!activeSeasonId) return [];
    const seasonTournIds = new Set(tournaments.filter((t) => t.season_id === activeSeasonId).map((t) => t.id));
    const byPlayer = new Map<string, { id: string; name: string; points: number; cashes: number; entries: number }>();
    for (const p of tournPlayers) {
      if (!seasonTournIds.has(p.tournament_id)) continue;
      const who = p.profile_id ? `p:${p.profile_id}` : `g:${p.guest_name}`;
      const name = p.profile_id ? profileMap[p.profile_id]?.display_name ?? '…' : (p.guest_name ?? 'Guest');
      const row = byPlayer.get(who) ?? { id: who, name, points: 0, cashes: 0, entries: 0 };
      row.entries += 1;
      const pts = seasonPointsForPlace(p.finishing_position);
      row.points += pts;
      if (p.finishing_position && p.finishing_position <= 6) row.cashes += 1;
      byPlayer.set(who, row);
    }
    return Array.from(byPlayer.values())
      .filter((r) => r.points > 0 || r.entries > 0)
      .sort((a, b) => b.points - a.points || b.cashes - a.cashes || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [activeSeasonId, tournaments, tournPlayers, profileMap]);

  if (!active || active.pot <= 0) return null;

  const top3 = standings.slice(0, 3);
  const rest = standings.slice(3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl p-4 sm:p-5 shadow-glow text-felt-950"
      style={{ backgroundImage: 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)' }}
    >
      {/* Slow shine sweep — same energy as the JoinBadge */}
      <motion.span
        aria-hidden
        className="absolute inset-y-0 -left-1/2 w-1/2 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }}
        animate={{ x: ['0%', '420%'] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 3 }}
      />

      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🏆</span>
          <span className="uppercase tracking-[0.4em] text-[10px] font-bold text-felt-950/80">Season pot</span>
          {active.season_name && (
            <span className="ml-auto text-[10px] uppercase tracking-widest text-felt-950/70 truncate max-w-[40%]">
              {active.season_name}
            </span>
          )}
        </div>
        <div className="font-display leading-none tabular-nums text-felt-950" style={{ fontSize: 'clamp(2.2rem, 8vmin, 3.6rem)' }}>
          <AnimatedNumber value={Number(active.pot)} format={(n) => formatMoney(Math.round(n), currency)} />
        </div>
        <div className="text-[11px] text-felt-950/75 mt-1">
          {active.contributing_tournaments} tournament{active.contributing_tournaments === 1 ? '' : 's'} · {active.contributing_entries} entries · paid out at the season-end final table
        </div>
      </div>

      {standings.length > 0 && (
        <div className="relative mt-4 pt-3 border-t border-felt-950/20">
          <div className="uppercase tracking-[0.35em] text-[10px] font-bold text-felt-950/80 mb-2">Final-table standings</div>
          {top3.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {top3.map((s, i) => (
                <div key={s.id} className="bg-felt-950/15 rounded-xl px-2 py-2 text-center">
                  <div className="text-xl">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
                  <div className="text-[11px] font-semibold text-felt-950 truncate mt-0.5">{s.name}</div>
                  <div className="text-[10px] text-felt-950/70 tabular-nums">{s.points} pts · {s.cashes} cash{s.cashes === 1 ? '' : 'es'}</div>
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <ul className="text-[11px] space-y-0.5">
              {rest.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-felt-950/85">
                  <span className="truncate"><span className="opacity-60 mr-1.5">{i + 4}.</span>{s.name}</span>
                  <span className="tabular-nums shrink-0">{s.points} pts</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </motion.div>
  );
}
