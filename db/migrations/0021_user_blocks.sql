-- Persistent, account-level "block": the blocker no longer sees the blocked
-- user's chat/reactions, and (as social features land) can't be invited/
-- challenged by them. Foundational safety primitive.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- Index the reverse direction (blocked_id): the PK already covers blocker_id as
-- its leading column, and this makes the ON DELETE CASCADE from users fast.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);
