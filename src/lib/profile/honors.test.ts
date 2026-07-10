import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHonors } from "./honors";
import { HandCategory } from "../poker/evaluator";
import type { GlobalPlayerStats } from "../repo";

function stats(over: Partial<GlobalPlayerStats> = {}): GlobalPlayerStats {
  return {
    handsPlayed: 0, handsWon: 0, tablesPlayed: 0, biggestWin: 0,
    biggestPot: 0, buyInCount: 0, totalBought: 0, netLifetime: 0, bestHandRank: null,
    ...over,
  };
}
const labels = (s: GlobalPlayerStats) => deriveHonors(s).map((h) => h.label);

test("a brand-new player has no honors", () => {
  assert.deepEqual(deriveHonors(stats()), []);
});

test("win-count badges are tiered (highest applicable only)", () => {
  assert.ok(labels(stats({ handsWon: 10 })).includes("ده برد"));
  assert.ok(labels(stats({ handsWon: 25 })).includes("بیست‌وپنج برد"));
  assert.ok(labels(stats({ handsWon: 100 })).includes("صد برد"));
  // 100 wins should not also carry the lower tiers
  const l = labels(stats({ handsWon: 100 }));
  assert.ok(!l.includes("ده برد") && !l.includes("بیست‌وپنج برد"));
});

test("threshold badges fire at their limits", () => {
  assert.ok(labels(stats({ tablesPlayed: 5 })).includes("میزگرد"));
  assert.ok(labels(stats({ biggestPot: 5000 })).includes("پات بزرگ"));
  assert.ok(labels(stats({ netLifetime: 1 })).includes("سودده"));
  assert.ok(!labels(stats({ netLifetime: 0 })).includes("سودده"));
  assert.ok(labels(stats({ handsPlayed: 50, handsWon: 20 })).includes("داغ"), "40% win rate over 50 hands");
  assert.ok(!labels(stats({ handsPlayed: 50, handsWon: 10 })).includes("داغ"), "20% win rate is not hot");
});

test("rare-hand badge keys off the HandCategory enum", () => {
  assert.ok(!labels(stats({ bestHandRank: HandCategory.FullHouse })).includes("دست نادر"));
  assert.ok(labels(stats({ bestHandRank: HandCategory.FourOfAKind })).includes("دست نادر"));
  assert.ok(labels(stats({ bestHandRank: HandCategory.StraightFlush })).includes("دست نادر"));
});
