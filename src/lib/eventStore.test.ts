import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  buildEvent,
  verifyChain,
  foldEvents,
  GENESIS_HASH,
  EVENT_SCHEMA_VERSION,
  type EventInput,
  type GameEvent,
} from "./eventStore";

const T = "11111111-1111-1111-1111-111111111111";

function input(over: Partial<EventInput> = {}): EventInput {
  return { tableId: T, type: "HAND_STARTED", payload: {}, timestamp: 1_000, ...over };
}

test("canonicalize is order-independent and stable", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: 2, b: 1 }), canonicalize({ b: 1, a: 2 }));
  assert.equal(canonicalize({ x: [3, { z: 1, y: 2 }] }), '{"x":[3,{"y":2,"z":1}]}');
  assert.equal(canonicalize(null), "null");
});

test("canonicalize matches JSON.stringify across a persistence round-trip", () => {
  // An undefined object property must be dropped (as JSONB storage does), not
  // hashed as null — otherwise the recomputed hash wouldn't match after reload.
  const payload = { a: 1, b: undefined, c: [1, undefined, 3] };
  const roundTripped = JSON.parse(JSON.stringify(payload));
  assert.equal(canonicalize(payload), canonicalize(roundTripped));
  assert.equal(canonicalize({ a: 1, b: undefined }), canonicalize({ a: 1 }));
});

test("undefined payload properties survive a build → persist → verify cycle", () => {
  const built = buildEvent(null, input({ type: "PLAYER_BET", payload: { amount: 30, note: undefined } }), "id-1");
  // Simulate what the DB round-trips: JSON.stringify on write, jsonb parse on read.
  const persisted: GameEvent = { ...built, payload: JSON.parse(JSON.stringify(built.payload)) };
  assert.ok(verifyChain([persisted]).ok);
});

test("first event: sequence 1, genesis prev-hash, 64-hex hash", () => {
  const e = buildEvent(null, input({ type: "TABLE_CREATED" }), "id-1");
  assert.equal(e.sequence, 1);
  assert.equal(e.prevHash, GENESIS_HASH);
  assert.equal(e.serverVersion, EVENT_SCHEMA_VERSION);
  assert.match(e.hash, /^[0-9a-f]{64}$/);
});

test("buildEvent is deterministic given the same id + timestamp", () => {
  const a = buildEvent(null, input({ type: "BLINDS_POSTED", payload: { bb: 10 } }), "id-x");
  const b = buildEvent(null, input({ type: "BLINDS_POSTED", payload: { bb: 10 } }), "id-x");
  assert.equal(a.hash, b.hash);
});

test("events chain: prevHash links to the prior hash and sequence increments", () => {
  const e1 = buildEvent(null, input({ type: "HAND_STARTED" }), "id-1");
  const e2 = buildEvent(e1, input({ type: "PLAYER_BET", playerId: "p1", payload: { amount: 30 } }), "id-2");
  assert.equal(e2.sequence, 2);
  assert.equal(e2.prevHash, e1.hash);
  assert.ok(verifyChain([e1, e2]).ok);
});

test("verifyChain rejects a tampered event", () => {
  const e1 = buildEvent(null, input({ type: "PLAYER_BET", payload: { amount: 30 } }), "id-1");
  const e2 = buildEvent(e1, input({ type: "PLAYER_CALLED", payload: { amount: 30 } }), "id-2");
  const tampered: GameEvent = { ...e1, payload: { amount: 999 } }; // rewrite history
  const res = verifyChain([tampered, e2]);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAt, 1);
});

test("verifyChain rejects a missing predecessor (broken link)", () => {
  const e1 = buildEvent(null, input(), "id-1");
  const e2 = buildEvent(e1, input({ type: "STREET_ADVANCED" }), "id-2");
  // e2 alone, verified from genesis: its prevHash points at e1, not genesis.
  const res = verifyChain([e2]);
  assert.equal(res.ok, false);
});

test("verifyChain rejects a sequence gap", () => {
  const e1 = buildEvent(null, input(), "id-1");
  const gap: GameEvent = { ...buildEvent(e1, input({ type: "STREET_ADVANCED" }), "id-2"), sequence: 5 };
  const res = verifyChain([e1, gap]);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /sequence gap/);
});

test("verifyChain resumes from a snapshot anchor", () => {
  const e1 = buildEvent(null, input(), "id-1");
  const e2 = buildEvent(e1, input({ type: "POT_AWARDED", payload: { amount: 200 } }), "id-2");
  // Pretend a snapshot was taken at e1: resume verifying e2 from e1's hash + seq 2.
  assert.ok(verifyChain([e2], e1.hash, 2).ok);
  // Wrong anchor sequence is rejected.
  assert.equal(verifyChain([e2], e1.hash, 3).ok, false);
});

test("foldEvents reduces a stream with a domain reducer", () => {
  const e1 = buildEvent(null, input({ type: "PLAYER_BET", payload: { amount: 30 } }), "id-1");
  const e2 = buildEvent(e1, input({ type: "PLAYER_CALLED", payload: { amount: 30 } }), "id-2");
  const e3 = buildEvent(e2, input({ type: "PLAYER_RAISED", payload: { amount: 60 } }), "id-3");
  const pot = foldEvents(0, [e1, e2, e3], (sum, e) => sum + ((e.payload as { amount?: number }).amount ?? 0));
  assert.equal(pot, 120);
});
