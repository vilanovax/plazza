import { test } from "node:test";
import assert from "node:assert/strict";
import { createShuffledDeck, shuffleFromSeed, verifyDeck } from "./deck";

test("shuffle is deterministic from its seed (provable fairness)", () => {
  const deck = createShuffledDeck();
  // Re-deriving from the revealed seed reproduces the exact order.
  const reproduced = shuffleFromSeed(deck.seed);
  assert.deepEqual(reproduced, deck.cards);
  assert.ok(verifyDeck(deck.seed, deck.commitment, deck.cards));
});

test("a tampered deck fails verification", () => {
  const deck = createShuffledDeck();
  const tampered = [...deck.cards];
  [tampered[0], tampered[1]] = [tampered[1], tampered[0]];
  assert.equal(verifyDeck(deck.seed, deck.commitment, tampered), false);
});

test("deck contains all 52 distinct cards", () => {
  const deck = createShuffledDeck();
  assert.equal(new Set(deck.cards).size, 52);
});
