-- Tournament payout-safety guards.
--
-- 1) Add a transitional 'finishing' status so the payout phase can be claimed
--    atomically (running -> finishing) by exactly one caller, preventing a
--    race that could distribute the prize pool twice.
-- 2) Guarantee a table backs at most one live tournament at a time.

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('scheduled', 'running', 'finishing', 'finished', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tournament_live_table
  ON tournaments(table_id)
  WHERE table_id IS NOT NULL AND status IN ('running', 'finishing');

-- 3) Defense-in-depth: monetary/counter columns can never be negative
--    (mirrors the CHECK (chip_balance >= 0) invariant on users).
ALTER TABLE tournaments  DROP CONSTRAINT IF EXISTS tournaments_prize_pool_nonneg;
ALTER TABLE tournaments  ADD  CONSTRAINT tournaments_prize_pool_nonneg    CHECK (prize_pool >= 0);
ALTER TABLE tournaments  DROP CONSTRAINT IF EXISTS tournaments_current_level_nonneg;
ALTER TABLE tournaments  ADD  CONSTRAINT tournaments_current_level_nonneg CHECK (current_level >= 0);
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_prize_nonneg;
ALTER TABLE tournament_entries ADD  CONSTRAINT tournament_entries_prize_nonneg  CHECK (prize >= 0);
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_rebuys_nonneg;
ALTER TABLE tournament_entries ADD  CONSTRAINT tournament_entries_rebuys_nonneg CHECK (rebuys >= 0);
