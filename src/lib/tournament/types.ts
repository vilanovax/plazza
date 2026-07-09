/** Tournament (single-table Sit & Go) shared types + defaults. */

export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  minutes: number;
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

/** Generate an escalating blind schedule. */
export function defaultBlindSchedule(startBb = 20, levels = 15, minutes = 10): BlindLevel[] {
  const schedule: BlindLevel[] = [];
  let bb = startBb;
  for (let level = 1; level <= levels; level++) {
    schedule.push({ level, sb: Math.max(1, Math.floor(bb / 2)), bb, ante: level >= 4 ? Math.floor(bb / 8) : 0, minutes });
    // Roughly 1.5x each level, rounded to a "nice" number.
    bb = niceRound(bb * 1.5);
  }
  return schedule;
}

function niceRound(n: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.max(2, Math.round(n / mag) * mag);
}

export function validatePayouts(payouts: number[]): boolean {
  if (payouts.length === 0) return false;
  if (payouts.some((p) => p < 0)) return false;
  return payouts.reduce((a, b) => a + b, 0) === 100;
}
