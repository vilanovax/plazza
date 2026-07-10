import assert from "node:assert/strict";
import test from "node:test";
import { breakDownChips, chipsForDisplay, chipsOverflow } from "./chipDenominations";

test("breakDownChips uses greedy largest-first denominations", () => {
  assert.deepEqual(breakDownChips(337), [
    { value: 100, count: 3 },
    { value: 25, count: 1 },
  ]);
  assert.deepEqual(breakDownChips(575), [
    { value: 500, count: 1 },
    { value: 50, count: 1 },
    { value: 25, count: 1 },
  ]);
});

test("breakDownChips handles blinds", () => {
  assert.deepEqual(breakDownChips(25), [{ value: 25, count: 1 }]);
  assert.deepEqual(breakDownChips(50), [{ value: 50, count: 1 }]);
});

test("chipsForDisplay caps visible chips", () => {
  assert.equal(chipsForDisplay(1275, 5).length, 5);
  assert.equal(chipsOverflow(1275, 5), 1);
  assert.equal(chipsOverflow(2750, 4), 4);
});
