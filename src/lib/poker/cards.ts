/**
 * Card primitives.
 *
 * A card is encoded as a 0..51 integer for compactness and fast evaluation:
 *   rank = card >> 2   (0 = Two .. 12 = Ace)
 *   suit = card & 3    (0=clubs, 1=diamonds, 2=hearts, 3=spades)
 */

export type Card = number; // 0..51

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;
export const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"] as const;

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function makeCard(rank: number, suit: number): Card {
  return (rank << 2) | suit;
}

/** Human/serialisable string like "As", "Td", "2c". */
export function cardToString(card: Card): string {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

export function cardToUnicode(card: Card): string {
  return RANKS[rankOf(card)] + SUIT_SYMBOLS[suitOf(card)];
}

export function stringToCard(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase() as (typeof RANKS)[number]);
  const suit = SUITS.indexOf(s[1].toLowerCase() as (typeof SUITS)[number]);
  if (r < 0 || suit < 0) throw new Error(`Invalid card string: ${s}`);
  return makeCard(r, suit);
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  return deck;
}
