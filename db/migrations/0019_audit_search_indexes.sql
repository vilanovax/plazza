-- Search indexes for the hand-history audit trail, so queries by player, by
-- hand, and by table/time use an index instead of a sequential scan.
--   "all actions by a player over a time window"
CREATE INDEX IF NOT EXISTS idx_hand_actions_user_created ON hand_actions (user_id, created_at DESC);
--   "all actions of a specific hand" (the hand_id FK has no implicit index)
CREATE INDEX IF NOT EXISTS idx_hand_actions_hand ON hand_actions (hand_id);
--   "all hands at a table over a time window"
CREATE INDEX IF NOT EXISTS idx_hands_table_started ON hands (table_id, started_at DESC);
