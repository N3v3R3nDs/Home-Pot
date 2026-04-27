/**
 * Pure planning math for "tonight's chips" — given an inventory, a tournament
 * setup, and a cash-game setup, work out:
 *   1. How many chips per denomination get reserved for tournament starting
 *      stacks (so the dealer pre-builds those bags first).
 *   2. What's *left* in the inventory for cash play.
 *   3. The build of one cash buy-in (denomination breakdown sized to the
 *      blinds so a fresh seat can post and play normally).
 *   4. How many cash buy-ins fit in the remainder.
 *
 * Critically: this is computed live. As tournament players bust, those
 * reserved stacks come back into the dealer's hand — caller passes
 * `bustedTournamentPlayers` so capacity can climb as the night progresses.
 *
 * No DB writes. No schema. Just deterministic math from the same inventory
 * the chip-set page already manages.
 */

import {
  DENOMINATIONS,
  suggestCashStack,
  suggestStartingStack,
  type ChipInventory,
  type Denomination,
} from '@/lib/chipSet';

export interface EveningPlanInput {
  inventory: ChipInventory;
  /** Tournament params; pass null/undefined when no tournament is planned. */
  tournament?: {
    players: number;
    /** Per-player target chip value (e.g. 10,000). */
    startingStack: number;
    /** Optional: how many of those players have already busted out and are
     *  no longer holding their starting stack. Their chips return to the
     *  dealer's float so cash capacity goes up. Default 0. */
    busted?: number;
  } | null;
  /** Cash-game params; pass null/undefined when no cash game is planned. */
  cash?: {
    buyIn: number;
    smallBlind: number;
  } | null;
}

export interface EveningPlan {
  tournament: {
    perPlayer: Partial<Record<Denomination, number>>;
    perPlayerActualValue: number;
    perPlayerTargetValue: number;
    activePlayers: number;            // players × (1 - bustRate); used to size the reserve
    reserved: Partial<Record<Denomination, number>>;  // per-denom × activePlayers
    warnings: string[];
  } | null;
  cash: {
    perBuyIn: Partial<Record<Denomination, number>>;
    perBuyInActualValue: number;
    perBuyInTargetValue: number;
    /** How many fresh buy-in bags can be built from the remaining inventory. */
    buyInsAvailable: number;
    /** Inventory left after subtracting tournament reserves. */
    remaining: Partial<Record<Denomination, number>>;
    warnings: string[];
  } | null;
  /** Inventory deficits after tournament + 1 cash buy-in have been claimed.
   *  Empty when nothing is over-committed. */
  conflicts: { denom: Denomination; short: number }[];
}

/** Subtract `b` from `a`, clamped at zero. Returns a new map. */
function subtractInventory(
  a: ChipInventory,
  b: Partial<Record<Denomination, number>>,
): ChipInventory {
  const out = {} as ChipInventory;
  for (const d of DENOMINATIONS) {
    out[d] = Math.max(0, (a[d] ?? 0) - (b[d] ?? 0));
  }
  return out;
}

/** How many of a per-buy-in bag fit into the available inventory? */
function countBuyInsAvailable(
  available: ChipInventory,
  perBuyIn: Partial<Record<Denomination, number>>,
): number {
  let min = Infinity;
  let any = false;
  for (const dStr of Object.keys(perBuyIn)) {
    const d = Number(dStr) as Denomination;
    const need = perBuyIn[d] ?? 0;
    if (need <= 0) continue;
    any = true;
    const fits = Math.floor((available[d] ?? 0) / need);
    if (fits < min) min = fits;
  }
  return any && Number.isFinite(min) ? min : 0;
}

export function planEvening(input: EveningPlanInput): EveningPlan {
  const out: EveningPlan = { tournament: null, cash: null, conflicts: [] };

  // ── Tournament reservation ──────────────────────────────────────────────
  let postReservation: ChipInventory = { ...input.inventory };
  if (input.tournament && input.tournament.players > 0 && input.tournament.startingStack > 0) {
    const sug = suggestStartingStack(
      input.inventory,
      input.tournament.players,
      input.tournament.startingStack,
    );
    // Active = total − busted. Busted players' stacks are back in the dealer's
    // hands. We always reserve based on ACTIVE count so capacity rises as
    // people bust out and float chips back.
    const busted = Math.max(0, Math.min(input.tournament.busted ?? 0, input.tournament.players));
    const active = Math.max(0, input.tournament.players - busted);
    const reserved: Partial<Record<Denomination, number>> = {};
    for (const dStr of Object.keys(sug.perPlayer)) {
      const d = Number(dStr) as Denomination;
      const perP = sug.perPlayer[d] ?? 0;
      if (perP > 0) reserved[d] = perP * active;
    }
    out.tournament = {
      perPlayer: sug.perPlayer,
      perPlayerActualValue: sug.actualTotal,
      perPlayerTargetValue: sug.targetTotal,
      activePlayers: active,
      reserved,
      warnings: sug.warnings,
    };
    postReservation = subtractInventory(input.inventory, reserved);
  }

  // ── Cash bag from remainder ─────────────────────────────────────────────
  if (input.cash && input.cash.buyIn > 0 && input.cash.smallBlind > 0) {
    // suggestCashStack normalises by `players`, but for *one* buy-in bag we
    // pass players=1 so it's the absolute chips we want per seat.
    const sug = suggestCashStack(
      postReservation,
      1,
      input.cash.buyIn,
      input.cash.smallBlind,
    );
    const buyInsAvailable = countBuyInsAvailable(postReservation, sug.perPlayer);
    out.cash = {
      perBuyIn: sug.perPlayer,
      perBuyInActualValue: sug.actualTotal,
      perBuyInTargetValue: sug.targetTotal,
      buyInsAvailable,
      remaining: postReservation,
      warnings: sug.warnings,
    };
  }

  // ── Over-commitment conflicts (tournament + 1 cash buy-in vs inventory) ─
  if (out.tournament && out.cash) {
    for (const d of DENOMINATIONS) {
      const need = (out.tournament.reserved[d] ?? 0) + (out.cash.perBuyIn[d] ?? 0);
      const have = input.inventory[d] ?? 0;
      if (need > have) {
        out.conflicts.push({ denom: d, short: need - have });
      }
    }
  }

  return out;
}
