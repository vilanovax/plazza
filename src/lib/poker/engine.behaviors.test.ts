import { test } from "node:test";
import assert from "node:assert/strict";
import { HoldemGame, InvalidActionError } from "./engine";
import type { TableConfig } from "./types";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return {
    name: "T", maxSeats: 6, smallBlind: 5, bigBlind: 10, ante: 0,
    rakePercent: 0, rakeCap: 0, noFlopNoDrop: true, minBuyIn: 0, maxBuyIn: 100000,
    thinkTimeSec: 30, allowTopUp: true, topUpMin: 0, topUpMax: 100000,
    tableDurationMin: 0, sitOutMaxMin: 5, extraTimeSec: 15, extraTimeRequests: -1,
    ...over,
  };
}

test("addChips is allowed between hands and rejected while a hand is live", () => {
  const g = new HoldemGame("t", cfg());
  g.sit(0, "a", "A", 1000);
  g.sit(1, "b", "B", 1000);
  g.addChips("a", 500); // no hand yet -> allowed
  assert.equal(g.seats[0].stack, 1500);

  g.startHand(); // a hand is now in progress
  assert.throws(() => g.addChips("a", 100), InvalidActionError, "no top-up mid-hand");
});

test("addChips rejects non-positive / non-finite amounts", () => {
  const g = new HoldemGame("t", cfg());
  g.sit(0, "a", "A", 1000);
  assert.throws(() => g.addChips("a", 0), InvalidActionError);
  assert.throws(() => g.addChips("a", -100), InvalidActionError);
  assert.throws(() => g.addChips("a", Number.NaN), InvalidActionError);
});

test("a sitting-out player is not dealt into the next hand", () => {
  const g = new HoldemGame("t", cfg());
  g.sit(0, "a", "A", 1000);
  g.sit(1, "b", "B", 1000);
  g.sit(2, "c", "C", 1000);
  g.setSitOut("c", true);
  g.startHand();
  assert.equal(g.seats[2].status, "sitting_out", "sat-out seat isn't active");
  assert.equal((g.seats[2].holeCards?.length ?? 0), 0, "sat-out seat gets no cards");
  assert.ok((g.seats[0].holeCards?.length ?? 0) === 2 && (g.seats[1].holeCards?.length ?? 0) === 2);
});

test("startHand records each dealt seat's pre-blind stack", () => {
  const g = new HoldemGame("t", cfg({ smallBlind: 5, bigBlind: 10 }));
  g.sit(0, "a", "A", 1000);
  g.sit(1, "b", "B", 1000);
  g.startHand();
  // stackAtHandStart is captured before blinds are posted, so it's the full 1000
  // even though the blind seats have already had chips deducted from `stack`.
  assert.equal(g.seats[0].stackAtHandStart, 1000);
  assert.equal(g.seats[1].stackAtHandStart, 1000);
  assert.ok(g.seats[0].stack < 1000 || g.seats[1].stack < 1000, "a blind was posted");
});

test("chip conservation: total stacks + pot stay constant across a hand start", () => {
  const g = new HoldemGame("t", cfg());
  g.sit(0, "a", "A", 1000);
  g.sit(1, "b", "B", 1000);
  const before = g.seats.reduce((s, x) => s + x.stack, 0);
  g.startHand();
  const after = g.seats.reduce((s, x) => s + x.stack, 0) + g.pot;
  assert.equal(after, before, "no chips created or destroyed by posting blinds");
});
