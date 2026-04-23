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

export interface StackSuggestion {
  perPlayer: Partial<Record<Denomination, number>>;
  actualTotal: number;
  targetTotal: number;
  warnings: string[];
  /** Denominations chosen, smallest → largest. */
  bands: Denomination[];
}

/** Distribution profile per band count — peaks in the upper-middle bands.
 *  Tournament wisdom: a couple of small chips for blinds, more medium chips
 *  for common bets, fewer big chips for fast stacking. */
const DISTRIBUTION_PROFILES: Record<number, number[]> = {
  1: [100],
  2: [25, 75],
  3: [10, 30, 60],
  4: [6, 16, 32, 46],
  5: [4, 12, 22, 30, 32],
  6: [3, 8, 16, 22, 26, 25],
};

/**
 * Pick an optimal per-player starting stack denomination mix.
 *
 *  1. Pick the smallest useful chip (defaults to opening SB so each player can
 *     pay blinds without color-up). Skips smaller denominations that would
 *     just be useless overhead in a tournament.
 *  2. Choose 4-5 bands spanning small → large denominations the inventory
 *     actually has stock of.
 *  3. Distribute by a tournament-realistic weight curve, then top-up / trim
 *     greedily until the actual stack is within ~2.5% of `targetTotal`.
 *
 * Inventory limits are respected: no band gets more chips than
 * `floor(inventory[d] / players)`.
 */
export function suggestStartingStack(
  inventory: ChipInventory,
  players: number,
  targetTotal: number,
  opts: { smallestChip?: Denomination } = {},
): StackSuggestion {
  const warnings: string[] = [];
  if (players <= 0 || targetTotal <= 0) {
    return { perPlayer: {}, actualTotal: 0, targetTotal, warnings: ['No players'], bands: [] };
  }

  const smallest = opts.smallestChip ?? 25;
  // Largest sensible denomination for a stack: half the target (so we never
  // hand out one chip = whole stack). Floor at smallest so we always have ≥1 band.
  const largest = Math.max(smallest, Math.floor(targetTotal / 2));

  // Candidate denominations: in range, and inventory has ≥1 per player.
  const candidates = DENOMINATIONS.filter(
    (d) => d >= smallest && d <= largest && Math.floor((inventory[d] ?? 0) / players) >= 1,
  );

  if (candidates.length === 0) {
    return {
      perPlayer: {}, actualTotal: 0, targetTotal, bands: [],
      warnings: [`No chips ≥ T${smallest} available for ${players} player${players === 1 ? '' : 's'}.`],
    };
  }

  // Pick up to 5 bands, evenly sampled across the candidate spectrum so we
  // use a healthy spread (e.g. 25/50/100/500/1K rather than 25/50/100/500).
  const MAX_BANDS = 5;
  let bands: Denomination[];
  if (candidates.length <= MAX_BANDS) {
    bands = candidates;
  } else {
    const step = (candidates.length - 1) / (MAX_BANDS - 1);
    bands = Array.from({ length: MAX_BANDS }, (_, i) => candidates[Math.round(i * step)]);
  }
  const weights = DISTRIBUTION_PROFILES[bands.length];

  // Capacity per band (per-player limit dictated by inventory)
  const cap = (d: Denomination) => Math.floor((inventory[d] ?? 0) / players);

  // First pass: floor of the weighted target, capped by capacity
  const counts = new Map<Denomination, number>();
  bands.forEach((d, i) => {
    const wantValue = (targetTotal * weights[i]) / 100;
    const wantCount = Math.max(0, Math.floor(wantValue / d));
    counts.set(d, Math.min(wantCount, cap(d)));
  });
  const totalOf = () =>
    Array.from(counts.entries()).reduce((s, [d, n]) => s + d * n, 0);

  const tolerance = Math.max(targetTotal * 0.025, 25);

  // Pass 2 — top up greedily: add the chip that gets us closest to target
  let total = totalOf();
  for (let safety = 0; safety < 100 && total < targetTotal - tolerance; safety++) {
    const remaining = targetTotal - total;
    let bestIdx = -1;
    let bestScore = Infinity;
    bands.forEach((d, i) => {
      if ((counts.get(d) ?? 0) >= cap(d)) return;
      // Prefer chips that don't blow past target; among those, biggest one
      const overshoot = Math.max(0, d - remaining);
      const score = overshoot - d * 0.001;  // tiny tie-break favoring bigger
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    });
    if (bestIdx === -1) break;  // no more capacity anywhere
    const d = bands[bestIdx];
    counts.set(d, (counts.get(d) ?? 0) + 1);
    total += d;
  }

  // Pass 3 — trim if we overshot
  for (let safety = 0; safety < 100 && total > targetTotal + tolerance; safety++) {
    let removedSomething = false;
    // Remove from smallest band that has chips and won't take us too low
    for (const d of bands) {
      const c = counts.get(d) ?? 0;
      if (c <= 0) continue;
      if (total - d < targetTotal - tolerance) continue;
      counts.set(d, c - 1);
      total -= d;
      removedSomething = true;
      break;
    }
    if (!removedSomething) break;
  }

  // Build result map (drop zero-count bands so the UI doesn't render them)
  const perPlayer: Partial<Record<Denomination, number>> = {};
  bands.forEach((d) => {
    const c = counts.get(d) ?? 0;
    if (c > 0) perPlayer[d] = c;
  });

  if (Math.abs(total - targetTotal) > tolerance) {
    warnings.push(
      `Best achievable stack with current inventory is ${total.toLocaleString()} (target ${targetTotal.toLocaleString()}).`,
    );
  }

  // Friendly warnings about chips we wanted but couldn't fully give out
  bands.forEach((d, i) => {
    const wantValue = (targetTotal * weights[i]) / 100;
    const wantCount = Math.max(0, Math.round(wantValue / d));
    const got = counts.get(d) ?? 0;
    if (wantCount > 0 && got < Math.min(wantCount, cap(d))) {
      // covered by main warning
    }
    if (wantCount > cap(d) && cap(d) > 0) {
      warnings.push(`Only ${cap(d)}× T${d} per player available (a perfect mix wants ~${wantCount}).`);
    }
  });

  return { perPlayer, actualTotal: total, targetTotal, warnings, bands };
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
 * Plan a color-up: given chips to remove (worth `removedValue`) and the
 * available bigger denominations a player should receive in exchange, return
 * the swap math.
 *
 * Greedy — pick the largest denomination whose value ≤ removedValue, and so on.
 */
export interface ColorUpStep {
  /** Denomination given back (the bigger one). */
  give: Denomination;
  /** How many chips of `give` to hand back per player. */
  count: number;
}
export interface ColorUpPlan {
  removed: Denomination[];                   // denominations being collected
  removedValuePerPlayer: number;             // total value collected per player
  give: ColorUpStep[];                       // exchange chips
  remainder: number;                         // un-given chip value (race-off)
}

/**
 * Compute color-up suggestion for one player.
 * `playerChips` is what *one* player holds in the doomed denominations.
 */
export function planColorUp(
  playerChips: Partial<Record<Denomination, number>>,
  doomed: Denomination[],
  available: Denomination[],
): ColorUpPlan {
  const removedValuePerPlayer = doomed.reduce(
    (s, d) => s + d * (playerChips[d] ?? 0), 0,
  );
  const give: ColorUpStep[] = [];
  let remaining = removedValuePerPlayer;
  // Greedy from largest available denomination down
  const sorted = [...available].sort((a, b) => b - a);
  for (const d of sorted) {
    const n = Math.floor(remaining / d);
    if (n > 0) {
      give.push({ give: d, count: n });
      remaining -= n * d;
    }
  }
  return {
    removed: doomed,
    removedValuePerPlayer,
    give,
    remainder: remaining,
  };
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
