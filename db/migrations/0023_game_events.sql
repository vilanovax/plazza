-- Append-only, hash-chained event log for the authoritative poker engine, plus
-- periodic state snapshots. Together they let a table's state be rebuilt after a
-- crash (latest snapshot + replay of newer events) and be audited/replayed for
-- provable fairness and dispute resolution.
--
-- Like audit_log, the event table is immutable: a trigger rejects any
-- UPDATE/DELETE so the hash chain stays tamper-evident. Snapshots stay mutable
-- (they are derived and may be pruned).

CREATE TABLE IF NOT EXISTS game_events (
  id             BIGSERIAL PRIMARY KEY,
  event_id       UUID NOT NULL,                 -- physical dedup for at-least-once writes
  table_id       UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  hand_id        TEXT,                          -- NULL for events before a hand starts
  player_id      UUID,                          -- actor; NULL for engine-derived events
  sequence       BIGINT NOT NULL,               -- gap-free, monotonic per table
  type           TEXT NOT NULL,                 -- e.g. 'PLAYER_RAISED'
  action_id      TEXT,                          -- client-intent idempotency key; NULL if derived
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_version TEXT NOT NULL,                 -- engine/schema version for safe replay
  prev_hash      TEXT NOT NULL,                 -- hash of the preceding event in this stream
  hash           TEXT NOT NULL,                 -- H(canonical(core, incl. prev_hash))
  ts             BIGINT NOT NULL,               -- server Unix ms
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_events_seq_unique UNIQUE (table_id, sequence),
  CONSTRAINT game_events_eid_unique UNIQUE (event_id)
);

-- Ordered replay scoped to a table.
CREATE INDEX IF NOT EXISTS idx_game_events_stream ON game_events (table_id, sequence);
-- Input idempotency: at most one row per client intent (only when action_id set).
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_events_action
  ON game_events (table_id, action_id) WHERE action_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  table_id       UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  sequence       BIGINT NOT NULL,               -- event sequence this snapshot reflects
  hash           TEXT NOT NULL,                 -- hash of the event at `sequence` (chain anchor)
  server_version TEXT NOT NULL,
  state          JSONB NOT NULL,                -- serialised GameState
  taken_at       BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_snapshots_seq_unique UNIQUE (table_id, sequence)
);

-- "Latest snapshot for a table" lookup.
CREATE INDEX IF NOT EXISTS idx_game_snapshots_latest ON game_snapshots (table_id, sequence DESC);

-- Enforce append-only on the event log.
CREATE OR REPLACE FUNCTION game_events_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'game_events is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS game_events_immutable ON game_events;
CREATE TRIGGER game_events_immutable
  BEFORE UPDATE OR DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION game_events_reject_mutation();
