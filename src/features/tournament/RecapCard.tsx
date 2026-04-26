import { motion } from 'framer-motion';
import type { Tournament, TournamentPlayer } from '@/types/db';
import { formatMoney } from '@/lib/format';

interface RecapCardProps {
  tournament: Tournament;
  players: TournamentPlayer[];
  /** Optional name lookup map for profile-linked players. */
  nameFor?: (p: TournamentPlayer) => string;
}

/**
 * Tournament recap shown when state === 'finished'. Champion, runner-up,
 * biggest knockout count, total rebuys. Designed to be monitor-friendly
 * (large vmin sizes), self-contained — no buttons, just the story.
 */
export function RecapCard({ tournament, players, nameFor }: RecapCardProps) {
  const display = nameFor ?? ((p) => p.guest_name ?? '🃏');
  const sorted = [...players].sort((a, b) =>
    (a.finishing_position ?? 9999) - (b.finishing_position ?? 9999),
  );
  const champion = sorted.find((p) => p.finishing_position === 1) ?? sorted[0];
  const runnerUp = sorted.find((p) => p.finishing_position === 2);

  const bountyLeader = [...players].sort((a, b) => b.bounties_won - a.bounties_won)[0];
  const rebuyLeader = [...players].sort((a, b) => b.rebuys - a.rebuys)[0];
  const totalRebuys = players.reduce((s, p) => s + p.rebuys, 0);
  const totalAddons = players.reduce((s, p) => s + p.addons, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className="card-felt p-6 sm:p-8 max-w-3xl w-full mx-auto"
    >
      <div className="text-center mb-6">
        <div className="uppercase tracking-[0.5em] text-brass-300/80 font-semibold" style={{ fontSize: 'clamp(0.7rem, 2vmin, 1rem)' }}>
          Tournament recap
        </div>
        <div className="font-display text-brass-shine truncate mt-1" style={{ fontSize: 'clamp(1.4rem, 5vmin, 2.6rem)' }}>
          {tournament.name}
        </div>
      </div>

      {/* Champion hero */}
      {champion && (
        <div className="rounded-2xl p-5 sm:p-6 text-felt-950 shadow-glow text-center"
          style={{ backgroundImage: 'linear-gradient(135deg, #ecd075 0%, #d8a920 50%, #bf9013 100%)' }}>
          <div style={{ fontSize: 'clamp(2.5rem, 9vmin, 4.5rem)' }}>🥇</div>
          <div className="font-display mt-1" style={{ fontSize: 'clamp(1.6rem, 6vmin, 3rem)' }}>
            {display(champion)}
          </div>
          <div className="font-sans uppercase tracking-[0.4em] mt-1 opacity-80" style={{ fontSize: 'clamp(0.7rem, 1.8vmin, 1rem)' }}>
            Champion · {formatMoney(champion.prize, tournament.currency)}
          </div>
        </div>
      )}

      {/* Podium row */}
      {runnerUp && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <RecapStat
            glyph="🥈"
            label="Runner-up"
            value={display(runnerUp)}
            sub={formatMoney(runnerUp.prize, tournament.currency)}
          />
          {bountyLeader && bountyLeader.bounties_won > 0 ? (
            <RecapStat
              glyph="💀"
              label="Bounty hunter"
              value={display(bountyLeader)}
              sub={`${bountyLeader.bounties_won} knockout${bountyLeader.bounties_won === 1 ? '' : 's'}`}
            />
          ) : (
            <RecapStat
              glyph="👥"
              label="Players"
              value={`${players.length}`}
              sub={`${totalRebuys + totalAddons} rebuys/addons`}
            />
          )}
        </div>
      )}

      {/* Tail row */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        {rebuyLeader && rebuyLeader.rebuys > 0 && (
          <RecapStat
            glyph="🔁"
            label="Most rebuys"
            value={display(rebuyLeader)}
            sub={`${rebuyLeader.rebuys} rebuy${rebuyLeader.rebuys === 1 ? '' : 's'}`}
          />
        )}
        <RecapStat
          glyph="🪙"
          label="Buy-in"
          value={formatMoney(tournament.buy_in, tournament.currency)}
          sub={`${players.length} entries`}
        />
      </div>
    </motion.div>
  );
}

function RecapStat({ glyph, label, value, sub }: { glyph: string; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-felt-950/60 border border-felt-800 rounded-xl px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-ink-400">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <span style={{ fontSize: 'clamp(1.2rem, 3vmin, 1.7rem)' }}>{glyph}</span>
        <div className="min-w-0">
          <div className="font-display text-brass-shine truncate" style={{ fontSize: 'clamp(0.95rem, 2.6vmin, 1.4rem)' }}>{value}</div>
          {sub && <div className="text-[11px] text-ink-400 truncate">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
