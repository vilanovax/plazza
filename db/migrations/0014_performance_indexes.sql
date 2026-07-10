-- Hot-path indexes for lobby, stats, and tournament lookups.

CREATE INDEX IF NOT EXISTS idx_poker_tables_status_open
  ON poker_tables(status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_tournament_entries_user_id
  ON tournament_entries(user_id);

CREATE INDEX IF NOT EXISTS idx_hand_players_user_id
  ON hand_players(user_id);

CREATE INDEX IF NOT EXISTS idx_hand_players_user_won
  ON hand_players(user_id)
  WHERE won = TRUE;

CREATE INDEX IF NOT EXISTS idx_ledger_table_user_type
  ON ledger_entries(table_id, user_id, type);
