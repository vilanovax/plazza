import assert from "node:assert/strict";
import test from "node:test";
import { splitChipsProportionally } from "./chipSplit";

function sumMap(m: Map<string, number>) {
  return [...m.values()].reduce((a, b) => a + b, 0);
}

test("splitChipsProportionally preserves total", () => {
  const m = splitChipsProportionally(1000, [
    { id: "a", weight: 3000 },
    { id: "b", weight: 2000 },
    { id: "c", weight: 1000 },
  ]);
  assert.equal(sumMap(m), 1000);
  assert.equal(m.get("a"), 500);
  assert.equal(m.get("b"), 333);
  assert.equal(m.get("c"), 167);
});

test("splitChipsProportionally splits equally when weights are zero", () => {
  const m = splitChipsProportionally(10, [
    { id: "a", weight: 0 },
    { id: "b", weight: 0 },
  ]);
  assert.equal(sumMap(m), 10);
  assert.equal(m.get("a"), 5);
  assert.equal(m.get("b"), 5);
});

test("splitChipsProportionally handles single recipient", () => {
  const m = splitChipsProportionally(42, [{ id: "solo", weight: 100 }]);
  assert.equal(m.get("solo"), 42);
});
