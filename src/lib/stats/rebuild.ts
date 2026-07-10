/**
 * Rebuild materialized player stats from source tables (hand_players, ledger_entries).
 * Use after migration backfill drift, manual DB edits, or cache corruption.
 */
import { getPool, tx } from "../db";

const GLOBAL_UPSERT = `
WITH hand_agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS hands_played,
    COUNT(*) FILTER (WHERE won)::int AS hands_won,
    COUNT(DISTINCT table_id)::int AS tables_played,
    COALESCE(MAX(net) FILTER (WHERE won), 0)::bigint AS biggest_win,
    COALESCE(MAX(pot_size), 0)::bigint AS biggest_pot,
    COALESCE(SUM(net), 0)::bigint AS net_lifetime,
    MAX(hand_rank) FILTER (WHERE hand_rank IS NOT NULL) AS best_hand_rank
  FROM hand_players
  WHERE ($1::uuid IS NULL OR user_id = $1)
  GROUP BY user_id
),
buyin_agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS buyin_count,
    COALESCE(SUM(amount), 0)::bigint AS total_bought
  FROM ledger_entries
  WHERE type IN ('buy_in', 'topup')
    AND ($1::uuid IS NULL OR user_id = $1)
  GROUP BY user_id
),
combined AS (
  SELECT
    COALESCE(h.user_id, b.user_id) AS user_id,
    COALESCE(h.hands_played, 0) AS hands_played,
    COALESCE(h.hands_won, 0) AS hands_won,
    COALESCE(h.tables_played, 0) AS tables_played,
    COALESCE(h.biggest_win, 0) AS biggest_win,
    COALESCE(h.biggest_pot, 0) AS biggest_pot,
    COALESCE(b.buyin_count, 0) AS buyin_count,
    COALESCE(b.total_bought, 0) AS total_bought,
    COALESCE(h.net_lifetime, 0) AS net_lifetime,
    h.best_hand_rank
  FROM hand_agg h
  FULL OUTER JOIN buyin_agg b USING (user_id)
)
INSERT INTO player_global_stats (
  user_id, hands_played, hands_won, tables_played,
  biggest_win, biggest_pot, buyin_count, total_bought, net_lifetime, best_hand_rank
)
SELECT
  user_id, hands_played, hands_won, tables_played,
  biggest_win, biggest_pot, buyin_count, total_bought, net_lifetime, best_hand_rank
FROM combined
ON CONFLICT (user_id) DO UPDATE SET
  hands_played = EXCLUDED.hands_played,
  hands_won = EXCLUDED.hands_won,
  tables_played = EXCLUDED.tables_played,
  biggest_win = EXCLUDED.biggest_win,
  biggest_pot = EXCLUDED.biggest_pot,
  buyin_count = EXCLUDED.buyin_count,
  total_bought = EXCLUDED.total_bought,
  net_lifetime = EXCLUDED.net_lifetime,
  best_hand_rank = EXCLUDED.best_hand_rank,
  updated_at = now()
`;

const TABLE_UPSERT = `
WITH hand_agg AS (
  SELECT
    table_id,
    user_id,
    COUNT(*)::int AS hands_played,
    COUNT(*) FILTER (WHERE won)::int AS hands_won,
    COALESCE(SUM(net), 0)::bigint AS net
  FROM hand_players
  WHERE ($1::uuid IS NULL OR user_id = $1)
  GROUP BY table_id, user_id
),
buyin_agg AS (
  SELECT
    table_id,
    user_id,
    COUNT(*)::int AS buyin_count,
    COALESCE(SUM(amount), 0)::bigint AS total_bought
  FROM ledger_entries
  WHERE type IN ('buy_in', 'topup')
    AND ($1::uuid IS NULL OR user_id = $1)
  GROUP BY table_id, user_id
),
combined AS (
  SELECT
    COALESCE(h.table_id, b.table_id) AS table_id,
    COALESCE(h.user_id, b.user_id) AS user_id,
    COALESCE(h.hands_played, 0) AS hands_played,
    COALESCE(h.hands_won, 0) AS hands_won,
    COALESCE(b.buyin_count, 0) AS buyin_count,
    COALESCE(b.total_bought, 0) AS total_bought,
    COALESCE(h.net, 0) AS net
  FROM hand_agg h
  FULL OUTER JOIN buyin_agg b USING (table_id, user_id)
)
INSERT INTO player_table_stats (
  table_id, user_id, hands_played, hands_won, buyin_count, total_bought, net
)
SELECT table_id, user_id, hands_played, hands_won, buyin_count, total_bought, net
FROM combined
ON CONFLICT (table_id, user_id) DO UPDATE SET
  hands_played = EXCLUDED.hands_played,
  hands_won = EXCLUDED.hands_won,
  buyin_count = EXCLUDED.buyin_count,
  total_bought = EXCLUDED.total_bought,
  net = EXCLUDED.net,
  updated_at = now()
`;

const DELETE_STALE_TABLE_STATS = `
DELETE FROM player_table_stats pts
WHERE ($1::uuid IS NULL OR pts.user_id = $1)
  AND NOT EXISTS (
    SELECT 1 FROM hand_players hp
     WHERE hp.user_id = pts.user_id AND hp.table_id = pts.table_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
     WHERE le.user_id = pts.user_id AND le.table_id = pts.table_id
       AND le.type IN ('buy_in', 'topup')
  )
`;

const DELETE_STALE_GLOBAL_STATS = `
DELETE FROM player_global_stats pgs
WHERE ($1::uuid IS NULL OR pgs.user_id = $1)
  AND NOT EXISTS (SELECT 1 FROM hand_players hp WHERE hp.user_id = pgs.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
     WHERE le.user_id = pgs.user_id AND le.type IN ('buy_in', 'topup')
  )
`;

export interface RebuildStatsResult {
  globalRows: number;
  tableRows: number;
  removedGlobal: number;
  removedTable: number;
}

/** Rebuild stats for every player (truncates cache when userId is omitted). */
export async function rebuildAllPlayerStats(): Promise<RebuildStatsResult> {
  return tx(async (client) => {
    await client.query("TRUNCATE player_global_stats, player_table_stats");
    const global = await client.query(GLOBAL_UPSERT, [null]);
    const table = await client.query(TABLE_UPSERT, [null]);
    return {
      globalRows: global.rowCount ?? 0,
      tableRows: table.rowCount ?? 0,
      removedGlobal: 0,
      removedTable: 0,
    };
  });
}

/** Rebuild stats for one player without touching other users' cache rows. */
export async function rebuildPlayerStats(userId: string): Promise<RebuildStatsResult> {
  return tx(async (client) => {
    const global = await client.query(GLOBAL_UPSERT, [userId]);
    const table = await client.query(TABLE_UPSERT, [userId]);
    const removedTable = await client.query(DELETE_STALE_TABLE_STATS, [userId]);
    const removedGlobal = await client.query(DELETE_STALE_GLOBAL_STATS, [userId]);
    return {
      globalRows: global.rowCount ?? 0,
      tableRows: table.rowCount ?? 0,
      removedGlobal: removedGlobal.rowCount ?? 0,
      removedTable: removedTable.rowCount ?? 0,
    };
  });
}

export interface StatsDriftRow {
  scope: "global" | "table";
  userId: string;
  tableId?: string;
  field: string;
  cached: string | number | null;
  expected: string | number | null;
}

const DRIFT_GLOBAL = `
WITH hand_agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS hands_played,
    COUNT(*) FILTER (WHERE won)::int AS hands_won,
    COUNT(DISTINCT table_id)::int AS tables_played,
    COALESCE(MAX(net) FILTER (WHERE won), 0)::bigint AS biggest_win,
    COALESCE(MAX(pot_size), 0)::bigint AS biggest_pot,
    COALESCE(SUM(net), 0)::bigint AS net_lifetime,
    MAX(hand_rank) FILTER (WHERE hand_rank IS NOT NULL) AS best_hand_rank
  FROM hand_players
  WHERE ($1::uuid IS NULL OR user_id = $1)
  GROUP BY user_id
),
buyin_agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS buyin_count,
    COALESCE(SUM(amount), 0)::bigint AS total_bought
  FROM ledger_entries
  WHERE type IN ('buy_in', 'topup')
    AND ($1::uuid IS NULL OR user_id = $1)
  GROUP BY user_id
),
expected AS (
  SELECT
    COALESCE(h.user_id, b.user_id) AS user_id,
    COALESCE(h.hands_played, 0) AS hands_played,
    COALESCE(h.hands_won, 0) AS hands_won,
    COALESCE(h.tables_played, 0) AS tables_played,
    COALESCE(h.biggest_win, 0) AS biggest_win,
    COALESCE(h.biggest_pot, 0) AS biggest_pot,
    COALESCE(b.buyin_count, 0) AS buyin_count,
    COALESCE(b.total_bought, 0) AS total_bought,
    COALESCE(h.net_lifetime, 0) AS net_lifetime,
    h.best_hand_rank
  FROM hand_agg h
  FULL OUTER JOIN buyin_agg b USING (user_id)
),
cached AS (
  SELECT * FROM player_global_stats
  WHERE ($1::uuid IS NULL OR user_id = $1)
)
SELECT
  COALESCE(c.user_id, e.user_id::text) AS user_id,
  'global'::text AS scope,
  NULL::text AS table_id,
  f.field,
  f.cached,
  f.expected
FROM cached c
FULL OUTER JOIN expected e ON e.user_id = c.user_id
CROSS JOIN LATERAL (
  VALUES
    ('hands_played', c.hands_played::text, e.hands_played::text),
    ('hands_won', c.hands_won::text, e.hands_won::text),
    ('tables_played', c.tables_played::text, e.tables_played::text),
    ('biggest_win', c.biggest_win::text, e.biggest_win::text),
    ('biggest_pot', c.biggest_pot::text, e.biggest_pot::text),
    ('buyin_count', c.buyin_count::text, e.buyin_count::text),
    ('total_bought', c.total_bought::text, e.total_bought::text),
    ('net_lifetime', c.net_lifetime::text, e.net_lifetime::text),
    ('best_hand_rank', c.best_hand_rank::text, e.best_hand_rank::text)
) AS f(field, cached, expected)
WHERE f.cached IS DISTINCT FROM f.expected
`;

const DRIFT_TABLE = `
WITH hand_agg AS (
  SELECT
    table_id,
    user_id,
    COUNT(*)::int AS hands_played,
    COUNT(*) FILTER (WHERE won)::int AS hands_won,
    COALESCE(SUM(net), 0)::bigint AS net
  FROM hand_players
  WHERE ($1::uuid IS NULL OR user_id = $1)
  GROUP BY table_id, user_id
),
buyin_agg AS (
  SELECT
    table_id,
    user_id,
    COUNT(*)::int AS buyin_count,
    COALESCE(SUM(amount), 0)::bigint AS total_bought
  FROM ledger_entries
  WHERE type IN ('buy_in', 'topup')
    AND ($1::uuid IS NULL OR user_id = $1)
  GROUP BY table_id, user_id
),
expected AS (
  SELECT
    COALESCE(h.table_id, b.table_id) AS table_id,
    COALESCE(h.user_id, b.user_id) AS user_id,
    COALESCE(h.hands_played, 0) AS hands_played,
    COALESCE(h.hands_won, 0) AS hands_won,
    COALESCE(b.buyin_count, 0) AS buyin_count,
    COALESCE(b.total_bought, 0) AS total_bought,
    COALESCE(h.net, 0) AS net
  FROM hand_agg h
  FULL OUTER JOIN buyin_agg b USING (table_id, user_id)
),
cached AS (
  SELECT * FROM player_table_stats
  WHERE ($1::uuid IS NULL OR user_id = $1)
)
SELECT
  COALESCE(c.user_id, e.user_id::text) AS user_id,
  'table'::text AS scope,
  COALESCE(c.table_id, e.table_id)::text AS table_id,
  f.field,
  f.cached,
  f.expected
FROM cached c
FULL OUTER JOIN expected e ON e.table_id = c.table_id AND e.user_id = c.user_id
CROSS JOIN LATERAL (
  VALUES
    ('hands_played', c.hands_played::text, e.hands_played::text),
    ('hands_won', c.hands_won::text, e.hands_won::text),
    ('buyin_count', c.buyin_count::text, e.buyin_count::text),
    ('total_bought', c.total_bought::text, e.total_bought::text),
    ('net', c.net::text, e.net::text)
) AS f(field, cached, expected)
WHERE f.cached IS DISTINCT FROM f.expected
`;

/** Compare cache vs source-derived stats without writing. */
export async function findStatsDrift(userId?: string): Promise<StatsDriftRow[]> {
  const pool = getPool();
  const param = userId ?? null;
  const [global, table] = await Promise.all([
    pool.query<{ user_id: string; scope: string; table_id: string | null; field: string; cached: string; expected: string }>(
      DRIFT_GLOBAL,
      [param]
    ),
    pool.query<{ user_id: string; scope: string; table_id: string | null; field: string; cached: string; expected: string }>(
      DRIFT_TABLE,
      [param]
    ),
  ]);
  return [...global.rows, ...table.rows].map((r) => ({
    scope: r.scope as "global" | "table",
    userId: r.user_id,
    tableId: r.table_id ?? undefined,
    field: r.field,
    cached: r.cached,
    expected: r.expected,
  }));
}
