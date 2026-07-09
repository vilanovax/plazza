-- Cap monetary/stack columns at Number.MAX_SAFE_INTEGER (9007199254740991) so
-- the app can safely coerce these BIGINT values to JS numbers without silent
-- rounding corrupting chip accounting. Chips are play money in the thousands;
-- this bound is astronomically high yet still keeps us in exact-integer range.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_chip_balance_max;
ALTER TABLE users ADD  CONSTRAINT users_chip_balance_max CHECK (chip_balance <= 9007199254740991);

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_buy_in_chips_max;
ALTER TABLE tournaments ADD  CONSTRAINT tournaments_buy_in_chips_max   CHECK (buy_in_chips   <= 9007199254740991);
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_starting_stack_max;
ALTER TABLE tournaments ADD  CONSTRAINT tournaments_starting_stack_max CHECK (starting_stack <= 9007199254740991);
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_prize_pool_max;
ALTER TABLE tournaments ADD  CONSTRAINT tournaments_prize_pool_max     CHECK (prize_pool     <= 9007199254740991);

ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_chips_max;
ALTER TABLE tournament_entries ADD  CONSTRAINT tournament_entries_chips_max CHECK (chips <= 9007199254740991);
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_prize_max;
ALTER TABLE tournament_entries ADD  CONSTRAINT tournament_entries_prize_max CHECK (prize <= 9007199254740991);
