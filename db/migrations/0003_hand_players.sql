-- Per-hand participation, so we can show per-player, per-table statistics
-- (hands played, hands won, net result).
CREATE TABLE IF NOT EXISTS hand_players (
  hand_id    UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  table_id   UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seat_index INT NOT NULL,
  won        BOOLEAN NOT NULL DEFAULT FALSE,
  net        BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, seat_index)
);
CREATE INDEX IF NOT EXISTS idx_hand_players_table_user ON hand_players(table_id, user_id);
