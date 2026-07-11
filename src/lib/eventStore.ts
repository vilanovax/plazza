/**
 * Event store for the authoritative poker engine: an append-only, hash-chained
 * log of typed game events plus periodic snapshots.
 *
 * Design (see also db/migrations/0023_game_events.sql):
 *   - Every state change is an immutable event. State is DERIVED — the reduce of
 *     the event stream — never the source of truth.
 *   - Events are chained: each event's `hash` covers its own content plus the
 *     previous event's hash, so tampering with any past event breaks every hash
 *     after it (tamper-evident, like the deckCommitment→deckSeed fairness proof).
 *   - `sequence` is gap-free and monotonic PER TABLE; a single writer per table
 *     (plus a per-table advisory lock here) guarantees no two events share one.
 *   - Snapshots are taken at hand boundaries so crash recovery only ever replays
 *     the events since the last snapshot, not the whole stream.
 *
 * The pure helpers (canonicalize / buildEvent / verifyChain / foldEvents) carry
 * no DB dependency and are unit-tested without Postgres. The DB helpers below
 * them are the runtime seam gameManager calls.
 *
 * Integration sketch (next step, not wired here to keep the live engine stable):
 *   await tx(async (c) => {
 *     await appendEvent(c, { tableId, type: "PLAYER_RAISED", playerId, actionId, payload });
 *   });
 *   // at HAND_COMPLETED:
 *   await tx(async (c) => {
 *     const ev = await appendEvent(c, { tableId, type: "HAND_COMPLETED", handId, payload });
 *     await saveSnapshot(c, { tableId, sequence: ev.sequence, hash: ev.hash, state });
 *   });
 *   // on restart:
 *   const { snapshot, events } = await loadForRecovery(tableId);
 *   const state = foldEvents(snapshot ? deserialize(snapshot.state) : empty(), events, applyEvent);
 */
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { query } from "./db";

/** Bump on any breaking change to event shapes or replay semantics. */
export const EVENT_SCHEMA_VERSION = "engine@1";

/** Chain anchor for the first event of a stream (no predecessor). */
export const GENESIS_HASH = "0".repeat(64);

export type EventType =
  // table lifecycle / seating
  | "TABLE_CREATED"
  | "PLAYER_JOINED"
  | "PLAYER_SEATED"
  | "PLAYER_READY"
  // hand start
  | "HAND_STARTED"
  | "BLINDS_POSTED"
  | "CARDS_DEALT"
  // street actions
  | "PLAYER_CHECKED"
  | "PLAYER_CALLED"
  | "PLAYER_BET"
  | "PLAYER_RAISED"
  | "PLAYER_FOLDED"
  | "PLAYER_ALL_IN"
  // progression / settlement
  | "STREET_ADVANCED"
  | "POT_CALCULATED"
  | "SHOWDOWN_STARTED"
  | "POT_AWARDED"
  | "HAND_COMPLETED"
  // presence / timing
  | "PLAYER_DISCONNECTED"
  | "PLAYER_RECONNECTED"
  | "PLAYER_TIMED_OUT";

/** The fields covered by the hash. `eventId` is a physical row id (not semantic)
 *  and is deliberately excluded so the hash is over meaning, not storage. */
export interface EventCore {
  sequence: number;
  tableId: string;
  handId: string | null;
  playerId: string | null;
  actionId: string | null;
  type: EventType;
  payload: unknown;
  serverVersion: string;
  timestamp: number;
  prevHash: string;
}

export interface GameEvent extends EventCore {
  eventId: string;
  hash: string;
}

export interface EventInput {
  tableId: string;
  type: EventType;
  payload?: unknown;
  handId?: string | null;
  playerId?: string | null;
  actionId?: string | null;
  timestamp?: number;
  serverVersion?: string;
}

export interface Snapshot {
  tableId: string;
  sequence: number;
  hash: string;
  serverVersion: string;
  state: unknown;
  takenAt: number;
}

// ---------------------------------------------------------------------------
// Pure core (no DB): deterministic hashing, event construction, verification.
// ---------------------------------------------------------------------------

/** Stable JSON with recursively sorted object keys, so equal content always
 *  hashes to the same string regardless of key insertion order. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function hashCore(core: EventCore): string {
  return createHash("sha256").update(canonicalize(core)).digest("hex");
}

function toCore(e: GameEvent): EventCore {
  return {
    sequence: e.sequence, tableId: e.tableId, handId: e.handId, playerId: e.playerId,
    actionId: e.actionId, type: e.type, payload: e.payload, serverVersion: e.serverVersion,
    timestamp: e.timestamp, prevHash: e.prevHash,
  };
}

/** Build the next event in a stream from the current head (or null for the
 *  first). Pure and deterministic given `eventId` and `input.timestamp`. */
export function buildEvent(
  head: Pick<GameEvent, "sequence" | "hash"> | null,
  input: EventInput,
  eventId: string = randomUUID(),
): GameEvent {
  const core: EventCore = {
    sequence: (head?.sequence ?? 0) + 1,
    tableId: input.tableId,
    handId: input.handId ?? null,
    playerId: input.playerId ?? null,
    actionId: input.actionId ?? null,
    type: input.type,
    payload: input.payload ?? {},
    serverVersion: input.serverVersion ?? EVENT_SCHEMA_VERSION,
    timestamp: input.timestamp ?? Date.now(),
    prevHash: head?.hash ?? GENESIS_HASH,
  };
  return { eventId, ...core, hash: hashCore(core) };
}

export interface ChainResult {
  ok: boolean;
  error?: string;
  brokenAt?: number;
}

/** Verify a contiguous run of events: sequence has no gaps, each prevHash links
 *  to the prior event, and each hash matches a recomputation of its content.
 *  When resuming from a snapshot, pass the snapshot's hash + next sequence. */
export function verifyChain(
  events: GameEvent[],
  startPrevHash: string = GENESIS_HASH,
  startSequence?: number,
): ChainResult {
  let expectedPrev = startPrevHash;
  let expectedSeq = startSequence ?? null;
  for (const e of events) {
    if (expectedSeq !== null && e.sequence !== expectedSeq) {
      return { ok: false, error: `sequence gap: expected ${expectedSeq}, got ${e.sequence}`, brokenAt: e.sequence };
    }
    if (e.prevHash !== expectedPrev) {
      return { ok: false, error: `prevHash mismatch at sequence ${e.sequence}`, brokenAt: e.sequence };
    }
    if (hashCore(toCore(e)) !== e.hash) {
      return { ok: false, error: `hash mismatch at sequence ${e.sequence}`, brokenAt: e.sequence };
    }
    expectedPrev = e.hash;
    expectedSeq = e.sequence + 1;
  }
  return { ok: true };
}

/** Reduce an event stream onto a starting state with a domain reducer. */
export function foldEvents<S>(initial: S, events: GameEvent[], apply: (state: S, e: GameEvent) => S): S {
  return events.reduce(apply, initial);
}

// ---------------------------------------------------------------------------
// DB seam. Appends are serialised per table so the chain stays gap-free even if
// the single-writer-per-table assumption is ever relaxed.
// ---------------------------------------------------------------------------

interface EventRow extends QueryResultRow {
  event_id: string;
  table_id: string;
  hand_id: string | null;
  player_id: string | null;
  sequence: string; // BIGINT -> string in node-pg
  type: EventType;
  action_id: string | null;
  payload: unknown;
  server_version: string;
  prev_hash: string;
  hash: string;
  ts: string; // BIGINT -> string
}

function rowToEvent(r: EventRow): GameEvent {
  return {
    eventId: r.event_id,
    sequence: Number(r.sequence),
    tableId: r.table_id,
    handId: r.hand_id,
    playerId: r.player_id,
    actionId: r.action_id,
    type: r.type,
    payload: r.payload,
    serverVersion: r.server_version,
    timestamp: Number(r.ts),
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

const EVENT_COLS =
  "event_id, table_id, hand_id, player_id, sequence, type, action_id, payload, server_version, prev_hash, hash, ts";

async function getHead(client: PoolClient, tableId: string): Promise<Pick<GameEvent, "sequence" | "hash"> | null> {
  const res = await client.query<{ sequence: string; hash: string }>(
    "SELECT sequence, hash FROM game_events WHERE table_id = $1 ORDER BY sequence DESC LIMIT 1",
    [tableId],
  );
  const row = res.rows[0];
  return row ? { sequence: Number(row.sequence), hash: row.hash } : null;
}

async function getByAction(client: PoolClient, tableId: string, actionId: string): Promise<GameEvent | null> {
  const res = await client.query<EventRow>(
    `SELECT ${EVENT_COLS} FROM game_events WHERE table_id = $1 AND action_id = $2 LIMIT 1`,
    [tableId, actionId],
  );
  return res.rows[0] ? rowToEvent(res.rows[0]) : null;
}

/**
 * Append one event to a table's stream and return the persisted event.
 * Must run inside a transaction (the advisory lock is released on commit).
 * Idempotent on `actionId`: a retried client intent returns the already-stored
 * event instead of appending a duplicate.
 */
export async function appendEvent(client: PoolClient, input: EventInput): Promise<GameEvent> {
  // Serialise appends for this table so sequence allocation + chaining can't race.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.tableId]);

  if (input.actionId) {
    const existing = await getByAction(client, input.tableId, input.actionId);
    if (existing) return existing;
  }

  const ev = buildEvent(await getHead(client, input.tableId), input);
  await client.query(
    `INSERT INTO game_events (${EVENT_COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      ev.eventId, ev.tableId, ev.handId, ev.playerId, ev.sequence, ev.type,
      ev.actionId, JSON.stringify(ev.payload ?? {}), ev.serverVersion, ev.prevHash, ev.hash, ev.timestamp,
    ],
  );
  return ev;
}

/** Append several events in order, in a single transaction. */
export async function appendEvents(client: PoolClient, inputs: EventInput[]): Promise<GameEvent[]> {
  const out: GameEvent[] = [];
  for (const input of inputs) out.push(await appendEvent(client, input));
  return out;
}

/** Load all events after `afterSequence` (0 = from the start), oldest first. */
export async function loadEventsSince(tableId: string, afterSequence = 0): Promise<GameEvent[]> {
  const rows = await query<EventRow>(
    `SELECT ${EVENT_COLS} FROM game_events WHERE table_id = $1 AND sequence > $2 ORDER BY sequence ASC`,
    [tableId, afterSequence],
  );
  return rows.map(rowToEvent);
}

/** The most recent snapshot for a table, or null if none has been taken yet. */
export async function latestSnapshot(tableId: string): Promise<Snapshot | null> {
  const rows = await query<{
    sequence: string; hash: string; server_version: string; state: unknown; taken_at: string;
  }>(
    "SELECT sequence, hash, server_version, state, taken_at FROM game_snapshots WHERE table_id = $1 ORDER BY sequence DESC LIMIT 1",
    [tableId],
  );
  const r = rows[0];
  return r
    ? { tableId, sequence: Number(r.sequence), hash: r.hash, serverVersion: r.server_version, state: r.state, takenAt: Number(r.taken_at) }
    : null;
}

/** Persist a snapshot at an event boundary. Idempotent per (table, sequence). */
export async function saveSnapshot(
  client: PoolClient,
  snap: { tableId: string; sequence: number; hash: string; state: unknown; serverVersion?: string; takenAt?: number },
): Promise<void> {
  await client.query(
    `INSERT INTO game_snapshots (table_id, sequence, hash, server_version, state, taken_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (table_id, sequence) DO NOTHING`,
    [snap.tableId, snap.sequence, snap.hash, snap.serverVersion ?? EVENT_SCHEMA_VERSION, JSON.stringify(snap.state), snap.takenAt ?? Date.now()],
  );
}

/**
 * Load everything needed to rebuild a table after a crash: the latest snapshot
 * (if any) and the events recorded since it. Verifies the hash chain of those
 * events against the snapshot anchor and THROWS if it is broken — a corrupt or
 * tampered stream must never silently produce a wrong state.
 */
export async function loadForRecovery(tableId: string): Promise<{ snapshot: Snapshot | null; events: GameEvent[] }> {
  const snapshot = await latestSnapshot(tableId);
  const events = await loadEventsSince(tableId, snapshot?.sequence ?? 0);
  const chain = verifyChain(events, snapshot?.hash ?? GENESIS_HASH, (snapshot?.sequence ?? 0) + 1);
  if (!chain.ok) {
    throw new Error(`game_events chain broken for table ${tableId}: ${chain.error}`);
  }
  return { snapshot, events };
}
