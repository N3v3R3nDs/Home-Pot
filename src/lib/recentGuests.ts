/**
 * Build a clean list of "recent guests" suggestions for the wizard / cash-game
 * add-player sheets. Aggressive dedupe + noise filtering so the user only sees
 * names worth tapping again.
 *
 * Rules:
 *  1. Only count appearances from games that ACTUALLY HAPPENED:
 *     - tournaments: state = 'finished' OR has any rebuy/addon/elimination
 *     - cash_games:  state = 'finished' OR has at least one buy-in
 *     - and never from soft-deleted games (deleted_at IS NULL)
 *  2. A name needs ≥2 appearances total OR ≥1 appearance with a real outcome
 *     (finishing_position set, prize > 0, cash_out set) to surface. Singletons
 *     from abandoned setup (typos, tests) are dropped.
 *  3. Dedupe by NORMALIZED name (lowercase, trim, collapse spaces, fold
 *     Norwegian diacritics). Keep the most-frequent display capitalization.
 *  4. Honor a per-device localStorage blocklist for long-press "forget" .
 */

import { supabase } from './supabase';

const BLOCKLIST_KEY = 'home-pot-guest-blocklist';

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getBlocklist(): Set<string> {
  try {
    const raw = localStorage.getItem(BLOCKLIST_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}
export function blockGuest(name: string) {
  const set = getBlocklist();
  set.add(normalizeName(name));
  try { localStorage.setItem(BLOCKLIST_KEY, JSON.stringify(Array.from(set))); }
  catch { /* noop */ }
}
export function unblockGuest(name: string) {
  const set = getBlocklist();
  set.delete(normalizeName(name));
  try { localStorage.setItem(BLOCKLIST_KEY, JSON.stringify(Array.from(set))); }
  catch { /* noop */ }
}

export interface RecentGuest {
  name: string;       // canonical display form
  appearances: number;
  hasResult: boolean; // touched a tournament finish or cash buy-in
  lastTs: number;
}

/** Fetch + return cleaned recent guests, most-recent first. */
export async function fetchRecentGuests(): Promise<RecentGuest[]> {
  // Pull 200 of each so we have enough signal to dedupe / count
  const [{ data: tps }, { data: cps }, { data: tours }, { data: cgs }, { data: bis }] = await Promise.all([
    supabase.from('tournament_players')
      .select('guest_name, finishing_position, prize, rebuys, addons, eliminated_at, tournament_id, created_at')
      .not('guest_name', 'is', null)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('cash_game_players')
      .select('guest_name, cash_out, cash_game_id, created_at, id')
      .not('guest_name', 'is', null)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('tournaments').select('id, state, deleted_at'),
    supabase.from('cash_games').select('id, state, deleted_at'),
    supabase.from('cash_buy_ins').select('cash_game_player_id'),
  ]);

  // Build "real game" predicate
  const realTour = new Map<string, boolean>();
  for (const t of tours ?? []) {
    const r = t as { id: string; state: string; deleted_at: string | null };
    realTour.set(r.id, !r.deleted_at && r.state !== 'setup');
  }
  const realCash = new Map<string, boolean>();
  for (const g of cgs ?? []) {
    const r = g as { id: string; state: string; deleted_at: string | null };
    realCash.set(r.id, !r.deleted_at);
  }
  const cpHasBuyIn = new Set<string>();
  for (const b of bis ?? []) cpHasBuyIn.add((b as { cash_game_player_id: string }).cash_game_player_id);

  interface Acc {
    canonical: string;          // most-frequent capitalization seen
    canonicalCounts: Record<string, number>;
    appearances: number;
    hasResult: boolean;
    lastTs: number;
  }
  const byKey = new Map<string, Acc>();
  const ensure = (raw: string) => {
    const key = normalizeName(raw);
    if (!key) return null;
    if (!byKey.has(key)) {
      byKey.set(key, { canonical: raw, canonicalCounts: {}, appearances: 0, hasResult: false, lastTs: 0 });
    }
    return byKey.get(key)!;
  };

  for (const r of tps ?? []) {
    const row = r as {
      guest_name: string; finishing_position: number | null; prize: number;
      rebuys: number; addons: number; eliminated_at: string | null;
      tournament_id: string; created_at: string;
    };
    if (!realTour.get(row.tournament_id)) continue;
    const a = ensure(row.guest_name); if (!a) continue;
    a.appearances += 1;
    a.canonicalCounts[row.guest_name] = (a.canonicalCounts[row.guest_name] ?? 0) + 1;
    if (row.finishing_position !== null || Number(row.prize) > 0 || row.rebuys > 0 || row.addons > 0 || row.eliminated_at) {
      a.hasResult = true;
    }
    a.lastTs = Math.max(a.lastTs, Date.parse(row.created_at));
  }
  for (const r of cps ?? []) {
    const row = r as {
      guest_name: string; cash_out: number | null;
      cash_game_id: string; created_at: string; id: string;
    };
    if (!realCash.get(row.cash_game_id)) continue;
    if (!cpHasBuyIn.has(row.id) && row.cash_out === null) continue;  // truly abandoned seat
    const a = ensure(row.guest_name); if (!a) continue;
    a.appearances += 1;
    a.canonicalCounts[row.guest_name] = (a.canonicalCounts[row.guest_name] ?? 0) + 1;
    if (row.cash_out !== null || cpHasBuyIn.has(row.id)) a.hasResult = true;
    a.lastTs = Math.max(a.lastTs, Date.parse(row.created_at));
  }

  const block = getBlocklist();

  return Array.from(byKey.entries())
    .filter(([key, a]) => {
      if (block.has(key)) return false;
      // ≥2 appearances OR ≥1 with a real result
      return a.appearances >= 2 || a.hasResult;
    })
    .map(([, a]) => ({
      name: Object.entries(a.canonicalCounts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? a.canonical,
      appearances: a.appearances,
      hasResult: a.hasResult,
      lastTs: a.lastTs,
    }))
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, 30);
}
