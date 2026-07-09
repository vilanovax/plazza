/**
 * Data access layer. All chip movements go through applyLedger() so the
 * user's bank balance and the ledger history can never drift apart.
 */
import type { PoolClient } from "pg";
import { query, one, tx, getPool } from "./db";
import type {
  AdminSettings,
  LedgerEntry,
  LedgerType,
  PokerTableRow,
  TopupRequest,
  TournamentRow,
  TournamentEntryRow,
  User,
} from "./models";
import type { TableConfig } from "./poker/types";
import type { BlindLevel, TournamentConfig } from "./tournament/types";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function getUserById(id: string): Promise<User | null> {
  return one<User>("SELECT * FROM users WHERE id = $1", [id]);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  return one<User>("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
}

export async function listUsers(): Promise<User[]> {
  return query<User>("SELECT * FROM users ORDER BY created_at DESC");
}

export async function createUser(
  username: string,
  passwordHash: string,
  displayName: string,
  role: "admin" | "player" = "player"
): Promise<User> {
  const row = await one<User>(
    `INSERT INTO users (username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [username, passwordHash, displayName, role]
  );
  return row!;
}

export async function getPasswordHash(userId: string): Promise<string | null> {
  const row = await one<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId]
  );
  return row?.password_hash ?? null;
}

export async function setPasswordHash(userId: string, hash: string): Promise<void> {
  await query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, hash]);
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await query("UPDATE users SET is_active = $2 WHERE id = $1", [userId, active]);
}

// ---------------------------------------------------------------------------
// Ledger — the single source of truth for chip movements
// ---------------------------------------------------------------------------
export interface LedgerInput {
  userId: string;
  type: LedgerType;
  amount: number; // signed
  tableId?: string | null;
  handId?: string | null;
  counterpartyId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

/** Apply a ledger entry inside an existing transaction, updating the bank balance. */
export async function applyLedgerTx(client: PoolClient, input: LedgerInput): Promise<LedgerEntry> {
  const balRow = await client.query<{ chip_balance: string }>(
    "UPDATE users SET chip_balance = chip_balance + $2 WHERE id = $1 RETURNING chip_balance",
    [input.userId, input.amount]
  );
  if (balRow.rowCount === 0) throw new Error("User not found for ledger entry");
  const balanceAfter = Number(balRow.rows[0].chip_balance);
  if (balanceAfter < 0) throw new Error("موجودی کافی نیست");

  const res = await client.query<LedgerEntry>(
    `INSERT INTO ledger_entries
       (user_id, type, amount, balance_after, table_id, hand_id, counterparty_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      input.userId,
      input.type,
      input.amount,
      balanceAfter,
      input.tableId ?? null,
      input.handId ?? null,
      input.counterpartyId ?? null,
      input.note ?? null,
      input.createdBy ?? null,
    ]
  );
  return res.rows[0];
}

/** Standalone ledger entry (wraps its own transaction). */
export async function applyLedger(input: LedgerInput): Promise<LedgerEntry> {
  return tx((client) => applyLedgerTx(client, input));
}

export async function listLedger(userId: string, limit = 100): Promise<LedgerEntry[]> {
  return query<LedgerEntry>(
    "SELECT * FROM ledger_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit]
  );
}

export async function listAllLedger(limit = 500): Promise<LedgerEntry[]> {
  return query<LedgerEntry>("SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT $1", [limit]);
}

export async function setLedgerSettled(
  entryId: string,
  settled: boolean,
  adminId: string
): Promise<void> {
  await query(
    `UPDATE ledger_entries
       SET settled = $2, settled_by = $3, settled_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1`,
    [entryId, settled, adminId]
  );
}

/** Net unsettled balance per counterparty pair — "who owes whom". */
export interface SettlementRow {
  user_id: string;
  username: string;
  display_name: string;
  net: number; // sum of unsettled signed amounts
}
export async function unsettledSummary(): Promise<SettlementRow[]> {
  const rows = await query<{ user_id: string; username: string; display_name: string; net: string }>(
    `SELECT u.id AS user_id, u.username, u.display_name,
            COALESCE(SUM(l.amount), 0)::bigint AS net
       FROM users u
       LEFT JOIN ledger_entries l ON l.user_id = u.id AND l.settled = FALSE
      GROUP BY u.id
      ORDER BY net ASC`
  );
  // pg returns bigint (OID 20) as a string; parse so callers get real numbers.
  return rows.map((r) => ({ ...r, net: Number(r.net) }));
}

// ---------------------------------------------------------------------------
// Admin settings
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<AdminSettings> {
  const row = await one<AdminSettings>("SELECT * FROM admin_settings WHERE id = 1");
  return row!;
}

const SETTINGS_COLUMNS = new Set<string>([
  "default_small_blind",
  "default_big_blind",
  "default_rake_percent",
  "default_rake_cap",
  "default_think_time_sec",
  "default_min_buyin",
  "default_max_buyin",
  "allow_self_topup",
  "topup_min",
  "topup_max",
  "allow_self_register",
  "sit_out_max_min",
  "extra_time_sec",
  "extra_time_requests",
]);

export async function updateSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  // Defense in depth: only ever interpolate known column names into the SQL,
  // regardless of what any caller passes.
  const keys = Object.keys(patch).filter((k) => SETTINGS_COLUMNS.has(k));
  if (keys.length === 0) return getSettings();
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
  const row = await one<AdminSettings>(
    `UPDATE admin_settings SET ${set}, updated_at = now() WHERE id = 1 RETURNING *`,
    values
  );
  return row!;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export async function createTable(
  name: string,
  config: TableConfig,
  createdBy: string
): Promise<PokerTableRow> {
  const row = await one<PokerTableRow>(
    `INSERT INTO poker_tables (name, config, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [name, JSON.stringify(config), createdBy]
  );
  return row!;
}

export async function listOpenTables(): Promise<PokerTableRow[]> {
  return query<PokerTableRow>(
    "SELECT * FROM poker_tables WHERE status = 'open' ORDER BY created_at DESC"
  );
}

export async function getTable(id: string): Promise<PokerTableRow | null> {
  return one<PokerTableRow>("SELECT * FROM poker_tables WHERE id = $1", [id]);
}

export async function closeTable(id: string): Promise<void> {
  await query("UPDATE poker_tables SET status = 'closed', closed_at = now() WHERE id = $1", [id]);
}

// Persisted seat occupancy -------------------------------------------------
export async function upsertSeat(
  tableId: string,
  seatIndex: number,
  userId: string,
  stack: number,
  buyIn: number
): Promise<void> {
  await query(
    `INSERT INTO table_seats (table_id, seat_index, user_id, stack, buy_in)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (table_id, seat_index)
     DO UPDATE SET user_id = $3, stack = $4, buy_in = $5`,
    [tableId, seatIndex, userId, stack, buyIn]
  );
}

export async function updateSeatStack(tableId: string, seatIndex: number, stack: number) {
  await query("UPDATE table_seats SET stack = $3 WHERE table_id = $1 AND seat_index = $2", [
    tableId,
    seatIndex,
    stack,
  ]);
}

export async function removeSeat(tableId: string, seatIndex: number): Promise<void> {
  await query("DELETE FROM table_seats WHERE table_id = $1 AND seat_index = $2", [tableId, seatIndex]);
}

export async function listSeats(tableId: string) {
  return query<{ table_id: string; seat_index: number; user_id: string; stack: number; buy_in: number }>(
    "SELECT * FROM table_seats WHERE table_id = $1 ORDER BY seat_index",
    [tableId]
  );
}

// ---------------------------------------------------------------------------
// Top-up requests
// ---------------------------------------------------------------------------
export async function createTopup(
  userId: string,
  tableId: string,
  seatIndex: number | null,
  amount: number
): Promise<TopupRequest> {
  const row = await one<TopupRequest>(
    `INSERT INTO topup_requests (user_id, table_id, seat_index, amount)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, tableId, seatIndex, amount]
  );
  return row!;
}

export async function listPendingTopups(): Promise<TopupRequest[]> {
  return query<TopupRequest>(
    "SELECT * FROM topup_requests WHERE status = 'pending' ORDER BY created_at ASC"
  );
}

export async function getTopup(id: string): Promise<TopupRequest | null> {
  return one<TopupRequest>("SELECT * FROM topup_requests WHERE id = $1", [id]);
}

/** Revert a claimed request back to pending (used when applying chips fails). */
export async function reopenTopup(id: string): Promise<void> {
  await query(
    "UPDATE topup_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1",
    [id]
  );
}

/**
 * Atomically claim a still-pending request and set its decision. Returns true
 * only if THIS call transitioned it out of 'pending' — so a double-submit can
 * never apply the same top-up twice.
 */
export async function decideTopup(
  id: string,
  status: "approved" | "rejected",
  adminId: string
): Promise<boolean> {
  const rows = await query(
    `UPDATE topup_requests SET status = $2, decided_by = $3, decided_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id, status, adminId]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Hands (persist history for audit)
// ---------------------------------------------------------------------------
export async function insertHand(
  tableId: string,
  handNo: number,
  buttonSeat: number,
  deckCommitment: string | undefined
): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO hands (table_id, hand_no, button_seat, deck_commitment)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [tableId, handNo, buttonSeat, deckCommitment ?? null]
  );
  return row!.id;
}

const FINISH_HAND_SQL = `UPDATE hands SET community = $2, pot = $3, rake = $4, deck_seed = $5, result = $6, ended_at = now()
     WHERE id = $1`;

function finishHandParams(
  handId: string,
  community: string[],
  pot: number,
  rake: number,
  deckSeed: string | undefined,
  result: unknown
): unknown[] {
  return [handId, community, pot, rake, deckSeed ?? null, JSON.stringify(result)];
}

/** Re-persist only the result JSON of a *finished* hand (late card reveal). */
export async function updateHandResult(handId: string, result: unknown): Promise<void> {
  const rows = await query(
    "UPDATE hands SET result = $2 WHERE id = $1 AND ended_at IS NOT NULL RETURNING id",
    [handId, JSON.stringify(result)]
  );
  if (rows.length === 0) {
    throw new Error(`updateHandResult: no finished hand ${handId}`);
  }
}

export async function finishHandTx(
  client: PoolClient,
  handId: string,
  community: string[],
  pot: number,
  rake: number,
  deckSeed: string | undefined,
  result: unknown
): Promise<void> {
  await client.query(FINISH_HAND_SQL, finishHandParams(handId, community, pot, rake, deckSeed, result));
}

export interface HandPlayerRow {
  seatIndex: number;
  userId: string;
  won: boolean;
  net: number;
}

function handPlayersInsert(handId: string, tableId: string, rows: HandPlayerRow[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const b = i * 4;
    values.push(handId, tableId, r.userId, r.seatIndex);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${rows.length * 4 + i * 2 + 1}, $${rows.length * 4 + i * 2 + 2})`;
  });
  for (const r of rows) values.push(r.won, r.net);
  return {
    text: `INSERT INTO hand_players (hand_id, table_id, user_id, seat_index, won, net)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (hand_id, seat_index) DO NOTHING`,
    values,
  };
}

/** Record every dealt-in player of a finished hand (for stats). */
export async function insertHandPlayersTx(
  client: PoolClient,
  handId: string,
  tableId: string,
  rows: HandPlayerRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const { text, values } = handPlayersInsert(handId, tableId, rows);
  await client.query(text, values);
}

export interface PlayerTableStats {
  handsPlayed: number;
  handsWon: number;
  buyInCount: number;
  totalBought: number;
  net: number;
}

/** Per-table statistics for one player. */
export async function getPlayerTableStats(tableId: string, userId: string): Promise<PlayerTableStats> {
  const row = await one<{
    hands_played: string;
    hands_won: string;
    buyin_count: string;
    total_bought: string;
    net: string;
  }>(
    `SELECT
       (SELECT count(*) FROM hand_players WHERE table_id = $1 AND user_id = $2) AS hands_played,
       (SELECT count(*) FROM hand_players WHERE table_id = $1 AND user_id = $2 AND won) AS hands_won,
       (SELECT count(*) FROM ledger_entries WHERE table_id = $1 AND user_id = $2 AND type IN ('buy_in','topup')) AS buyin_count,
       (SELECT COALESCE(SUM(-amount),0) FROM ledger_entries WHERE table_id = $1 AND user_id = $2 AND type IN ('buy_in','topup')) AS total_bought,
       (SELECT COALESCE(SUM(net),0) FROM hand_players WHERE table_id = $1 AND user_id = $2) AS net`,
    [tableId, userId]
  );
  return {
    handsPlayed: Number(row?.hands_played ?? 0),
    handsWon: Number(row?.hands_won ?? 0),
    buyInCount: Number(row?.buyin_count ?? 0),
    totalBought: Number(row?.total_bought ?? 0),
    net: Number(row?.net ?? 0),
  };
}

export async function insertAction(
  handId: string,
  seatIndex: number,
  userId: string | null,
  phase: string,
  action: string,
  amount: number
): Promise<void> {
  await query(
    `INSERT INTO hand_actions (hand_id, seat_index, user_id, phase, action, amount)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [handId, seatIndex, userId, phase, action, amount]
  );
}

// ---------------------------------------------------------------------------
// Tournaments (single-table Sit & Go)
// ---------------------------------------------------------------------------
export async function createTournament(input: {
  name: string;
  buyInChips: number;
  startingStack: number;
  maxPlayers: number;
  blindSchedule: BlindLevel[];
  config: TournamentConfig;
  createdBy: string;
}): Promise<TournamentRow> {
  const row = await one<TournamentRow>(
    `INSERT INTO tournaments (name, buy_in_chips, starting_stack, max_players, blind_schedule, config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      input.name,
      input.buyInChips,
      input.startingStack,
      input.maxPlayers,
      JSON.stringify(input.blindSchedule),
      JSON.stringify(input.config),
      input.createdBy,
    ]
  );
  return row!;
}

export async function listTournaments(statuses?: string[]): Promise<TournamentRow[]> {
  if (statuses && statuses.length) {
    return query<TournamentRow>(
      `SELECT * FROM tournaments WHERE status = ANY($1) ORDER BY created_at DESC`,
      [statuses]
    );
  }
  return query<TournamentRow>("SELECT * FROM tournaments ORDER BY created_at DESC");
}

export async function getTournament(id: string): Promise<TournamentRow | null> {
  return one<TournamentRow>("SELECT * FROM tournaments WHERE id = $1", [id]);
}

export async function getTournamentByTable(tableId: string): Promise<TournamentRow | null> {
  return one<TournamentRow>("SELECT * FROM tournaments WHERE table_id = $1", [tableId]);
}

export async function updateTournament(id: string, patch: Record<string, unknown>): Promise<void> {
  const allowed = new Set([
    "status",
    "prize_pool",
    "current_level",
    "table_id",
    "level_ends_at",
    "started_at",
    "finished_at",
  ]);
  const keys = Object.keys(patch).filter((k) => allowed.has(k));
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await query(`UPDATE tournaments SET ${set} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

export async function listEntries(tournamentId: string): Promise<TournamentEntryRow[]> {
  return query<TournamentEntryRow>(
    "SELECT * FROM tournament_entries WHERE tournament_id = $1 ORDER BY registered_at ASC",
    [tournamentId]
  );
}

export async function getEntry(tournamentId: string, userId: string): Promise<TournamentEntryRow | null> {
  return one<TournamentEntryRow>(
    "SELECT * FROM tournament_entries WHERE tournament_id = $1 AND user_id = $2",
    [tournamentId, userId]
  );
}

/** Register (or re-buy for) a player: debit bank + add to prize pool atomically. */
export async function buyIntoTournament(
  tournamentId: string,
  userId: string,
  buyInChips: number,
  isRebuy: boolean
): Promise<void> {
  await tx(async (client) => {
    await applyLedgerTx(client, {
      userId,
      type: "buy_in",
      amount: -buyInChips,
      note: isRebuy ? "ری‌بای تورنومنت" : "ثبت‌نام تورنومنت",
    });
    if (isRebuy) {
      await client.query(
        `UPDATE tournament_entries SET rebuys = rebuys + 1 WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, userId]
      );
    } else {
      await client.query(
        `INSERT INTO tournament_entries (tournament_id, user_id, status) VALUES ($1,$2,'registered')
         ON CONFLICT (tournament_id, user_id) DO NOTHING`,
        [tournamentId, userId]
      );
    }
    await client.query("UPDATE tournaments SET prize_pool = prize_pool + $2 WHERE id = $1", [
      tournamentId,
      buyInChips,
    ]);
  });
}

export async function setEntry(
  tournamentId: string,
  userId: string,
  patch: { chips?: number; place?: number | null; status?: string }
): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
  await query(
    `UPDATE tournament_entries SET ${set} WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, userId, ...keys.map((k) => (patch as Record<string, unknown>)[k])]
  );
}

/** Award a prize: credit the bank and record it on the entry (one transaction). */
export async function awardPrize(
  tournamentId: string,
  userId: string,
  amount: number,
  place: number,
  status: "busted" | "winner"
): Promise<void> {
  await tx(async (client) => {
    if (amount > 0) {
      await applyLedgerTx(client, { userId, type: "win", amount, tableId: null, note: `جایزه تورنومنت (رتبه ${place})` });
    }
    await client.query(
      `UPDATE tournament_entries SET prize = $3, place = $4, status = $5 WHERE tournament_id = $1 AND user_id = $2`,
      [tournamentId, userId, amount, place, status]
    );
  });
}

export async function setTableTournament(tableId: string, tournamentId: string): Promise<void> {
  await query("UPDATE poker_tables SET tournament_id = $2 WHERE id = $1", [tableId, tournamentId]);
}

export { getPool };
