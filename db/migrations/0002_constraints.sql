-- Integrity constraints (defense in depth for the accounting + audit tables).

-- A player's chip bank can never go negative.
ALTER TABLE users
  ADD CONSTRAINT users_chip_balance_nonneg CHECK (chip_balance >= 0);

-- Hand numbers are unique per table (audit / history integrity).
ALTER TABLE hands
  ADD CONSTRAINT hands_table_hand_no_unique UNIQUE (table_id, hand_no);

-- A table may only reference an existing tournament.
ALTER TABLE poker_tables
  ADD CONSTRAINT poker_tables_tournament_fk
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL;
