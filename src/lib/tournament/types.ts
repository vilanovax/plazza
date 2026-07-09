/** Tournament (single-table Sit & Go) shared types + defaults. */

export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  minutes: number;
  /** A scheduled break: play pauses, blinds are held (sb/bb/ante = 0 here). */
  isBreak?: boolean;
}

export interface TournamentConfig {
  /** Whether busted players may re-buy during the rebuy period. */
  rebuyAllowed: boolean;
  /** Max rebuys per player (-1 = unlimited). */
  rebuyMaxCount: number;
  /** Rebuys are allowed up to and including this blind level. */
  rebuyThroughLevel: number;
  /** Prize split percentages for the top N places (must sum to 100). */
  payouts: number[];
  /** New players may still join a running tournament up to and including this
   *  blind level (0 = no late registration). */
  lateRegThroughLevel?: number;
  /** Insert a break after every N blind levels (0 = no breaks). */
  breakEveryLevels?: number;
  /** Length of each break, in minutes. */
  breakMinutes?: number;
}

/** Default prize splits by number of paid places. */
export const PAYOUT_PRESETS: Record<string, number[]> = {
  "winner-takes-all": [100],
  "70-30": [70, 30],
  "60-40": [60, 40],
  "50-30-20": [50, 30, 20],
  "40-30-20-10": [40, 30, 20, 10],
};

/** Choose a sensible default payout for a given field size. */
export function defaultPayouts(players: number): number[] {
  if (players <= 3) return [100];
  if (players <= 6) return [70, 30];
  return [50, 30, 20];
}

/**
 * Generate an escalating blind schedule. When breakEvery > 0, a break entry is
 * inserted after every `breakEvery` play levels (never trailing). `level` is the
 * 1-based position in the returned array, so it stays a valid index for the
 * runtime's current_level pointer even with breaks interleaved.
 */
export function defaultBlindSchedule(
  startBb = 20,
  levels = 15,
  minutes = 10,
  breakEvery = 0,
  breakMinutes = 5
): BlindLevel[] {
  const schedule: BlindLevel[] = [];
  let bb = startBb;
  let pos = 0;
  for (let play = 1; play <= levels; play++) {
    schedule.push({ level: ++pos, sb: Math.max(1, Math.floor(bb / 2)), bb, ante: play >= 4 ? Math.floor(bb / 8) : 0, minutes });
    // Roughly 1.5x each level, rounded to a "nice" number.
    bb = niceRound(bb * 1.5);
    if (breakEvery > 0 && play % breakEvery === 0 && play < levels) {
      schedule.push({ level: ++pos, sb: 0, bb: 0, ante: 0, minutes: breakMinutes, isBreak: true });
    }
  }
  return schedule;
}

/**
 * The playable blind level at a given schedule position — breaks don't count.
 * `current` is the 1-based array index (which includes break entries); this maps
 * it to the number an admin/player thinks of (e.g. "level 4"), so break-inclusive
 * numbering never shifts rebuy/late-reg thresholds or the displayed level.
 */
export function playableLevel(schedule: BlindLevel[], current: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(current, schedule.length); i++) {
    if (!schedule[i]?.isBreak) n++;
  }
  return n;
}

function niceRound(n: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.max(2, Math.round(n / mag) * mag);
}

export function validatePayouts(payouts: number[]): boolean {
  if (payouts.length === 0) return false;
  // Every share must be a finite, non-negative number.
  if (payouts.some((p) => !Number.isFinite(p) || p < 0)) return false;
  // First place must actually pay something, and shares must be non-increasing
  // (rank N can never earn more than rank N-1).
  if (payouts[0] <= 0) return false;
  for (let i = 1; i < payouts.length; i++) {
    if (payouts[i] > payouts[i - 1]) return false;
  }
  return payouts.reduce((a, b) => a + b, 0) === 100;
}
