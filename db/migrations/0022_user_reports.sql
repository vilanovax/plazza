-- Player reports for admin moderation review. A report is append-only content
-- with a mutable review status/outcome set by an admin.
CREATE TABLE IF NOT EXISTS user_reports (
  id           BIGSERIAL PRIMARY KEY,
  reporter_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  table_id     UUID REFERENCES poker_tables(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_reports_status   ON user_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports (reported_id);
