-- Anti-fraud signals and moderation actions.
--
-- `security_signals` are heuristic, machine-generated hints (collusion,
-- chip-dumping, bot-like timing, shared device/IP) feeding a risk score for the
-- review queue. They are advisory and prunable, so they cascade on user delete.
--
-- `moderation_actions` are the human decisions taken on a user (warn/mute/kick/
-- ban/suspend, and their reversals). Like audit_log they are append-only and
-- retained regardless of account deletion, so actor/target are stored as bare
-- UUIDs WITHOUT a foreign key. An appeal or reversal is a NEW row (e.g. an
-- 'unban'), never an UPDATE.

CREATE TABLE IF NOT EXISTS security_signals (
  id               BIGSERIAL PRIMARY KEY,
  subject_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_user_id  UUID REFERENCES users(id) ON DELETE SET NULL, -- counterpart (e.g. collusion peer)
  signal_type      TEXT NOT NULL,                    -- e.g. 'chip_dumping', 'shared_device', 'bot_timing'
  score            INT NOT NULL DEFAULT 0,           -- contribution to the risk score
  table_id         UUID REFERENCES poker_tables(id) ON DELETE SET NULL,
  hand_ref         TEXT,                             -- optional hand pointer (no FK: hands may be archived)
  context          JSONB,                            -- signal-specific detail
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT security_signals_score_range CHECK (score >= 0 AND score <= 100)
);

CREATE INDEX IF NOT EXISTS idx_security_signals_subject ON security_signals (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_signals_type    ON security_signals (signal_type, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id               BIGSERIAL PRIMARY KEY,
  moderator_id     UUID,                             -- who acted (NULL for automated); no FK on purpose
  target_user_id   UUID NOT NULL,                    -- who it was applied to; no FK so it survives deletion
  report_id        BIGINT REFERENCES user_reports(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,                    -- 'warn' | 'mute' | 'kick' | 'ban' | 'suspend' | 'unban' | 'appeal_granted' ...
  reason           TEXT,
  expires_at       TIMESTAMPTZ,                      -- for temporary suspensions/mutes (NULL = permanent/instant)
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_action ON moderation_actions (action, created_at DESC);

-- Append-only: moderation history must be tamper-evident. Reversals are new rows.
CREATE OR REPLACE FUNCTION moderation_actions_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'moderation_actions is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS moderation_actions_immutable ON moderation_actions;
CREATE TRIGGER moderation_actions_immutable
  BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_actions_reject_mutation();
