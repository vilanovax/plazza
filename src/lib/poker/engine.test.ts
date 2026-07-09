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
    sitOutMaxMin: 5,
    extraTimeSec: 15,
    extraTimeRequests: -1,
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

test("leaving mid-hand keeps committed chips in the pot (conservation)", () => {
  const g = new HoldemGame("tL", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  const before = totalChips(g);
  g.startHand();
  // Button 0, SB 1(5), BB 2(10). First to act = seat 0.
  g.act("u0", { type: "raise", amount: 40 }); // seat 0 commits 40
  // Seat 1 leaves mid-hand after having posted the small blind (committed 5).
  const returned = g.leave(1);
  // Their remaining stack is handed back; the 5 they committed stays in the pot.
  assert.equal(returned, 995);
  g.act("u2", { type: "fold" }); // BB folds
  // Only seat 0 remains -> hand ends. Pot must include seat 1's committed 5.
  assert.equal(g.phase, "hand_complete");
  assert.equal(totalChips(g) + returned, before);
});

test("top-up rejects amounts outside the configured limits and non-finite", () => {
  const g = new HoldemGame("tT", cfg({ topUpMin: 100, topUpMax: 500 }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  // Seat is sitting_out before the first hand, so top-up is allowed here.
  assert.throws(() => g.topUp(0, 50), /حداقل/);
  assert.throws(() => g.topUp(0, 999), /حداکثر/);
  assert.throws(() => g.topUp(0, NaN), /نامعتبر/);
  g.topUp(0, 200);
  assert.equal(g.seats[0].stack, 1200);
});

test("fold-win offers the winner a show window; only the winner may reveal", () => {
  const g = new HoldemGame("tS", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.startHand(); // heads-up: seat0 = button/SB acts first preflop
  g.act("u0", { type: "fold" }); // SB folds -> seat1 (BB) wins uncontested
  assert.equal(g.phase, "hand_complete");
  assert.equal(g.showOfferSeat, 1);
  assert.ok((g.showOfferUntil ?? 0) > Date.now());
  assert.throws(() => g.showCards("u0"), /برنده/); // non-winner can't show
  g.showCards("u1");
  assert.equal(g.lastResult?.shownCards[1]?.length, 2); // winner's cards revealed
});

test("sit-out excludes a player from the next deal", () => {
  const g = new HoldemGame("tSO", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  g.startHand();
  g.act("u0", { type: "fold" });
  g.act("u1", { type: "fold" }); // seat2 wins, hand ends
  g.setSitOut("u1", true);
  g.startHand();
  assert.equal(g.seats[1].status, "sitting_out");
  assert.equal(g.seats[1].holeCards?.length ?? 0, 0);
  assert.equal(g.seats[0].holeCards?.length, 2); // others still dealt
});

test("extra time extends the deadline; at most one per turn", () => {
  const g = new HoldemGame("tET", cfg({ extraTimeRequests: -1, extraTimeSec: 20 }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.startHand(); // heads-up: seat0 acts first
  const before = g.actionDeadline ?? 0;
  g.requestExtraTime("u0");
  assert.ok((g.actionDeadline ?? 0) >= before + 20_000 - 50);
  // A second request on the SAME turn is rejected even when unlimited per hand.
  assert.throws(() => g.requestExtraTime("u0"), /یک‌بار/);
});

test("extra time can be disabled per table", () => {
  const g = new HoldemGame("tET2", cfg({ extraTimeRequests: 0 }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.startHand();
  assert.throws(() => g.requestExtraTime("u0"), /غیرفعال/);
});

test("rake is capped and skipped when no flop is seen", () => {
  const g = new HoldemGame("t5", cfg({ rakePercent: 10, rakeCap: 50, noFlopNoDrop: true }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.startHand();
  g.act("u0", { type: "fold" }); // preflop end, no flop
  assert.equal(g.lastResult!.rake, 0);
});
