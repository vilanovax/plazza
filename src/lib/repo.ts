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
  UserProfileRow,
} from "./models";
import type { ProfileFields } from "./profile/presets";
import type { TableConfig, LogEntry } from "./poker/types";
import type { BlindLevel, TournamentConfig } from "./tournament/types";
import { playableLevel } from "./tournament/types";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function getUserById(id: string): Promise<User | null> {
  return one<User>("SELECT * FROM users WHERE id = $1", [id]);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  return one<User>("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
}

export async function setDisplayName(userId: string, displayName: string): Promise<void> {
  await query("UPDATE users SET display_name = $2 WHERE id = $1", [userId, displayName]);
}

// ---------------------------------------------------------------------------
// Player profiles (cosmetic identity)
// ---------------------------------------------------------------------------
export async function getProfile(userId: string): Promise<UserProfileRow | null> {
  return one<UserProfileRow>("SELECT * FROM user_profiles WHERE user_id = $1", [userId]);
}

/** Fetch profiles for many users at once (table view). */
export async function getProfilesByIds(ids: string[]): Promise<UserProfileRow[]> {
  if (ids.length === 0) return [];
  return query<UserProfileRow>("SELECT * FROM user_profiles WHERE user_id = ANY($1)", [ids]);
}

/** Insert or replace a user's profile (fields already sanitized by the caller). */
export async function upsertProfile(userId: string, p: ProfileFields): Promise<UserProfileRow> {
  const row = await one<UserProfileRow>(
    `INSERT INTO user_profiles (user_id, avatar, tagline, title, favorite_cards, card_back, chip_color, emotes, stats_public, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (user_id) DO UPDATE SET
       avatar = EXCLUDED.avatar, tagline = EXCLUDED.tagline, title = EXCLUDED.title,
       favorite_cards = EXCLUDED.favorite_cards, card_back = EXCLUDED.card_back,
       chip_color = EXCLUDED.chip_color, emotes = EXCLUDED.emotes,
       stats_public = EXCLUDED.stats_public, updated_at = now()
     RETURNING *`,
    [userId, p.avatar, p.tagline, p.title, p.favorite_cards, p.card_back, p.chip_color, p.emotes, p.stats_public]
  );
  return row!;
}

export async function listUsers(): Promise<User[]> {
  return query<User>("SELECT * FROM users ORDER BY created_at DESC");
}

/** Fetch just the id/name of users by id (one round-trip). Projects only the
 *  public columns so sensitive fields (e.g. password_hash) never leave the DB. */
export async function getUsersByIds(
  ids: string[]
): Promise<Array<Pick<User, "id" | "username" | "display_name">>> {
  if (ids.length === 0) return [];
  return query<Pick<User, "id" | "username" | "display_name">>(
    "SELECT id, username, display_name FROM users WHERE id = ANY($1)",
    [ids]
  );
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

/** Returns true if a user row was actually updated (false if no such user). */
export async function setUserActive(userId: string, active: boolean): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id",
    [userId, active]
  );
  return rows.length > 0;
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
  if (input.type === "buy_in" || input.type === "topup") {
    await applyBuyInStatsTx(client, input.userId, input.tableId ?? null, input.amount);
  }
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

/** Per-user totals of admin chip credits (bank purchases). */
export interface ChipPurchaseSummaryRow {
  user_id: string;
  display_name: string;
  chip_balance: string;
  total_purchased: string;
  purchase_count: number;
}

export async function listChipPurchaseSummary(): Promise<ChipPurchaseSummaryRow[]> {
  return query<ChipPurchaseSummaryRow>(
    `SELECT u.id AS user_id,
            u.display_name,
            u.chip_balance::text,
            COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'admin_credit'), 0)::text AS total_purchased,
            COUNT(le.id) FILTER (WHERE le.type = 'admin_credit')::int AS purchase_count
       FROM users u
       LEFT JOIN ledger_entries le ON le.user_id = u.id AND le.type = 'admin_credit'
      WHERE u.is_active = TRUE
      GROUP BY u.id
      ORDER BY COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'admin_credit'), 0) DESC,
               u.display_name ASC`
  );
}

export interface ChipDepositRow {
  id: string;
  user_id: string;
  display_name: string;
  amount: string;
  note: string | null;
  settled: boolean;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

export async function listRecentChipDeposits(limit = 100): Promise<ChipDepositRow[]> {
  return query<ChipDepositRow>(
    `SELECT le.id,
            le.user_id,
            u.display_name,
            le.amount::text,
            le.note,
            le.settled,
            le.created_at,
            le.created_by,
            admin.display_name AS created_by_name
       FROM ledger_entries le
       JOIN users u ON u.id = le.user_id
       LEFT JOIN users admin ON admin.id = le.created_by
      WHERE le.type = 'admin_credit'
      ORDER BY le.created_at DESC
      LIMIT $1`,
    [limit]
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
// Admin settings (in-memory cache — single row, changes rarely)
// ---------------------------------------------------------------------------
let settingsCache: { value: AdminSettings; at: number } | null = null;
const SETTINGS_TTL_MS = 60_000;

export async function getSettings(): Promise<AdminSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const row = await one<AdminSettings>("SELECT * FROM admin_settings WHERE id = 1");
  settingsCache = { value: row!, at: Date.now() };
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
  settingsCache = { value: row!, at: Date.now() };
  return row!;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export async function createTable(
  name: string,
  config: TableConfig,
  createdBy: string | null,
  opts?: { isPrivate?: boolean; inviteCode?: string | null }
): Promise<PokerTableRow> {
  const row = await one<PokerTableRow>(
    `INSERT INTO poker_tables (name, config, created_by, is_private, invite_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, JSON.stringify(config), createdBy ?? null, opts?.isPrivate ?? false, opts?.inviteCode ?? null]
  );
  return row!;
}

export async function listOpenTables(): Promise<PokerTableRow[]> {
  return query<PokerTableRow>(
    "SELECT * FROM poker_tables WHERE status = 'open' AND tournament_id IS NULL ORDER BY created_at DESC"
  );
}

/** Open cash-game tables with seated counts in one query (lobby list). */
export async function listOpenTablesWithCounts(): Promise<
  Array<{ id: string; name: string; config: TableConfig; seated: number; maxSeats: number }>
> {
  const rows = await query<{ id: string; name: string; config: TableConfig; seated: string }>(
    `SELECT t.id,
            t.name,
            t.config,
            COUNT(s.user_id)::int AS seated
       FROM poker_tables t
       LEFT JOIN table_seats s ON s.table_id = t.id AND s.user_id IS NOT NULL
      WHERE t.status = 'open'
        AND t.tournament_id IS NULL
        AND t.is_private = FALSE
      GROUP BY t.id
      ORDER BY t.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    config: r.config,
    seated: Number(r.seated),
    maxSeats: r.config.maxSeats,
  }));
}

export async function getTableNamesByIds(ids: string[]): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  return query<{ id: string; name: string }>(
    "SELECT id, name FROM poker_tables WHERE id = ANY($1)",
    [ids]
  );
}

export async function getTable(id: string): Promise<PokerTableRow | null> {
  return one<PokerTableRow>("SELECT * FROM poker_tables WHERE id = $1", [id]);
}

/** Whether this table has ever dealt a hand (persists the first-hand ready gate
 *  across restarts, so an established table isn't re-gated after a reboot). */
export async function tableHasHands(tableId: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM hands WHERE table_id = $1) AS exists",
    [tableId]
  );
  return rows[0]?.exists === true;
}

// ---------------------------------------------------------------------------
// Audit log (append-only; see migration 0017)
// ---------------------------------------------------------------------------
export interface AuditEntry {
  correlationId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

const AUDIT_INSERT = `INSERT INTO audit_log (correlation_id, actor_id, action, target_type, target_id, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
const auditParams = (e: AuditEntry) => [
  e.correlationId ?? null,
  e.actorId ?? null,
  e.action,
  e.targetType ?? null,
  e.targetId ?? null,
  e.metadata ? JSON.stringify(e.metadata) : null,
  e.ip ?? null,
];

/**
 * Append a security/admin event, atomically inside an existing transaction.
 * THROWS on failure (rolls back the caller's tx) — use this for admin-critical
 * state changes (e.g. chip credits) so a state change never commits without its
 * audit record.
 */
export async function writeAuditTx(client: PoolClient, e: AuditEntry): Promise<void> {
  await client.query(AUDIT_INSERT, auditParams(e));
}

/** Append a security/admin event. Best-effort: never throws into the caller —
 *  a logging failure must not break the operation being audited. Use this for
 *  non-critical events (auth, settings) where losing one record is acceptable;
 *  use writeAuditTx for anything that must be atomic with a state change. */
export async function writeAudit(e: AuditEntry): Promise<void> {
  try {
    await query(AUDIT_INSERT, auditParams(e));
  } catch (err) {
    console.error("writeAudit failed", err);
  }
}

/** Search the audit log by actor, action, and/or time window (newest first). */
export async function searchAudit(filter: {
  actorId?: string;
  action?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, val: unknown) => { params.push(val); where.push(cond.replace("$?", `$${params.length}`)); };
  if (filter.actorId) add("actor_id = $?", filter.actorId);
  if (filter.action) add("action = $?", filter.action);
  if (filter.correlationId) add("correlation_id = $?", filter.correlationId);
  if (filter.since) add("created_at >= $?", filter.since);
  if (filter.until) add("created_at <= $?", filter.until);
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  return query<AuditRow>(
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
    params
  );
}

export interface AuditRow {
  id: string;
  correlation_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Table event feed (persisted so it survives a restart; see migration 0018)
// ---------------------------------------------------------------------------
export async function insertTableEvent(
  tableId: string,
  e: { seq: number; kind: string; text: string; authorUserId?: string | null; authorName?: string | null; ts: number }
): Promise<void> {
  try {
    await query(
      `INSERT INTO table_events (table_id, seq, kind, text, author_user_id, author_name, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tableId, e.seq, e.kind, e.text, e.authorUserId ?? null, e.authorName ?? null, e.ts]
    );
  } catch (err) {
    console.error("insertTableEvent failed", err);
  }
}

/** The most recent feed entries for a table, oldest-first (for rehydration). */
export async function recentTableEvents(tableId: string, limit = 60): Promise<LogEntry[]> {
  const rows = await query<{
    seq: number; kind: string; text: string; author_user_id: string | null; author_name: string | null; ts: string;
  }>(
    `SELECT seq, kind, text, author_user_id, author_name, ts
       FROM table_events WHERE table_id = $1 ORDER BY id DESC LIMIT $2`,
    [tableId, Math.min(200, Math.max(1, limit))]
  );
  return rows.reverse().map((r) => ({
    id: Number(r.seq),
    ts: Number(r.ts),
    text: r.text,
    kind: r.kind as LogEntry["kind"],
    author: r.author_user_id ? { userId: r.author_user_id, name: r.author_name ?? "بازیکن" } : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Table bans (persistent; see migration 0020)
// ---------------------------------------------------------------------------
/** Persist a table ban inside an existing transaction (atomic with its audit). */
export async function banFromTableTx(
  client: PoolClient,
  tableId: string,
  userId: string,
  bannedBy: string
): Promise<void> {
  await client.query(
    `INSERT INTO table_bans (table_id, user_id, banned_by) VALUES ($1, $2, $3)
     ON CONFLICT (table_id, user_id) DO NOTHING`,
    [tableId, userId, bannedBy]
  );
}

// ---------------------------------------------------------------------------
// User blocks (persistent, account-level; see migration 0021)
// ---------------------------------------------------------------------------
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) return;
  await query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [blockerId, blockedId]
  );
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  const rows = await query<{ blocked_id: string }>(
    "DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING blocked_id",
    [blockerId, blockedId]
  );
  return rows.length > 0;
}

export async function listBlockedIds(blockerId: string): Promise<string[]> {
  const rows = await query<{ blocked_id: string }>(
    "SELECT blocked_id FROM user_blocks WHERE blocker_id = $1",
    [blockerId]
  );
  return rows.map((r) => r.blocked_id);
}

// ---------------------------------------------------------------------------
// User reports (moderation; see migration 0022)
// ---------------------------------------------------------------------------
export interface ReportRow {
  id: string;
  reporter_id: string | null;
  reported_id: string;
  reason: string;
  table_id: string | null;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reporter_name?: string | null;
  reported_name?: string | null;
}

export async function createReport(input: {
  reporterId: string; reportedId: string; reason: string; tableId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO user_reports (reporter_id, reported_id, reason, table_id) VALUES ($1, $2, $3, $4)`,
    [input.reporterId, input.reportedId, input.reason, input.tableId ?? null]
  );
}

/** Reports for admin review, newest first, with reporter/reported display names. */
export async function listReports(status: string | null, limit = 100): Promise<ReportRow[]> {
  const lim = Math.min(500, Math.max(1, limit));
  const where = status ? "WHERE r.status = $1" : "";
  const params = status ? [status, lim] : [lim];
  return query<ReportRow>(
    `SELECT r.*, ru.display_name AS reporter_name, rd.display_name AS reported_name
       FROM user_reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN users rd ON rd.id = r.reported_id
       ${where}
      ORDER BY r.created_at DESC LIMIT $${status ? 2 : 1}`,
    params
  );
}

/** Resolve an open report inside a transaction; returns false if it was already
 *  reviewed/dismissed (so the caller can 409 and roll back its audit write). */
export async function resolveReportTx(
  client: PoolClient, id: string, status: "reviewed" | "dismissed", reviewerId: string
): Promise<boolean> {
  const res = await client.query(
    `UPDATE user_reports SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, status, reviewerId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function isBannedFromTable(tableId: string, userId: string): Promise<boolean> {
  const rows = await query<{ user_id: string }>(
    "SELECT user_id FROM table_bans WHERE table_id = $1 AND user_id = $2",
    [tableId, userId]
  );
  return rows.length > 0;
}

export async function closeTable(id: string): Promise<void> {
  await query("UPDATE poker_tables SET status = 'closed', closed_at = now() WHERE id = $1", [id]);
}

export async function updateTable(
  id: string,
  input: { name?: string; config?: TableConfig }
): Promise<PokerTableRow | null> {
  const row = await getTable(id);
  if (!row || row.status !== "open") return null;
  const name = input.name ?? row.name;
  const config = input.config ?? row.config;
  return one<PokerTableRow>(
    `UPDATE poker_tables SET name = $2, config = $3 WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, name, JSON.stringify(config)]
  );
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
  /** Made-hand category at showdown (0-8), or null if folded / no showdown. */
  bestHandRank?: number | null;
}

function handPlayersInsert(handId: string, tableId: string, rows: HandPlayerRow[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r) => {
    const b = values.length;
    values.push(handId, tableId, r.userId, r.seatIndex, r.won, r.net, r.bestHandRank ?? null);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
  });
  return {
    text: `INSERT INTO hand_players (hand_id, table_id, user_id, seat_index, won, net, best_hand_rank)
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
  rows: HandPlayerRow[],
  pot: number
): Promise<void> {
  if (rows.length === 0) return;
  const { text, values } = handPlayersInsert(handId, tableId, rows);
  const ins = await client.query(text, values);
  if (ins.rowCount === 0) return; // duplicate hand replay — don't double-count stats
  await applyHandStatsTx(client, tableId, pot, rows);
}

interface HandStatsRow {
  userId: string;
  won: boolean;
  net: number;
  bestHandRank?: number | null;
}

/** Increment denormalized stats after hand_players are persisted. */
export async function applyHandStatsTx(
  client: PoolClient,
  tableId: string,
  pot: number,
  rows: HandStatsRow[]
): Promise<void> {
  for (const r of rows) {
    const wonInc = r.won ? 1 : 0;
    const tableRes = await client.query<{ is_new: boolean }>(
      `INSERT INTO player_table_stats (table_id, user_id, hands_played, hands_won, net)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (table_id, user_id) DO UPDATE SET
         hands_played = player_table_stats.hands_played + 1,
         hands_won = player_table_stats.hands_won + EXCLUDED.hands_won,
         net = player_table_stats.net + EXCLUDED.net,
         updated_at = now()
       RETURNING (xmax = 0) AS is_new`,
      [tableId, r.userId, wonInc, r.net]
    );
    const isFirstAtTable = tableRes.rows[0]?.is_new === true;
    const bestRank = r.bestHandRank ?? null;
    await client.query(
      `INSERT INTO player_global_stats (
         user_id, hands_played, hands_won, tables_played, biggest_win, biggest_pot,
         net_lifetime, best_hand_rank
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         hands_played = player_global_stats.hands_played + 1,
         hands_won = player_global_stats.hands_won + $2,
         tables_played = player_global_stats.tables_played + $3,
         biggest_win = GREATEST(player_global_stats.biggest_win, $4),
         biggest_pot = GREATEST(
           player_global_stats.biggest_pot,
           CASE WHEN $2 > 0 THEN $5 ELSE 0 END
         ),
         net_lifetime = player_global_stats.net_lifetime + $6,
         best_hand_rank = CASE
           WHEN $7 IS NULL THEN player_global_stats.best_hand_rank
           WHEN player_global_stats.best_hand_rank IS NULL THEN $7
           ELSE GREATEST(player_global_stats.best_hand_rank, $7)
         END,
         updated_at = now()`,
      [r.userId, wonInc, isFirstAtTable ? 1 : 0, r.net, r.won ? pot : 0, r.net, bestRank]
    );
  }
}

/** Bump buy-in / top-up counters when chips leave the bank for a table. */
async function applyBuyInStatsTx(
  client: PoolClient,
  userId: string,
  tableId: string | null,
  amount: number
): Promise<void> {
  const bought = -amount;
  if (!Number.isFinite(bought) || bought <= 0) return;

  if (tableId) {
    await client.query(
      `INSERT INTO player_table_stats (table_id, user_id, buyin_count, total_bought)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (table_id, user_id) DO UPDATE SET
         buyin_count = player_table_stats.buyin_count + 1,
         total_bought = player_table_stats.total_bought + EXCLUDED.total_bought,
         updated_at = now()`,
      [tableId, userId, bought]
    );
  }

  await client.query(
    `INSERT INTO player_global_stats (user_id, buyin_count, total_bought)
     VALUES ($1, 1, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       buyin_count = player_global_stats.buyin_count + 1,
       total_bought = player_global_stats.total_bought + EXCLUDED.total_bought,
       updated_at = now()`,
    [userId, bought]
  );
}

export interface PlayerTableStats {
  handsPlayed: number;
  handsWon: number;
  buyInCount: number;
  totalBought: number;
  net: number;
}

/** Per-table statistics for one player (from materialized cache). */
export async function getPlayerTableStats(tableId: string, userId: string): Promise<PlayerTableStats> {
  const row = await one<{
    hands_played: number;
    hands_won: number;
    buyin_count: number;
    total_bought: string;
    net: string;
  }>(
    `SELECT hands_played, hands_won, buyin_count, total_bought, net
       FROM player_table_stats
      WHERE table_id = $1 AND user_id = $2`,
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

export interface GlobalPlayerStats {
  handsPlayed: number;
  handsWon: number;
  tablesPlayed: number;
  biggestWin: number;
  biggestPot: number;
  buyInCount: number;
  totalBought: number;
  netLifetime: number;
  /** Best made-hand category ever reached at showdown (0-8), or null. */
  bestHandRank: number | null;
}

/** Lifetime stats for a player across every table (from materialized cache). */
export async function getGlobalPlayerStats(userId: string): Promise<GlobalPlayerStats> {
  const row = await one<{
    hands_played: number;
    hands_won: number;
    tables_played: number;
    biggest_win: string;
    biggest_pot: string;
    buyin_count: number;
    total_bought: string;
    net_lifetime: string;
    best_hand_rank: number | null;
  }>(
    `SELECT hands_played, hands_won, tables_played, biggest_win, biggest_pot,
            buyin_count, total_bought, net_lifetime, best_hand_rank
       FROM player_global_stats
      WHERE user_id = $1`,
    [userId]
  );
  return {
    handsPlayed: Number(row?.hands_played ?? 0),
    handsWon: Number(row?.hands_won ?? 0),
    tablesPlayed: Number(row?.tables_played ?? 0),
    biggestWin: Number(row?.biggest_win ?? 0),
    biggestPot: Number(row?.biggest_pot ?? 0),
    buyInCount: Number(row?.buyin_count ?? 0),
    totalBought: Number(row?.total_bought ?? 0),
    netLifetime: Number(row?.net_lifetime ?? 0),
    bestHandRank: row?.best_hand_rank == null ? null : Number(row.best_hand_rank),
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

/** Tournaments plus their live participant counts in a single aggregate query.
 *  Counts only entries still in the field (registered/active) so the lobby's
 *  "N players" reflects who is actually in, not eliminated/finished entrants. */
export async function listTournamentsWithCounts(): Promise<Array<TournamentRow & { registered: number }>> {
  const rows = await query<TournamentRow & { registered: string }>(
    `SELECT t.*,
            COUNT(e.user_id) FILTER (WHERE e.status IN ('registered', 'active'))::int AS registered
       FROM tournaments t
       LEFT JOIN tournament_entries e ON e.tournament_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC`
  );
  return rows.map((r) => ({ ...r, registered: Number(r.registered) }));
}

export async function getTournamentByTable(tableId: string): Promise<TournamentRow | null> {
  // Match on either side of the (redundantly maintained) table<->tournament
  // link so a caller that set only one column can't break the lookup: the
  // tournaments.table_id column OR poker_tables.tournament_id back-reference.
  return one<TournamentRow>(
    `SELECT t.* FROM tournaments t
      WHERE t.table_id = $1
         OR t.id = (SELECT pt.tournament_id FROM poker_tables pt WHERE pt.id = $1)
      ORDER BY (t.table_id = $1) DESC
      LIMIT 1`,
    [tableId]
  );
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

/** Tournament ids the given user currently has an entry in (any status). */
export async function getUserTournamentIds(userId: string): Promise<string[]> {
  const rows = await query<{ tournament_id: string }>(
    "SELECT tournament_id FROM tournament_entries WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.tournament_id);
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
  if (!Number.isFinite(buyInChips) || buyInChips <= 0) {
    throw new Error("مبلغ ورودی تورنومنت نامعتبر است");
  }
  await tx(async (client) => {
    // Lock the tournament row so concurrent registrations serialise here: the
    // status/capacity re-checks below then see a consistent count.
    const trow = await client.query<{ status: string; max_players: number }>(
      "SELECT status, max_players FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId]
    );
    if (trow.rowCount === 0) throw new Error("تورنومنت یافت نشد");
    const tournament = trow.rows[0];

    if (isRebuy) {
      const up = await client.query(
        `UPDATE tournament_entries SET rebuys = rebuys + 1 WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, userId]
      );
      if (up.rowCount === 0) throw new Error("ورودی تورنومنت یافت نشد");
    } else {
      if (tournament.status !== "scheduled") throw new Error("ثبت‌نام این تورنومنت بسته است");
      const cnt = await client.query<{ n: string }>(
        "SELECT COUNT(*)::int AS n FROM tournament_entries WHERE tournament_id = $1",
        [tournamentId]
      );
      if (Number(cnt.rows[0].n) >= tournament.max_players) throw new Error("ظرفیت تورنومنت تکمیل است");
      // RETURNING lets us detect a duplicate registration (ON CONFLICT -> no row)
      // so we never debit the buy-in without actually creating an entry.
      const ins = await client.query(
        `INSERT INTO tournament_entries (tournament_id, user_id, status) VALUES ($1,$2,'registered')
         ON CONFLICT (tournament_id, user_id) DO NOTHING RETURNING user_id`,
        [tournamentId, userId]
      );
      if (ins.rowCount === 0) throw new Error("قبلاً ثبت‌نام کرده‌اید");
    }

    await applyLedgerTx(client, {
      userId,
      type: "buy_in",
      amount: -buyInChips,
      note: isRebuy ? "ری‌بای تورنومنت" : "ثبت‌نام تورنومنت",
    });
    await client.query("UPDATE tournaments SET prize_pool = prize_pool + $2 WHERE id = $1", [
      tournamentId,
      buyInChips,
    ]);
  });
}

/**
 * Late registration into a *running* tournament: atomically verify the late-reg
 * window + capacity, create an ACTIVE entry already holding the starting stack,
 * debit the buy-in, and grow the prize pool. Returns false if the window is
 * closed / full / already entered (caller then aborts without seating).
 */
export async function lateRegisterEntry(
  tournamentId: string,
  userId: string,
  buyInChips: number,
  startingStack: number,
  lateRegThroughLevel: number
): Promise<boolean> {
  if (!Number.isFinite(buyInChips) || buyInChips <= 0) throw new Error("مبلغ ورودی تورنومنت نامعتبر است");
  if (!Number.isFinite(startingStack) || startingStack <= 0) throw new Error("استک شروع نامعتبر است");
  return tx(async (client) => {
    // Read status, level AND the schedule under one FOR UPDATE lock so the
    // window is computed from a consistent, just-locked row (not a caller arg).
    const trow = await client.query<{ status: string; max_players: number; current_level: number; blind_schedule: BlindLevel[] }>(
      "SELECT status, max_players, current_level, blind_schedule FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId]
    );
    if (trow.rowCount === 0) throw new Error("تورنومنت یافت نشد");
    const t = trow.rows[0];
    if (t.status !== "running") throw new Error("تورنومنت در حال اجرا نیست");
    // Compare in playable levels (breaks don't count) against the just-locked
    // current_level, so the window can't close early nor be raced.
    const playable = playableLevel(t.blind_schedule, t.current_level);
    if (lateRegThroughLevel <= 0 || playable > lateRegThroughLevel) {
      throw new Error("مهلت ثبت‌نام با تأخیر به پایان رسیده است");
    }
    // Capacity is against players still in the field (registered/active).
    const cnt = await client.query<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM tournament_entries WHERE tournament_id = $1 AND status IN ('registered','active')",
      [tournamentId]
    );
    if (Number(cnt.rows[0].n) >= t.max_players) throw new Error("ظرفیت تورنومنت تکمیل است");
    const ins = await client.query(
      `INSERT INTO tournament_entries (tournament_id, user_id, status, chips) VALUES ($1,$2,'active',$3)
       ON CONFLICT (tournament_id, user_id) DO NOTHING RETURNING user_id`,
      [tournamentId, userId, startingStack]
    );
    if (ins.rowCount === 0) throw new Error("قبلاً ثبت‌نام کرده‌اید");
    await applyLedgerTx(client, { userId, type: "buy_in", amount: -buyInChips, note: "ثبت‌نام با تأخیر تورنومنت" });
    await client.query("UPDATE tournaments SET prize_pool = prize_pool + $2 WHERE id = $1", [tournamentId, buyInChips]);
    return true;
  });
}

const ENTRY_COLUMNS = new Set(["chips", "place", "status"]);
export async function setEntry(
  tournamentId: string,
  userId: string,
  patch: { chips?: number; place?: number | null; status?: string }
): Promise<void> {
  // Allowlist column names before interpolating them into SQL (defense-in-depth,
  // matching updateSettings / updateTournament).
  const keys = Object.keys(patch).filter((k) => ENTRY_COLUMNS.has(k));
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
    const res = await client.query(
      `UPDATE tournament_entries SET prize = $3, place = $4, status = $5 WHERE tournament_id = $1 AND user_id = $2`,
      [tournamentId, userId, amount, place, status]
    );
    // If the entry row is missing we must not silently credit the bank with no
    // record of the payout — roll the whole transaction back.
    if (res.rowCount === 0) throw new Error("ثبت جایزه ناموفق بود: ورودی یافت نشد");
  });
}

export async function setTableTournament(tableId: string, tournamentId: string): Promise<void> {
  await query("UPDATE poker_tables SET tournament_id = $2 WHERE id = $1", [tableId, tournamentId]);
}

/**
 * Atomically claim the payout/finish phase for a tournament. Flips a still-
 * running tournament to `finishing` and returns true to exactly one caller;
 * concurrent or repeat callers get false and must not distribute prizes again.
 */
export async function claimTournamentFinish(id: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    "UPDATE tournaments SET status = 'finishing' WHERE id = $1 AND status = 'running' RETURNING id",
    [id]
  );
  return row != null;
}

export { getPool };
