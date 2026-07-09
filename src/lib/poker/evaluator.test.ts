import { test } from "node:test";
import assert from "node:assert/strict";
import { stringToCard } from "./cards";
import { evaluate, compareHands, HandCategory } from "./evaluator";

const H = (s: string) => s.trim().split(/\s+/).map(stringToCard);

test("categorises a royal/straight flush", () => {
  assert.equal(evaluate(H("As Ks Qs Js Ts 2c 3d")).category, HandCategory.StraightFlush);
});

test("wheel straight flush (A-5)", () => {
  assert.equal(evaluate(H("As 2s 3s 4s 5s 9d Kc")).category, HandCategory.StraightFlush);
});

test("four of a kind beats full house", () => {
  const quads = H("9s 9d 9c 9h Kd 2c 3s");
  const boat = H("Ks Kd Kc Qh Qd 2c 3s");
  assert.equal(evaluate(quads).category, HandCategory.FourOfAKind);
  assert.equal(evaluate(boat).category, HandCategory.FullHouse);
  assert.ok(compareHands(quads, boat) > 0);
});

test("flush beats straight", () => {
  const flush = H("2h 5h 8h Jh Kh 3c 4d");
  const straight = H("5c 6d 7h 8s 9c 2d Kh");
  assert.equal(evaluate(flush).category, HandCategory.Flush);
  assert.equal(evaluate(straight).category, HandCategory.Straight);
  assert.ok(compareHands(flush, straight) > 0);
});

test("wheel straight recognised (A-2-3-4-5)", () => {
  assert.equal(evaluate(H("Ad 2c 3h 4s 5d Kc Qh")).category, HandCategory.Straight);
});

test("higher two pair wins on kicker", () => {
  const a = H("As Ad Ks Kd 9c 2h 3s"); // aces & kings, 9 kicker
  const b = H("As Ad Ks Kd 8c 2h 3s"); // aces & kings, 8 kicker
  assert.ok(compareHands(a, b) > 0);
});

test("best 5 of 7 chooses the top straight", () => {
  const eightHigh = evaluate(H("4c 5d 6h 7s 8c 2h Kd")); // 4-8 straight
  const nineHigh = evaluate(H("5d 6h 7s 8c 9d 2h 3c")); // 5-9 straight
  assert.equal(eightHigh.category, HandCategory.Straight);
  assert.equal(nineHigh.category, HandCategory.Straight);
  assert.ok(nineHigh.score > eightHigh.score);
});

test("two-pair kicker is the highest remaining card even with a third pair", () => {
  // Q Q 7 7 5 5 6  -> two pair Q&7, kicker 6 (NOT the third pair's 5)
  const withThirdPair = evaluate(H("Qs Qc 7h 7d 5c 5s 6d"));
  const plainSix = evaluate(H("Qh Qd 7s 7c 6h 3c 2d")); // Q Q 7 7 kicker 6
  assert.equal(withThirdPair.score, plainSix.score);
});

test("quads kicker is the highest single, not a lower pair", () => {
  // 2 2 2 2 K 3 3 -> quad 2s, kicker K (NOT the pair of 3s)
  const withPair = evaluate(H("2s 2c 2h 2d Kd 3c 3s"));
  const plainK = evaluate(H("2s 2c 2h 2d Kd 9c 4s")); // quad 2s kicker K
  assert.equal(withPair.score, plainK.score);
});

test("identical hands tie", () => {
  assert.equal(compareHands(H("As Ks Qh Jd Tc 2s 3d"), H("Ad Kd Qc Js Th 2c 4d")), 0);
});
