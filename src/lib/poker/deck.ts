/**
 * Cryptographically secure, seed-derived deck + shuffle (provable fairness).
 *
 * Anti-cheat cornerstone: the deck lives only on the server and is shuffled
 * with an unbiased Fisher–Yates whose randomness is derived *deterministically*
 * from a secret 32-byte seed via an HMAC-SHA256 counter DRBG. Before the hand
 * the server publishes `commitment = SHA256(seed)`; after the hand it reveals
 * `seed`. Anyone can then re-run `shuffleFromSeed(seed)` and confirm the deck
 * order — the server cannot have altered the cards after committing.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { fullDeck, type Card } from "./cards";

export interface ShuffledDeck {
  cards: Card[];
  /** Hex seed used for this shuffle (reveal after the hand for auditing). */
  seed: string;
  /** SHA-256 of the seed, published before the hand starts (commitment). */
  commitment: string;
  cursor: number;
}

/** Deterministic byte stream: HMAC-SHA256(seed, counter) blocks. */
function createDrbg(seedHex: string) {
  const seed = Buffer.from(seedHex, "hex");
  let counter = 0;
  let buf = Buffer.alloc(0);
  let offset = 0;

  function refill() {
    const ctr = Buffer.alloc(4);
    ctr.writeUInt32BE(counter++, 0);
    buf = createHmac("sha256", seed).update(ctr).digest();
    offset = 0;
  }

  return {
    /** Unbiased integer in [0, max) via rejection sampling over 32-bit draws. */
    nextInt(max: number): number {
      if (max <= 1) return 0;
      const limit = Math.floor(0x100000000 / max) * max;
      for (;;) {
        if (offset + 4 > buf.length) refill();
        const v = buf.readUInt32BE(offset);
        offset += 4;
        if (v < limit) return v % max;
      }
    },
  };
}

/** Reproduce a deck order from a revealed seed (used for auditing). */
export function shuffleFromSeed(seedHex: string): Card[] {
  const rng = createDrbg(seedHex);
  const cards = fullDeck();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

export function createShuffledDeck(): ShuffledDeck {
  const seed = randomBytes(32).toString("hex");
  const commitment = createHash("sha256").update(seed).digest("hex");
  return { cards: shuffleFromSeed(seed), seed, commitment, cursor: 0 };
}

/** Verify that a revealed (seed, commitment, cards) triple is consistent. */
export function verifyDeck(seedHex: string, commitment: string, cards: Card[]): boolean {
  if (createHash("sha256").update(seedHex).digest("hex") !== commitment) return false;
  const expected = shuffleFromSeed(seedHex);
  return expected.length === cards.length && expected.every((c, i) => c === cards[i]);
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
