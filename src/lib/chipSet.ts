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
 *  for common bets, fewer big chips for fast stacking. The 6-band profile
 *  tapers off at the very top so weight isn't wasted on a top denomination
 *  that's too large to fit even one chip into a typical stack. */
const DISTRIBUTION_PROFILES: Record<number, number[]> = {
  1: [100],
  2: [25, 75],
  3: [10, 30, 60],
  4: [6, 16, 32, 46],
  5: [5, 12, 22, 30, 31],
  6: [4, 10, 18, 28, 30, 10],
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
  // Largest sensible denomination for a stack: a third of the target (any
  // chip ≥ 50% of the stack is a "stack-killer" that gets used for one all-in
  // and then disappears; a third keeps the biggest chip useful for several
  // bets). Floor at smallest so we always have ≥1 band.
  const largest = Math.max(smallest, Math.floor(targetTotal / 3));

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

  // Pick up to 6 bands, evenly sampled across the candidate spectrum so we
  // use a healthy spread. Six is enough to keep the workhorse mid-bands
  // (typically 100 in a 25/50/100/500/1K/5K set) instead of skipping over them.
  const MAX_BANDS = 6;
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
 * Cash-game variant of {@link suggestStartingStack}.
 *
 * Cash chips need different weighting from tournament chips:
 *  - A working stack of *small-blind chips* must be present so players can
 *    post SB without bothering anyone for change. We reserve 5 of them.
 *  - All inventory bands within range are used (no sampling), so a 2/5/10/25/
 *    50/100 set actually shows the 2-chip instead of skipping to 5.
 *  - Distribution leans middle-heavy (cash players cycle 10/25/50 most), with
 *    fewer huge chips relative to a tournament where big stacks need fast
 *    pre-flop raising potential.
 *
 * Returns the same shape as `suggestStartingStack` so callers can render it
 * the same way.
 */
export function suggestCashStack(
  inventory: ChipInventory,
  players: number,
  buyIn: number,
  smallBlind: number,
): StackSuggestion {
  const warnings: string[] = [];
  if (players <= 0 || buyIn <= 0) {
    return { perPlayer: {}, actualTotal: 0, targetTotal: buyIn, warnings: ['Invalid input'], bands: [] };
  }
  const cap = (d: Denomination) => Math.floor((inventory[d] ?? 0) / Math.max(players, 1));

  // Smallest practical chip = the smallest denomination ≥ SB that we own. If SB
  // doesn't match an exact chip, round up to the closest stocked one.
  const sbDenom: Denomination | undefined = DENOMINATIONS.find(
    (d) => d >= Math.max(smallBlind, 1) && cap(d) >= 1,
  );
  if (!sbDenom) {
    return { perPlayer: {}, actualTotal: 0, targetTotal: buyIn, bands: [],
      warnings: [`No chips ≥ T${smallBlind} available.`] };
  }

  // Never hand out a chip ≥ 50% of the buy-in — for a 200-stack that would
  // be a 100-chip, which kills cash-poker change-making. Cap at one-third.
  const largest = Math.max(sbDenom, Math.floor(buyIn / 3));
  const bands = DENOMINATIONS.filter((d) => d >= sbDenom && d <= largest && cap(d) >= 1);
  if (bands.length === 0) {
    return { perPlayer: {}, actualTotal: 0, targetTotal: buyIn, bands: [],
      warnings: [`No chips in usable range.`] };
  }

  const counts = new Map<Denomination, number>();
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  // Step 1 — reserve a *real working stack* of small chips. Five SB chips is
  // way too few for a 2-4 cash game where SB gets paid every orbit. We size
  // the small-chip reserve to the buy-in so a 500-stack with 2/4 blinds gets
  // ~20 T2 chips, enough to play 15+ orbits without asking for change.
  // Targets ~8% of the buy-in in the smallest band, with hard min/max so we
  // don't go silly on tiny or huge buy-ins.
  const smallest = bands[0];
  const smallTargetValue = Math.max(buyIn * 0.08, sbDenom * 8);
  const smallCount = clamp(
    Math.round(smallTargetValue / smallest),
    Math.min(cap(smallest), 12),  // hard min when stock allows
    Math.min(cap(smallest), 30),  // hard max
  );
  counts.set(smallest, smallCount);

  // Step 2 — second-band floor for raise sizing (3xBB, c-bets etc.). Sized
  // ~15% of the buy-in in the next denomination up; same min/max guard.
  if (bands.length > 1) {
    const second = bands[1];
    const secondTargetValue = Math.max(buyIn * 0.15, sbDenom * 16);
    const secondCount = clamp(
      Math.round(secondTargetValue / second),
      Math.min(cap(second), 8),
      Math.min(cap(second), 20),
    );
    counts.set(second, secondCount);
  }

  // Step 3 — distribute the remaining buy-in across the *upper* bands
  // (skipping the two we already floored). Cash players cycle 25/50/100 most,
  // so a mid-heavy taper works well.
  const reservedNow = Array.from(counts.entries()).reduce((s, [d, n]) => s + d * n, 0);
  const upper = bands.slice(2);
  if (upper.length > 0) {
    const rest = Math.max(0, buyIn - reservedNow);
    // Mid-heavy weights: spread mostly across the lower-mid bands; very few
    // big chips since they're hard to break in cash play.
    const upperWeights = upper.map((_, i) => {
      const center = (upper.length - 1) / 2;
      const dist = Math.abs(i - center);
      return Math.exp(-dist * 0.6);
    });
    const wSum = upperWeights.reduce((s, w) => s + w, 0);
    upper.forEach((d, i) => {
      const wantValue = (rest * upperWeights[i]) / wSum;
      const wantCount = Math.max(0, Math.floor(wantValue / d));
      counts.set(d, Math.min(wantCount, cap(d)));
    });
  }

  const totalOf = () => Array.from(counts.entries()).reduce((s, [d, n]) => s + d * n, 0);
  let total = totalOf();

  // Step 2.5 — if Phase 1 already overshot the buy-in (high weights on small
  // bands can do that), trim from the top before the exact-fill pass.
  for (let safety = 0; safety < 400 && total > buyIn; safety++) {
    let removed = false;
    for (let i = bands.length - 1; i >= 0; i--) {
      const d = bands[i];
      if (d === sbDenom) continue;
      const c = counts.get(d) ?? 0;
      if (c <= 0) continue;
      counts.set(d, c - 1);
      total -= d;
      removed = true;
      break;
    }
    if (!removed) break;
  }

  // Step 3 — exact-target greedy. Pick the largest chip that fits without
  // overshooting, repeat until total === buyIn or no chip fits. The previous
  // version used a 1% tolerance and a tie-break that quietly stopped a few
  // kr short ("500 buy-in" rendering as 495). Now we always hit the target
  // exactly when the available denominations can divide the remaining gap.
  for (let safety = 0; safety < 2000 && total < buyIn; safety++) {
    const remaining = buyIn - total;
    let bestIdx = -1;
    let bestScore = -1;
    bands.forEach((d, i) => {
      if (d > remaining) return;                       // would overshoot
      if ((counts.get(d) ?? 0) >= cap(d)) return;      // out of stock
      // Pick the largest chip that still fits — fewer chips per bag is nicer
      // to handle, and small chips are better saved for blinds.
      if (d > bestScore) { bestScore = d; bestIdx = i; }
    });
    if (bestIdx === -1) break;                         // gap unfillable
    const d = bands[bestIdx];
    counts.set(d, (counts.get(d) ?? 0) + 1);
    total += d;
  }

  const perPlayer: Partial<Record<Denomination, number>> = {};
  bands.forEach((d) => {
    const c = counts.get(d) ?? 0;
    if (c > 0) perPlayer[d] = c;
  });

  if (total !== buyIn) {
    warnings.push(
      `Bag totals ${total.toLocaleString()} — can't reach ${buyIn.toLocaleString()} exactly with the chips on hand (gap ${(buyIn - total).toLocaleString()}).`,
    );
  }

  return { perPlayer, actualTotal: total, targetTotal: buyIn, warnings, bands };
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
