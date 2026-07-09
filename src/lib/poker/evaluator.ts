/**
 * 5-to-7 card poker hand evaluator for Texas Hold'em.
 *
 * evaluate() returns a single comparable integer `score` (higher is better)
 * plus a human-readable category. The score packs the hand category and up to
 * five tie-break ranks into one number so two hands can be compared with `>`.
 */
import { rankOf, suitOf, type Card } from "./cards";

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES_FA: Record<HandCategory, string> = {
  [HandCategory.HighCard]: "کارت بالا",
  [HandCategory.OnePair]: "یک جفت",
  [HandCategory.TwoPair]: "دو جفت",
  [HandCategory.ThreeOfAKind]: "سه‌تایی",
  [HandCategory.Straight]: "استریت",
  [HandCategory.Flush]: "فلاش",
  [HandCategory.FullHouse]: "فول‌هاوس",
  [HandCategory.FourOfAKind]: "کاره",
  [HandCategory.StraightFlush]: "استریت فلاش",
};

export interface HandRank {
  score: number;
  category: HandCategory;
}

// 4 bits per tie-break slot (rank 0..12 fits in 0..15).
function encode(category: HandCategory, tiebreaks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (tiebreaks[i] ?? 0);
  }
  return score;
}

/** Highest card of the best straight in a 13-bit rank mask, or -1. */
function bestStraightHigh(rankMask: number): number {
  const mask = rankMask & 0x1fff;
  // Slide a window of 5 consecutive ranks from the top (high = the top card).
  for (let high = 12; high >= 4; high--) {
    const window = 0b11111 << (high - 4);
    if ((mask & window) === window) return high;
  }
  // Wheel A-2-3-4-5: bits for A(12),5(3),4(2),3(1),2(0); straight is "to the 5".
  if ((mask & ((1 << 12) | 0b1111)) === ((1 << 12) | 0b1111)) return 3;
  return -1;
}

export function evaluate(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error("Need at least 5 cards to evaluate");

  const rankCounts = new Array(13).fill(0);
  const suitCards: number[][] = [[], [], [], []]; // ranks present per suit
  let rankMask = 0;

  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCounts[r]++;
    rankMask |= 1 << r;
    suitCards[s].push(r);
  }

  // --- Flush / straight flush ---
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCards[s].length >= 5) flushSuit = s;
  }

  if (flushSuit >= 0) {
    let suitMask = 0;
    for (const r of suitCards[flushSuit]) suitMask |= 1 << r;
    const sfHigh = bestStraightHigh(suitMask);
    if (sfHigh >= 0) {
      return { category: HandCategory.StraightFlush, score: encode(HandCategory.StraightFlush, [sfHigh]) };
    }
  }

  // --- Group ranks by count for pairs/trips/quads ---
  // grouped: array of [rank, count] sorted by count desc then rank desc.
  const grouped: Array<[number, number]> = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCounts[r] > 0) grouped.push([r, rankCounts[r]]);
  }
  grouped.sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const quad = grouped.find(([, n]) => n === 4);
  if (quad) {
    // Kicker is the highest remaining card by RANK (not by group size — a lower
    // pair must not outrank a higher single).
    const kicker = Math.max(...grouped.filter(([r]) => r !== quad[0]).map(([r]) => r));
    return { category: HandCategory.FourOfAKind, score: encode(HandCategory.FourOfAKind, [quad[0], kicker]) };
  }

  const trips = grouped.filter(([, n]) => n === 3);
  const pairs = grouped.filter(([, n]) => n === 2);
  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const tripRank = trips[0][0];
    const pairRank = trips.length >= 2 ? trips[1][0] : pairs[0][0];
    return { category: HandCategory.FullHouse, score: encode(HandCategory.FullHouse, [tripRank, pairRank]) };
  }

  if (flushSuit >= 0) {
    const top5 = suitCards[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return { category: HandCategory.Flush, score: encode(HandCategory.Flush, top5) };
  }

  const straightHigh = bestStraightHigh(rankMask);
  if (straightHigh >= 0) {
    return { category: HandCategory.Straight, score: encode(HandCategory.Straight, [straightHigh]) };
  }

  if (trips.length >= 1) {
    const tripRank = trips[0][0];
    const kickers = grouped.filter(([r]) => r !== tripRank).map(([r]) => r).slice(0, 2);
    return { category: HandCategory.ThreeOfAKind, score: encode(HandCategory.ThreeOfAKind, [tripRank, ...kickers]) };
  }

  if (pairs.length >= 2) {
    const [p1, p2] = [pairs[0][0], pairs[1][0]];
    // Highest remaining card by RANK — with a third pair present, one of its
    // cards (or a single) can be the kicker, whichever rank is highest.
    const kicker = Math.max(...grouped.filter(([r]) => r !== p1 && r !== p2).map(([r]) => r));
    return { category: HandCategory.TwoPair, score: encode(HandCategory.TwoPair, [p1, p2, kicker]) };
  }

  if (pairs.length === 1) {
    const pairRank = pairs[0][0];
    const kickers = grouped.filter(([r]) => r !== pairRank).map(([r]) => r).slice(0, 3);
    return { category: HandCategory.OnePair, score: encode(HandCategory.OnePair, [pairRank, ...kickers]) };
  }

  const highCards = grouped.map(([r]) => r).slice(0, 5);
  return { category: HandCategory.HighCard, score: encode(HandCategory.HighCard, highCards) };
}

/** Compare two players' 7-card holdings. >0 if a wins, <0 if b wins, 0 tie. */
export function compareHands(a: Card[], b: Card[]): number {
  return evaluate(a).score - evaluate(b).score;
}
