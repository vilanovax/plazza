-- hand_players is a statistics/audit table: block upstream deletes rather than
-- silently purging history (users are deactivated and tables closed, not
-- deleted, so RESTRICT never gets in the way in normal operation).
ALTER TABLE hand_players DROP CONSTRAINT IF EXISTS hand_players_user_id_fkey;
ALTER TABLE hand_players
  ADD CONSTRAINT hand_players_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE hand_players DROP CONSTRAINT IF EXISTS hand_players_table_id_fkey;
ALTER TABLE hand_players
  ADD CONSTRAINT hand_players_table_id_fkey
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE RESTRICT;
