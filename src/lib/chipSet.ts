/**
 * Home Pot — physical chip inventory and chip-aware helpers.
 *
 * The DEFAULT_INVENTORY matches the user's actual chip set. Players can edit
 * their inventory in Settings; the wizard then uses the live inventory for
 * stack suggestions, color-up alerts, and per-player distribution.
 */

export type Denomination =
  | 1
  | 2
  | 5
  | 10
  | 25
  | 50
  | 100
  | 500
  | 1000
  | 5000
  | 10000
  | 25000
  | 100000;

export const DENOMINATIONS: Denomination[] = [
  1, 2, 5, 10, 25, 50, 100, 500, 1000, 5000, 10000, 25000, 100000,
];

/** Default visual color for each denomination (used in UI). */
export const CHIP_COLORS: Record<Denomination, string> = {
  1: '#cbd5e1',     // light grey
  2: '#fbbf24',     // amber
  5: '#ef4444',     // red
  10: '#3b82f6',    // blue
  25: '#22c55e',    // green
  50: '#f97316',    // orange
  100: '#0f172a',   // black
  500: '#a855f7',   // purple
  1000: '#eab308',  // gold
  5000: '#ec4899',  // pink
  10000: '#06b6d4', // cyan
  25000: '#84cc16', // lime
  100000: '#dc2626',// crimson
};

/** Counts of physical chips owned, by denomination. */
export type ChipInventory = Record<Denomination, number>;

/** The user's actual chip set, captured 2026-04-22. */
export const DEFAULT_INVENTORY: ChipInventory = {
  1: 70,
  2: 200,
  5: 110,
  10: 120,
  25: 120,
  50: 120,
  100: 90,
  500: 60,
  1000: 50,
  5000: 15,
  10000: 15,
  25000: 15,
  100000: 15,
};

/** Total physical chips in the inventory. */
export function totalChips(inv: ChipInventory): number {
  return DENOMINATIONS.reduce((s, d) => s + (inv[d] ?? 0), 0);
}

/** Total face-value if every chip in the inventory is in play. */
export function totalChipValue(inv: ChipInventory): number {
  return DENOMINATIONS.reduce((s, d) => s + d * (inv[d] ?? 0), 0);
}

/** Returns a human label like "T1" / "T25" / "T100k" for tournament chips. */
export function chipLabel(d: Denomination): string {
  if (d >= 1000) return `T${d / 1000}k`;
  return `T${d}`;
}

// ---------------------------------------------------------------------------
// Stack distribution suggestions
// ---------------------------------------------------------------------------

/**
 * Pick a sensible per-player starting stack denomination mix.
 *
 * Strategy: greedy from the smallest denomination upward, capping each
 * denomination so we never exceed `inventory[d] / players` of that chip
 * (so every player can be served evenly), and capping the final mix to land
 * near `targetTotal`.
 *
 * Returns the per-player breakdown plus the resulting actual total.
 */
export interface StackSuggestion {
  perPlayer: Partial<Record<Denomination, number>>;
  actualTotal: number;
  targetTotal: number;
  warnings: string[];
}

export function suggestStartingStack(
  inventory: ChipInventory,
  players: number,
  targetTotal: number,
): StackSuggestion {
  const warnings: string[] = [];
  if (players <= 0) {
    return { perPlayer: {}, actualTotal: 0, targetTotal, warnings: ['No players'] };
  }

  // How many of each chip every player can fairly receive (small chips first).
  const perPlayerCap: Record<Denomination, number> = { ...DEFAULT_INVENTORY };
  DENOMINATIONS.forEach((d) => {
    perPlayerCap[d] = Math.floor((inventory[d] ?? 0) / players);
  });

  // Lock the *small* chips first — every player should have small change for
  // early blinds. We aim for a typical home-game starter mix:
  //   20×T25  +  20×T100  +  10×T500  +  4×T1000   →  ~10,500 (scaled to target)
  const targetMixWeights: Array<[Denomination, number]> = [
    [25, 20],
    [100, 20],
    [500, 10],
    [1000, 4],
    [5000, 1],
  ];

  // Compute scaled mix to roughly reach targetTotal.
  const baseTotal = targetMixWeights.reduce((s, [d, n]) => s + d * n, 0);
  const scale = targetTotal / baseTotal;

  const perPlayer: Partial<Record<Denomination, number>> = {};
  let runningTotal = 0;

  for (const [d, baseCount] of targetMixWeights) {
    const desired = Math.max(0, Math.round(baseCount * scale));
    const allowed = Math.min(desired, perPlayerCap[d] ?? 0);
    if (allowed < desired) {
      warnings.push(
        `Only ${allowed}× T${d} per player available (wanted ${desired}). Consider buying more or adjusting starting stack.`,
      );
    }
    if (allowed > 0) {
      perPlayer[d] = allowed;
      runningTotal += allowed * d;
    }
  }

  // If we're short of target, top up with the next-larger available chip.
  let shortfall = targetTotal - runningTotal;
  if (shortfall > 0) {
    for (const d of [1000, 5000, 10000, 25000, 100000] as Denomination[]) {
      if (shortfall <= 0) break;
      const need = Math.ceil(shortfall / d);
      const allowed = Math.min(need, perPlayerCap[d] ?? 0);
      if (allowed > 0) {
        perPlayer[d] = (perPlayer[d] ?? 0) + allowed;
        runningTotal += allowed * d;
        shortfall = targetTotal - runningTotal;
      }
    }
  }

  if (Math.abs(runningTotal - targetTotal) > targetTotal * 0.1) {
    warnings.push(
      `Best achievable stack is ${runningTotal.toLocaleString()} (target was ${targetTotal.toLocaleString()}).`,
    );
  }

  return { perPlayer, actualTotal: runningTotal, targetTotal, warnings };
}

/**
 * For a given big blind, identify chip denominations that have become
 * "useless" (smaller than ~5% of the BB) — candidates for color-up.
 */
export function colorUpCandidates(currentBigBlind: number): Denomination[] {
  const threshold = currentBigBlind * 0.05;
  return DENOMINATIONS.filter((d) => d < threshold);
}

/**
 * Suggest a starting stack value (per player) given player count and the
 * inventory. Aims for ~50–100 big blinds at the opening level using a
 * round-number stack like 5,000 / 10,000 / 25,000.
 */
export function suggestStackSize(
  inventory: ChipInventory,
  players: number,
): number {
  const totalValue = totalChipValue(inventory);
  const perPlayerBudget = Math.floor(totalValue / Math.max(players, 1));
  // Round down to a clean number that's friendly for poker stacks
  const candidates = [3000, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 50000];
  let best = candidates[0];
  for (const c of candidates) {
    if (c <= perPlayerBudget) best = c;
  }
  return best;
}
