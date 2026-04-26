/**
 * Pure derivations from cash-game state. No React, no Supabase. Everything
 * here is computed from the three event tables (cash_games, cash_game_players,
 * cash_buy_ins) — never invents data we don't track (no fake chip stacks).
 */
import type { CashBuyIn, CashGame, CashGamePlayer, Profile } from '@/types/db';

export interface PlayerStats {
  player: CashGamePlayer;
  name: string;
  avatar: string;
  totalIn: number;        // sum of all buy-ins
  cashOut: number | null; // amount when they left, or null while seated
  topUps: number;         // count of buy-ins beyond the first
  seatedSince: number;    // ms timestamp of player.created_at
  /** ms duration at the table (live if still seated, else fixed at cash-out). */
  durationMs: number;
  isSeated: boolean;
  net: number;            // cash_out - totalIn (negative while still seated)
}

export interface ActivityEvent {
  kind: 'buy_in' | 'top_up' | 'join' | 'cash_out';
  at: number;             // ms timestamp
  playerId: string;
  playerName: string;
  amount?: number;
}

export function nameFor(player: CashGamePlayer, profileMap: Record<string, Profile>): string {
  if (player.profile_id) return profileMap[player.profile_id]?.display_name ?? '…';
  return player.guest_name ?? 'Guest';
}

export function avatarFor(player: CashGamePlayer, profileMap: Record<string, Profile>): string {
  if (player.profile_id) return profileMap[player.profile_id]?.avatar_emoji ?? '🃏';
  return '👤';
}

/** Compute per-player stats for a snapshot. `now` lets the caller pass a
 *  ticking clock for live duration display. */
export function computePlayerStats(
  players: CashGamePlayer[],
  buyIns: CashBuyIn[],
  profileMap: Record<string, Profile>,
  now: number,
): PlayerStats[] {
  const buyInsByPlayer = new Map<string, CashBuyIn[]>();
  for (const b of buyIns) {
    const arr = buyInsByPlayer.get(b.cash_game_player_id) ?? [];
    arr.push(b);
    buyInsByPlayer.set(b.cash_game_player_id, arr);
  }
  return players.map((p) => {
    const bs = buyInsByPlayer.get(p.id) ?? [];
    const totalIn = bs.reduce((s, b) => s + b.amount, 0);
    const seatedSince = Date.parse(p.created_at);
    const isSeated = p.cash_out === null;
    return {
      player: p,
      name: nameFor(p, profileMap),
      avatar: avatarFor(p, profileMap),
      totalIn,
      cashOut: p.cash_out,
      topUps: Math.max(0, bs.length - 1),
      seatedSince,
      durationMs: isSeated ? Math.max(0, now - seatedSince) : 0,
      isSeated,
      net: (p.cash_out ?? 0) - totalIn,
    };
  });
}

export function tableTotal(stats: PlayerStats[]): number {
  return stats.reduce((s, p) => s + p.totalIn - (p.cashOut ?? 0), 0);
}

export function totalBoughtIn(stats: PlayerStats[]): number {
  return stats.reduce((s, p) => s + p.totalIn, 0);
}

export function totalCashedOut(stats: PlayerStats[]): number {
  return stats.reduce((s, p) => s + (p.cashOut ?? 0), 0);
}

export function topUpChampion(stats: PlayerStats[]): PlayerStats | null {
  const candidates = stats.filter((p) => p.topUps > 0);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (p.topUps > best.topUps ? p : best));
}

export function biggestStake(stats: PlayerStats[]): PlayerStats | null {
  if (stats.length === 0) return null;
  return stats.reduce((best, p) => (p.totalIn > best.totalIn ? p : best));
}

export function hotSeat(stats: PlayerStats[]): PlayerStats | null {
  const seated = stats.filter((p) => p.isSeated);
  if (seated.length === 0) return null;
  return seated.reduce((best, p) => (p.seatedSince < best.seatedSince ? p : best));
}

export function biggestSingleBuyIn(buyIns: CashBuyIn[]): number {
  if (buyIns.length === 0) return 0;
  return buyIns.reduce((m, b) => (b.amount > m ? b.amount : m), 0);
}

export function sessionDurationMs(game: CashGame, now: number): number {
  const started = Date.parse(game.created_at);
  const ended = game.ended_at ? Date.parse(game.ended_at) : now;
  return Math.max(0, ended - started);
}

/** Buy-ins per hour (excluding the first per player so it's actual rebuy
 *  cadence, not seating cadence). Returns null if too short / no data. */
export function buyInPace(stats: PlayerStats[], game: CashGame, now: number): number | null {
  const totalTopUps = stats.reduce((s, p) => s + p.topUps, 0);
  const hours = sessionDurationMs(game, now) / 3_600_000;
  if (hours < 0.25) return null;
  return totalTopUps / hours;
}

/** Build a most-recent-first activity feed: joins, buy-ins, top-ups, cash-outs. */
export function activityFeed(
  players: CashGamePlayer[],
  buyIns: CashBuyIn[],
  profileMap: Record<string, Profile>,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  // Group buy-ins per player so we can mark first vs subsequent
  const byPlayer = new Map<string, CashBuyIn[]>();
  for (const b of buyIns) {
    const arr = byPlayer.get(b.cash_game_player_id) ?? [];
    arr.push(b);
    byPlayer.set(b.cash_game_player_id, arr);
  }
  for (const arr of byPlayer.values()) arr.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  for (const p of players) {
    const name = nameFor(p, profileMap);
    events.push({
      kind: 'join',
      at: Date.parse(p.created_at),
      playerId: p.id,
      playerName: name,
    });
    const bs = byPlayer.get(p.id) ?? [];
    bs.forEach((b, i) => {
      events.push({
        kind: i === 0 ? 'buy_in' : 'top_up',
        at: Date.parse(b.created_at),
        playerId: p.id,
        playerName: name,
        amount: b.amount,
      });
    });
    if (p.cash_out !== null) {
      // cash_out timestamp isn't stored explicitly; we don't know when it happened.
      // Use updated_at if it existed; for now omit cash-out events from the ticker.
      // Skipping is honest — better than a fake timestamp.
    }
  }

  return events.sort((a, b) => b.at - a.at);
}

/** Format an "Xs/Xm/Xh ago" relative to `now`. Returns short tokens for the
 *  ambient ticker — not for accessibility. */
export function ago(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${hr}h` : `${hr}h${String(remMin).padStart(2, '0')}`;
}

/** Formats a duration in ms as "Hh MMm" or "MMm SSs" depending on length. */
export function formatLongDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
