import type { PayoutSlot } from '@/types/db';

/**
 * Payout structure presets — chosen so that the prize pool always sums to 100%.
 * The right structure depends on field size; we offer presets and a custom edit.
 */
export interface PayoutPreset {
  id: string;
  label: string;
  /** Pick the structure based on player count. */
  pick: (players: number) => PayoutSlot[];
}

const winnerTakeAll: PayoutSlot[] = [{ place: 1, percent: 100 }];

export const PAYOUT_PRESETS: PayoutPreset[] = [
  {
    id: 'winner-takes-all',
    label: 'Winner takes all',
    pick: () => winnerTakeAll,
  },
  {
    id: 'standard',
    label: 'Standard (top 30%)',
    pick: (players) => {
      if (players <= 4) return winnerTakeAll;
      if (players <= 6) return [
        { place: 1, percent: 70 },
        { place: 2, percent: 30 },
      ];
      if (players <= 9) return [
        { place: 1, percent: 50 },
        { place: 2, percent: 30 },
        { place: 3, percent: 20 },
      ];
      if (players <= 14) return [
        { place: 1, percent: 45 },
        { place: 2, percent: 27 },
        { place: 3, percent: 17 },
        { place: 4, percent: 11 },
      ];
      return [
        { place: 1, percent: 40 },
        { place: 2, percent: 24 },
        { place: 3, percent: 16 },
        { place: 4, percent: 12 },
        { place: 5, percent: 8 },
      ];
    },
  },
  {
    id: 'flat',
    label: 'Flat (top 50%)',
    pick: (players) => {
      const paid = Math.max(2, Math.floor(players / 2));
      const percents = Array.from({ length: paid }, (_, i) => paid - i);
      const total = percents.reduce((s, n) => s + n, 0);
      return percents.map((w, i) => ({
        place: i + 1,
        percent: Math.round((w / total) * 1000) / 10,
      }));
    },
  },
];

export function presetById(id: string): PayoutPreset {
  return PAYOUT_PRESETS.find((p) => p.id === id) ?? PAYOUT_PRESETS[1];
}

/**
 * Compute the prize pool from a tournament's player aggregates.
 * Excludes bounties (paid per knockout), any rake / dealer tip taken off
 * the top, and the per-entry season carve (deferred to the season pot).
 */
export function calculatePrizePool(args: {
  buyIn: number;
  rebuyAmount: number;
  addonAmount: number;
  bountyAmount: number;
  buyIns: number;
  rebuys: number;
  addons: number;
  rakePercent?: number;
  dealerTipPercent?: number;
  /** Per-entry carve diverted to the season pot. Subtracted from buy-in,
   *  rebuy and addon equally before the gross pool is computed. */
  seasonCarve?: number;
}): number {
  const carve = Number(args.seasonCarve ?? 0);
  const buyInPart = args.buyIns * Math.max(0, args.buyIn - args.bountyAmount - carve);
  const rebuyPart = args.rebuys * Math.max(0, args.rebuyAmount - args.bountyAmount - carve);
  const addonPart = args.addons * Math.max(0, args.addonAmount - carve);
  const gross = Math.max(0, buyInPart + rebuyPart + addonPart);
  const cuts = (Number(args.rakePercent ?? 0) + Number(args.dealerTipPercent ?? 0)) / 100;
  return Math.max(0, Math.round(gross * (1 - cuts)));
}

/** Total amount diverted to the season pot from this tournament's entries. */
export function calculateSeasonContribution(args: {
  buyIns: number;
  rebuys: number;
  addons: number;
  seasonCarve?: number;
}): number {
  const carve = Number(args.seasonCarve ?? 0);
  if (carve <= 0) return 0;
  return Math.max(0, Math.round((args.buyIns + args.rebuys + args.addons) * carve));
}

/** Standard season-points curve. Top 6 finishers earn points; others get 0.
 *  Hardcoded for now — make configurable per season later if needed. */
const SEASON_POINTS_CURVE = [10, 7, 5, 3, 2, 1];
export function seasonPointsForPlace(place: number | null | undefined): number {
  if (!place || place < 1) return 0;
  return SEASON_POINTS_CURVE[place - 1] ?? 0;
}

/** Compute prize per place from total pool + percent slots. */
export function distributePrizes(pool: number, structure: PayoutSlot[]): PayoutSlot[] {
  return structure.map((s) => ({ place: s.place, percent: Math.round((pool * s.percent) / 100) }));
}
