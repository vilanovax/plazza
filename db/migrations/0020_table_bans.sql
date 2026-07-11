-- Persistent per-table bans (distinct from a one-off kick): a banned user can
-- neither join nor sit at the table until an admin lifts the ban.
CREATE TABLE IF NOT EXISTS table_bans (
  table_id   UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, user_id)
);
