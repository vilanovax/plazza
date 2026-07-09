-- Record each showdown participant's made-hand category (0=high card … 8=straight
-- flush) so a player's best hand ever can be shown on their profile. Nullable:
-- folded players and pre-existing rows have no recorded category.
ALTER TABLE hand_players ADD COLUMN best_hand_rank SMALLINT
  CHECK (best_hand_rank IS NULL OR (best_hand_rank >= 0 AND best_hand_rank <= 8));
