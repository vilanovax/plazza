/**
 * Differential fuzz test: cross-check our evaluator's *winner determination*
 * against the independent `pokersolver` library over many random showdowns.
 * If both libraries always pick the same winner(s), we're confident the
 * evaluator + tie handling are correct across the whole hand space.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fullDeck, cardToString, type Card } from "./cards";
import { evaluate } from "./evaluator";

const require = createRequire(import.meta.url);
let Hand: { solve: (cards: string[]) => unknown; winners: (hands: unknown[]) => unknown[] } | null = null;
try {
  Hand = require("pokersolver").Hand;
} catch {
  Hand = null; // dev dependency not installed — skip gracefully
}

function shuffle(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

test("evaluator agrees with pokersolver on the winner across random showdowns", { skip: !Hand }, () => {
  const solver = Hand!;
  const ITER = 8000;
  for (let n = 0; n < ITER; n++) {
    const deck = shuffle(fullDeck());
    const players = 2 + Math.floor(Math.random() * 5); // 2..6
    const community = deck.slice(0, 5);
    const holes: Card[][] = [];
    for (let p = 0; p < players; p++) holes.push(deck.slice(5 + p * 2, 7 + p * 2));

    // Our winners: indices sharing the max score.
    const scores = holes.map((h) => evaluate([...h, ...community]).score);
    const max = Math.max(...scores);
    const mine = scores.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b);

    // pokersolver winners mapped back to player indices.
    const solved = holes.map((h, i) => {
      const hand = solver.solve([...h, ...community].map(cardToString)) as { _i?: number };
      hand._i = i;
      return hand;
    });
    const theirs = (solver.winners(solved) as { _i: number }[]).map((w) => w._i).sort((a, b) => a - b);

    assert.deepEqual(
      mine,
      theirs,
      `mismatch #${n}: board=${community.map(cardToString).join(" ")} ` +
        holes.map((h, i) => `p${i}=${h.map(cardToString).join("")}`).join(" ")
    );
  }
});
