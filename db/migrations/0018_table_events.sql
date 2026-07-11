-- Persist the per-table event/chat feed so it survives a server restart
-- (previously the feed lived only in memory, capped at 60 entries, and was lost
-- when the process restarted). `seq` mirrors the in-memory LogEntry id so the
-- rehydrated feed keeps its ordering and the counter can resume.
CREATE TABLE IF NOT EXISTS table_events (
  id             BIGSERIAL PRIMARY KEY,
  table_id       UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seq            INT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'event',
  text           TEXT NOT NULL,
  author_user_id UUID,
  author_name    TEXT,
  ts             BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first lookups scoped to a table (feed rehydration + history).
CREATE INDEX IF NOT EXISTS idx_table_events_table ON table_events (table_id, id DESC);
