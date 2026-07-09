import { test } from "node:test";
import assert from "node:assert/strict";
import { HoldemGame } from "./engine";
import type { TableConfig } from "./types";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return {
    name: "T",
    maxSeats: 6,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    rakePercent: 0,
    rakeCap: 0,
    noFlopNoDrop: true,
    minBuyIn: 100,
    maxBuyIn: 10000,
    thinkTimeSec: 30,
    allowTopUp: true,
    topUpMin: 100,
    topUpMax: 5000,
    tableDurationMin: 0,
    ...over,
  };
}

function totalChips(g: HoldemGame): number {
  return g.seats.reduce((s, x) => s + x.stack, 0);
}

test("blinds are posted and first to act is left of BB", () => {
  const g = new HoldemGame("t1", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  g.startHand();
  // 3-handed: button=seat0, SB=seat1, BB=seat2, first to act = seat0.
  assert.equal(g.phase, "preflop");
  assert.equal(g.seats[1].betThisRound, 5);
  assert.equal(g.seats[2].betThisRound, 10);
  assert.equal(g.currentTurnSeat, 0);
  assert.equal(g.currentBet, 10);
});

test("everyone folds to the big blind — BB wins the pot, chips conserved", () => {
  const g = new HoldemGame("t2", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  const before = totalChips(g);
  g.startHand();
  g.act("u0", { type: "fold" }); // button folds
  g.act("u1", { type: "fold" }); // SB folds
  assert.equal(g.phase, "hand_complete");
  // BB (seat 2) wins the 15 in the pot -> net +5 over their blind.
  assert.equal(g.seats[2].stack, 1005);
  assert.equal(totalChips(g), before);
});

test("a full hand to showdown conserves chips (no rake)", () => {
  const g = new HoldemGame("t3", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  const before = totalChips(g);
  g.startHand(); // heads-up: button/SB = seat0, BB = seat1
  // Preflop: SB acts first heads-up.
  assert.equal(g.currentTurnSeat, 0);
  g.act("u0", { type: "call" }); // SB completes to 10
  g.act("u1", { type: "check" }); // BB checks option
  // Flop
  assert.equal(g.phase, "flop");
  g.act("u1", { type: "check" });
  g.act("u0", { type: "check" });
  assert.equal(g.phase, "turn");
  g.act("u1", { type: "check" });
  g.act("u0", { type: "check" });
  assert.equal(g.phase, "river");
  g.act("u1", { type: "check" });
  g.act("u0", { type: "check" });
  assert.equal(g.phase, "hand_complete");
  assert.equal(totalChips(g), before);
});

test("all-in confrontation conserves chips and builds side pots", () => {
  const g = new HoldemGame("t4", cfg({ smallBlind: 5, bigBlind: 10 }));
  g.sit(0, "u0", "A", 100);
  g.sit(1, "u1", "B", 300);
  g.sit(2, "u2", "C", 500);
  const before = totalChips(g);
  g.startHand();
  // 3-handed: button seat0, SB seat1(5), BB seat2(10). First=seat0.
  g.act("u0", { type: "allin" }); // 100
  g.act("u1", { type: "allin" }); // 300
  g.act("u2", { type: "allin" }); // 500
  // Betting is done; board runs out to showdown automatically.
  assert.equal(g.phase, "hand_complete");
  assert.equal(totalChips(g), before);
  // Exactly the committed chips were redistributed.
  assert.ok(g.lastResult);
  const paidOut = g.lastResult!.pots.reduce(
    (s, p) => s + p.winners.reduce((a, w) => a + w.amount, 0),
    0
  );
  assert.equal(paidOut + g.lastResult!.rake, before - totalChips(g) + paidOut);
});

test("rake is capped and skipped when no flop is seen", () => {
  const g = new HoldemGame("t5", cfg({ rakePercent: 10, rakeCap: 50, noFlopNoDrop: true }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.startHand();
  g.act("u0", { type: "fold" }); // preflop end, no flop
  assert.equal(g.lastResult!.rake, 0);
});
