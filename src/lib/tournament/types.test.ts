import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePayouts,
  defaultPayouts,
  defaultBlindSchedule,
  playableLevel,
  PAYOUT_PRESETS,
} from "./types";

test("validatePayouts accepts a valid non-increasing split summing to 100", () => {
  assert.equal(validatePayouts([100]), true);
  assert.equal(validatePayouts([70, 30]), true);
  assert.equal(validatePayouts([50, 30, 20]), true);
});

test("validatePayouts rejects bad splits", () => {
  assert.equal(validatePayouts([]), false, "empty");
  assert.equal(validatePayouts([60, 30]), false, "sum != 100");
  assert.equal(validatePayouts([0, 100]), false, "first place pays nothing");
  assert.equal(validatePayouts([30, 70]), false, "increasing");
  assert.equal(validatePayouts([50, -10, 60]), false, "negative share");
  assert.equal(validatePayouts([NaN, 100]), false, "non-finite");
});

test("every named payout preset is itself valid", () => {
  for (const [name, split] of Object.entries(PAYOUT_PRESETS)) {
    assert.equal(validatePayouts(split), true, `preset ${name} should be valid`);
  }
});

test("defaultPayouts scales with field size and is always valid", () => {
  for (const n of [2, 3, 6, 9]) assert.equal(validatePayouts(defaultPayouts(n)), true);
});

test("defaultBlindSchedule escalates and never has a trailing break", () => {
  const s = defaultBlindSchedule(20, 6, 10);
  assert.equal(s.length, 6);
  assert.ok(s[1].bb >= s[0].bb, "blinds non-decreasing");
  assert.ok(!s[s.length - 1].isBreak, "no trailing break when breaks are off");
  // level numbers are the 1-based array position
  assert.deepEqual(s.map((l) => l.level), [1, 2, 3, 4, 5, 6]);
});

test("defaultBlindSchedule inserts breaks after every N play levels, never trailing", () => {
  const s = defaultBlindSchedule(20, 6, 10, 2, 5);
  const breaks = s.filter((l) => l.isBreak);
  assert.equal(breaks.length, 2, "break after level 2 and level 4 (not after last)");
  assert.ok(!s[s.length - 1].isBreak, "last entry is a play level");
  // sequential level numbering across breaks
  assert.deepEqual(s.map((l) => l.level), s.map((_, i) => i + 1));
  // break entries hold zero blinds
  for (const b of breaks) assert.equal(b.sb + b.bb + b.ante, 0);
});

test("playableLevel counts non-break entries up to the current position", () => {
  const s = defaultBlindSchedule(20, 6, 10, 2, 5); // L1,L2,BREAK,L3,L4,BREAK,L5,L6
  assert.equal(playableLevel(s, 1), 1, "at level 1");
  assert.equal(playableLevel(s, 2), 2, "at level 2");
  assert.equal(playableLevel(s, 3), 2, "on the break after level 2 -> still 2 playable");
  assert.equal(playableLevel(s, 4), 3, "next play level -> 3");
  assert.equal(playableLevel(s, s.length), 6, "all 6 play levels counted");
});
