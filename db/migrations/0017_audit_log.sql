-- Append-only audit log for security-relevant events: auth (login/logout/
-- register) and admin operations. Immutable by design — a trigger blocks any
-- UPDATE/DELETE so entries are tamper-evident. actor_id is stored WITHOUT a
-- foreign key on purpose: an audit record must survive (and not be rewritten
-- by) deletion of the user it references.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  correlation_id TEXT,                          -- ties together events of one operation
  actor_id       UUID,                          -- who did it (NULL for anonymous/failed)
  action         TEXT NOT NULL,                 -- e.g. 'auth.login', 'admin.credit'
  target_type    TEXT,                          -- e.g. 'user', 'table', 'settings'
  target_id      TEXT,
  metadata       JSONB,                         -- action-specific detail (no secrets)
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor       ON audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action      ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created     ON audit_log (created_at DESC);

-- Enforce append-only: reject every UPDATE/DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
