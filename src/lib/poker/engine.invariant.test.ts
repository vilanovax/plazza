import { test } from "node:test";
import assert from "node:assert/strict";
import { HoldemGame } from "./engine";
import type { PlayerAction, TableConfig } from "./types";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return {
    name: "T", maxSeats: 6, smallBlind: 5, bigBlind: 10, ante: 0,
    rakePercent: 0, rakeCap: 0, noFlopNoDrop: true, minBuyIn: 100, maxBuyIn: 10000,
    thinkTimeSec: 30, allowTopUp: true, topUpMin: 100, topUpMax: 5000,
    tableDurationMin: 0, sitOutMaxMin: 5, extraTimeSec: 15, extraTimeRequests: -1,
    ...over,
  };
}

const stacks = (g: HoldemGame) => g.seats.reduce((s, x) => s + x.stack, 0);

/**
 * Core chip-conservation invariant (the acceptance criterion): WHILE a hand is
 * live, every chip is either in a player's stack or committed to the pot, so
 * stacks + pot must always equal the chips that started the hand. `g.pot` is the
 * sum of committedThisHand, so this also asserts the pot total is consistent
 * with what players have actually put in. (After settlement the pot has been
 * paid back into stacks; committedThisHand is only reset on the next startHand,
 * so the terminal state is checked separately as stacks + rake == start.)
 */
function assertConserved(g: HoldemGame, start: number, label: string) {
  assert.equal(stacks(g) + g.pot, start, `chips conserved ${label}`);
}

/** Drive the hand to completion, asserting the live invariant after every
 *  action (except the one that settles the hand — see note above). */
function playOut(g: HoldemGame, start: number, decide: (g: HoldemGame) => PlayerAction) {
  let guard = 0;
  while (g.phase !== "hand_complete" && g.currentTurnSeat !== null) {
    assert.ok(guard++ < 500, "hand did not terminate");
    const seat = g.seats[g.currentTurnSeat];
    g.act(seat.userId!, decide(g));
    if (g.phase !== "hand_complete") assertConserved(g, start, `after seat ${seat.seatIndex}`);
  }
}

test("chips are conserved after every action through a full showdown", () => {
  const g = new HoldemGame("inv1", cfg());
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  const start = stacks(g);
  g.startHand();
  assertConserved(g, start, "after blinds");
  // Everyone just calls / checks all the way to showdown.
  playOut(g, start, (game) => {
    const seat = game.seats[game.currentTurnSeat!];
    const toCall = game.currentBet - seat.betThisRound;
    return toCall > 0 ? { type: "call" } : { type: "check" };
  });
  assert.equal(g.phase, "hand_complete");
  // Rake is 0 here, so all chips return to stacks after settlement.
  assert.equal(stacks(g), start, "all chips back in stacks post-showdown");
  assert.equal(g.lastResult?.rake, 0);
});

test("chips are conserved with rake taken at showdown", () => {
  const g = new HoldemGame("inv2", cfg({ rakePercent: 5, rakeCap: 50 }));
  g.sit(0, "u0", "A", 1000);
  g.sit(1, "u1", "B", 1000);
  g.sit(2, "u2", "C", 1000);
  const start = stacks(g);
  g.startHand();
  playOut(g, start, (game) => {
    const seat = game.seats[game.currentTurnSeat!];
    const toCall = game.currentBet - seat.betThisRound;
    return toCall > 0 ? { type: "call" } : { type: "check" };
  });
  const rake = g.lastResult?.rake ?? 0;
  assert.ok(rake > 0, "rake was taken");
  // Every chip is accounted for: stacks + rake == the chips that started.
  assert.equal(stacks(g) + rake, start, "stacks + rake == start");
});

test("chips are conserved through an all-in with a genuine side pot", () => {
  const g = new HoldemGame("inv3", cfg());
  g.sit(0, "u0", "A", 100); // short — will be all-in for the main pot only
  g.sit(1, "u1", "B", 250); // medium — all-in, eligible for one side pot
  g.sit(2, "u2", "C", 1000); // covers everyone
  const start = stacks(g); // 1350
  g.startHand();
  assertConserved(g, start, "after blinds");
  // A and B shove; C calls. Produces a main pot (A,B,C) + a side pot (B,C).
  playOut(g, start, (game) => {
    const seat = game.seats[game.currentTurnSeat!];
    if (seat.userId === "u0" || seat.userId === "u1") return { type: "allin" };
    const toCall = game.currentBet - seat.betThisRound;
    return toCall > 0 ? { type: "call" } : { type: "check" };
  });
  assert.equal(g.phase, "hand_complete");
  // At least two pots (main + side) were built and paid out.
  assert.ok((g.lastResult?.pots.length ?? 0) >= 2, "a side pot formed");
  // No chips created or destroyed across the all-in settlement (rake 0).
  assert.equal(stacks(g), start, "all chips conserved after side-pot settlement");
});
