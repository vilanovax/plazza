-- Extend the non-negative guards to the remaining tournament monetary/stack
-- columns (buy-in, starting stack, per-entry chips), matching 0007.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_buy_in_chips_nonneg;
ALTER TABLE tournaments ADD  CONSTRAINT tournaments_buy_in_chips_nonneg  CHECK (buy_in_chips >= 0);
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_starting_stack_nonneg;
ALTER TABLE tournaments ADD  CONSTRAINT tournaments_starting_stack_nonneg CHECK (starting_stack >= 0);
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_chips_nonneg;
ALTER TABLE tournament_entries ADD  CONSTRAINT tournament_entries_chips_nonneg CHECK (chips >= 0);
