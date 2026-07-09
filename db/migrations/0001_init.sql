-- Poker PWA — initial schema.
-- All monetary values are in chips (integers). There is no real money.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('admin', 'player')),
  -- The player's chip "bank" managed by the admin. Buy-ins draw from here,
  -- cash-outs return to here. The table stack is tracked separately in-game.
  chip_balance   BIGINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Global admin settings (single row, id = 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_settings (
  id                     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Defaults applied to newly created tables.
  default_small_blind    INT NOT NULL DEFAULT 5,
  default_big_blind      INT NOT NULL DEFAULT 10,
  default_rake_percent   INT NOT NULL DEFAULT 0,
  default_rake_cap       INT NOT NULL DEFAULT 0,
  default_think_time_sec INT NOT NULL DEFAULT 30,
  default_min_buyin      INT NOT NULL DEFAULT 100,
  default_max_buyin      INT NOT NULL DEFAULT 2000,
  -- Whether players may top-up themselves or must be approved by an admin.
  allow_self_topup       BOOLEAN NOT NULL DEFAULT FALSE,
  topup_min              INT NOT NULL DEFAULT 100,
  topup_max              INT NOT NULL DEFAULT 2000,
  -- Whether players may self-register or admin must create accounts.
  allow_self_register    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO admin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tables (cash games). config holds the full TableConfig as JSON.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poker_tables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  config       JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  tournament_id UUID,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

-- Persisted seat occupancy so a table survives a server restart.
CREATE TABLE IF NOT EXISTS table_seats (
  table_id    UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat_index  INT NOT NULL,
  user_id     UUID REFERENCES users(id),
  stack       BIGINT NOT NULL DEFAULT 0,
  buy_in      BIGINT NOT NULL DEFAULT 0,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, seat_index)
);

-- ---------------------------------------------------------------------------
-- Hand history + full action audit trail (anti-cheat / dispute resolution)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id        UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  hand_no         INT NOT NULL,
  button_seat     INT NOT NULL,
  community       TEXT[] NOT NULL DEFAULT '{}',
  pot             BIGINT NOT NULL DEFAULT 0,
  rake            BIGINT NOT NULL DEFAULT 0,
  deck_commitment TEXT,
  deck_seed       TEXT,
  result          JSONB,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hand_actions (
  id          BIGSERIAL PRIMARY KEY,
  hand_id     UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  seat_index  INT NOT NULL,
  user_id     UUID REFERENCES users(id),
  phase       TEXT NOT NULL,
  action      TEXT NOT NULL,
  amount      BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Chip ledger — the "simple accounting" per player, with settlement flags.
-- Every chip movement is recorded here for full history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'admin_credit', 'admin_debit', 'buy_in', 'cash_out',
                    'topup', 'win', 'loss', 'rake', 'settlement', 'adjustment')),
  amount          BIGINT NOT NULL,              -- signed: + gains chips, - loses
  balance_after   BIGINT NOT NULL,             -- user's bank balance after entry
  table_id        UUID REFERENCES poker_tables(id) ON DELETE SET NULL,
  hand_id         UUID REFERENCES hands(id) ON DELETE SET NULL,
  -- For "who paid whom" settlement between two players.
  counterparty_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT,
  -- Admin marks an entry settled once real-world balances are squared up.
  settled         BOOLEAN NOT NULL DEFAULT FALSE,
  settled_by      UUID REFERENCES users(id),
  settled_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_unsettled ON ledger_entries(settled) WHERE settled = FALSE;

-- ---------------------------------------------------------------------------
-- Top-up requests (player asks to add chips to their table stack)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topup_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_id    UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat_index  INT,
  amount      BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  UUID REFERENCES users(id),
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topup_pending ON topup_requests(status) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Tournaments (scaffolding for a later phase)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'running', 'finished', 'cancelled')),
  buy_in_chips   BIGINT NOT NULL DEFAULT 0,
  starting_stack BIGINT NOT NULL DEFAULT 1500,
  max_players    INT NOT NULL DEFAULT 9,
  blind_schedule JSONB NOT NULL DEFAULT '[]',   -- [{level, sb, bb, ante, minutes}]
  config         JSONB NOT NULL DEFAULT '{}',
  created_by     UUID REFERENCES users(id),
  starts_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chips         BIGINT NOT NULL DEFAULT 0,
  place         INT,
  status        TEXT NOT NULL DEFAULT 'registered'
                  CHECK (status IN ('registered', 'active', 'busted', 'winner')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);
