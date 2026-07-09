/**
 * Cryptographically secure deck + shuffle.
 *
 * Anti-cheat cornerstone: the deck lives only on the server and is shuffled
 * with a CSPRNG (node:crypto) using an unbiased Fisher–Yates. We also record
 * the RNG seed/commitment so a hand can be audited after the fact (provable
 * fairness): the server commits to a hashed seed before the hand and can
 * reveal it afterwards.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { fullDeck, type Card } from "./cards";

export interface ShuffledDeck {
  cards: Card[];
  /** Hex seed used for this shuffle (reveal after the hand for auditing). */
  seed: string;
  /** SHA-256 of the seed, published before the hand starts (commitment). */
  commitment: string;
  cursor: number;
}

export function createShuffledDeck(): ShuffledDeck {
  const seed = randomBytes(32).toString("hex");
  const commitment = createHash("sha256").update(seed).digest("hex");
  const cards = fullDeck();

  // Unbiased Fisher–Yates using rejection-sampled randomInt (crypto-backed).
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }

  return { cards, seed, commitment, cursor: 0 };
}

/** Deal the next card off the top of the deck. */
export function draw(deck: ShuffledDeck): Card {
  if (deck.cursor >= deck.cards.length) throw new Error("Deck exhausted");
  return deck.cards[deck.cursor++];
}

export function drawMany(deck: ShuffledDeck, n: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < n; i++) out.push(draw(deck));
  return out;
}
