import type { BlindLevel } from '@/types/db';

export interface BlindTemplate {
  id: string;
  name: string;
  description: string;
  /** Recommended starting stack for this template. */
  recommendedStack: number;
  levels: BlindLevel[];
}

/**
 * Tournament blind structure templates tuned for the user's chip set
 * (smallest meaningful chip is T1, smallest practical is T25).
 *
 * - **Quickfire**: ~2.5h all-in fest for a school night.
 * - **Standard**: ~4h home tournament — the default.
 * - **Deep stack**: ~5h, slower play, big stacks.
 */
const std = (level: number, sb: number, bb: number, durationMin = 20, ante = 0, breakAfter = false, breakMin = 10): BlindLevel => ({
  level, sb, bb, ante, durationMin, breakAfter, breakMin,
});

export const BLIND_TEMPLATES: BlindTemplate[] = [
  {
    id: 'home-night',
    name: 'Home Night',
    description: '~2 hours · 12 min levels · for a normal evening with friends',
    recommendedStack: 5000,
    levels: [
      std(1, 25, 50, 12),
      std(2, 50, 100, 12),
      std(3, 75, 150, 12),
      std(4, 100, 200, 12, 0, true, 8),
      std(5, 150, 300, 12),
      std(6, 200, 400, 12, 50),
      std(7, 300, 600, 12, 100),
      std(8, 500, 1000, 12, 100),
      std(9, 800, 1600, 12, 200),
      std(10, 1500, 3000, 12, 300),
      std(11, 2500, 5000, 12, 500),
    ],
  },
  {
    id: 'quickfire',
    name: 'Quickfire',
    description: '~2.5 hours · 12 min levels · perfect for a Tuesday',
    recommendedStack: 5000,
    levels: [
      std(1, 25, 50, 12),
      std(2, 50, 100, 12),
      std(3, 75, 150, 12),
      std(4, 100, 200, 12),
      std(5, 150, 300, 12, 0, true, 10),
      std(6, 200, 400, 12),
      std(7, 300, 600, 12),
      std(8, 500, 1000, 12, 100),
      std(9, 700, 1400, 12, 100, true, 10),
      std(10, 1000, 2000, 12, 200),
      std(11, 1500, 3000, 12, 300),
      std(12, 2500, 5000, 12, 500),
      std(13, 4000, 8000, 12, 1000),
      std(14, 6000, 12000, 12, 2000),
      std(15, 10000, 20000, 12, 3000),
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    description: '~4 hours · 20 min levels · the home-game default',
    recommendedStack: 10000,
    levels: [
      std(1, 25, 50, 20),
      std(2, 50, 100, 20),
      std(3, 75, 150, 20),
      std(4, 100, 200, 20),
      std(5, 150, 300, 20, 0, true, 10),
      std(6, 200, 400, 20),
      std(7, 300, 600, 20, 50),
      std(8, 400, 800, 20, 100),
      std(9, 500, 1000, 20, 100, true, 10),
      std(10, 700, 1400, 20, 200),
      std(11, 1000, 2000, 20, 300),
      std(12, 1500, 3000, 20, 400),
      std(13, 2000, 4000, 20, 500, true, 10),
      std(14, 3000, 6000, 20, 1000),
      std(15, 5000, 10000, 20, 1000),
      std(16, 7500, 15000, 20, 2000),
      std(17, 10000, 20000, 20, 3000),
      std(18, 15000, 30000, 20, 5000),
    ],
  },
  {
    id: 'deepstack',
    name: 'Deep Stack',
    description: '~5 hours · 25 min levels · for the patient',
    recommendedStack: 25000,
    levels: [
      std(1, 25, 50, 25),
      std(2, 50, 100, 25),
      std(3, 75, 150, 25),
      std(4, 100, 200, 25),
      std(5, 150, 300, 25, 0, true, 15),
      std(6, 200, 400, 25),
      std(7, 250, 500, 25),
      std(8, 300, 600, 25, 50),
      std(9, 400, 800, 25, 100),
      std(10, 500, 1000, 25, 100, true, 15),
      std(11, 700, 1400, 25, 200),
      std(12, 1000, 2000, 25, 300),
      std(13, 1500, 3000, 25, 400),
      std(14, 2000, 4000, 25, 500, true, 10),
      std(15, 3000, 6000, 25, 1000),
      std(16, 5000, 10000, 25, 1000),
      std(17, 7500, 15000, 25, 2000),
      std(18, 10000, 20000, 25, 3000),
      std(19, 15000, 30000, 25, 5000),
      std(20, 25000, 50000, 25, 5000),
    ],
  },
];

export function templateById(id: string): BlindTemplate {
  return BLIND_TEMPLATES.find((t) => t.id === id) ?? BLIND_TEMPLATES[0];
}

/** Sum of every level's duration plus break time, in minutes. */
export function totalDurationMin(t: BlindTemplate): number {
  return t.levels.reduce(
    (s, l) => s + l.durationMin + (l.breakAfter ? (l.breakMin ?? 10) : 0),
    0,
  );
}

/** Pick a sensible default template for a given player count.
 *  Smaller fields finish faster, so we don't need a deep-stack marathon. */
export function recommendedTemplateId(players: number): string {
  if (players <= 6) return 'home-night';
  if (players <= 10) return 'standard';
  return 'deepstack';
}

/** "21:48" formatted finish time given start = now and template duration. */
export function estimatedFinishTime(t: BlindTemplate, from: Date = new Date()): string {
  const finish = new Date(from.getTime() + totalDurationMin(t) * 60_000);
  return finish.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}
