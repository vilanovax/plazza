-- Private (invite-only) tables: unlisted from the public lobby, joinable only
-- with the invite code (or by an admin). invite_code is a URL-safe token the
-- host shares as a link; NULL for ordinary public tables.
ALTER TABLE poker_tables
  ADD COLUMN IF NOT EXISTS is_private  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Codes must be unique so a link maps to exactly one table (partial: only when set).
CREATE UNIQUE INDEX IF NOT EXISTS poker_tables_invite_code_key
  ON poker_tables (invite_code)
  WHERE invite_code IS NOT NULL;
