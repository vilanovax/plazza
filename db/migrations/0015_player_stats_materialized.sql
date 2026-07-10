-- Denormalized player stats (maintained incrementally on hand-end and buy-in).
-- Replaces heavy aggregation over hand_players + ledger_entries on profile reads.

CREATE TABLE IF NOT EXISTS player_global_stats (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hands_played   INT NOT NULL DEFAULT 0,
  hands_won      INT NOT NULL DEFAULT 0,
  tables_played  INT NOT NULL DEFAULT 0,
  biggest_win    BIGINT NOT NULL DEFAULT 0,
  biggest_pot    BIGINT NOT NULL DEFAULT 0,
  buyin_count    INT NOT NULL DEFAULT 0,
  total_bought   BIGINT NOT NULL DEFAULT 0,
  net_lifetime   BIGINT NOT NULL DEFAULT 0,
  best_hand_rank SMALLINT CHECK (best_hand_rank IS NULL OR (best_hand_rank >= 0 AND best_hand_rank <= 8)),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_table_stats (
  table_id      UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hands_played  INT NOT NULL DEFAULT 0,
  hands_won     INT NOT NULL DEFAULT 0,
  buyin_count   INT NOT NULL DEFAULT 0,
  total_bought  BIGINT NOT NULL DEFAULT 0,
  net           BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_player_table_stats_user
  ON player_table_stats(user_id);

-- Backfill global stats from existing hand + ledger history.
INSERT INTO player_global_stats (
  user_id, hands_played, hands_won, tables_played, biggest_win, biggest_pot,
  buyin_count, total_bought, net_lifetime, best_hand_rank
)
WITH hp AS (
  SELECT user_id,
         count(*)::int AS hands_played,
         count(*) FILTER (WHERE won)::int AS hands_won,
         count(DISTINCT table_id)::int AS tables_played,
         COALESCE(MAX(net), 0) AS biggest_win,
         COALESCE(SUM(net), 0) AS net_lifetime,
         MAX(best_hand_rank) AS best_hand_rank
    FROM hand_players
   GROUP BY user_id
),
pot AS (
  SELECT hp.user_id, COALESCE(MAX(h.pot), 0) AS biggest_pot
    FROM hand_players hp
    JOIN hands h ON h.id = hp.hand_id
   WHERE hp.won
   GROUP BY hp.user_id
),
le AS (
  SELECT user_id,
         count(*)::int AS buyin_count,
         COALESCE(SUM(-amount), 0) AS total_bought
    FROM ledger_entries
   WHERE type IN ('buy_in', 'topup')
   GROUP BY user_id
)
SELECT COALESCE(hp.user_id, le.user_id),
       COALESCE(hp.hands_played, 0),
       COALESCE(hp.hands_won, 0),
       COALESCE(hp.tables_played, 0),
       COALESCE(hp.biggest_win, 0),
       COALESCE(pot.biggest_pot, 0),
       COALESCE(le.buyin_count, 0),
       COALESCE(le.total_bought, 0),
       COALESCE(hp.net_lifetime, 0),
       hp.best_hand_rank
  FROM hp
  FULL OUTER JOIN le ON le.user_id = hp.user_id
  LEFT JOIN pot ON pot.user_id = COALESCE(hp.user_id, le.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- Backfill per-table stats.
INSERT INTO player_table_stats (
  table_id, user_id, hands_played, hands_won, net, buyin_count, total_bought
)
WITH hp AS (
  SELECT table_id, user_id,
         count(*)::int AS hands_played,
         count(*) FILTER (WHERE won)::int AS hands_won,
         COALESCE(SUM(net), 0) AS net
    FROM hand_players
   GROUP BY table_id, user_id
),
le AS (
  SELECT table_id, user_id,
         count(*)::int AS buyin_count,
         COALESCE(SUM(-amount), 0) AS total_bought
    FROM ledger_entries
   WHERE table_id IS NOT NULL AND type IN ('buy_in', 'topup')
   GROUP BY table_id, user_id
)
SELECT COALESCE(hp.table_id, le.table_id),
       COALESCE(hp.user_id, le.user_id),
       COALESCE(hp.hands_played, 0),
       COALESCE(hp.hands_won, 0),
       COALESCE(hp.net, 0),
       COALESCE(le.buyin_count, 0),
       COALESCE(le.total_bought, 0)
  FROM hp
  FULL OUTER JOIN le ON hp.table_id = le.table_id AND hp.user_id = le.user_id
ON CONFLICT (table_id, user_id) DO NOTHING;
