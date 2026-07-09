/**
 * In-memory authority for every live table.
 *
 * There is exactly one HoldemGame per table, held here. Sockets and REST
 * handlers mutate tables only through this manager, which:
 *   - enforces think-time with server-side timers (auto fold/check),
 *   - persists hand history + the action audit trail,
 *   - moves chips between a player's bank (ledger) and their table stack,
 *   - broadcasts a personalised, sanitised state to each connected client.
 *
 * On restart, tables are rehydrated from table_seats (last hand-end stacks);
 * any hand interrupted by a crash is abandoned and committed chips revert.
 */
import type { Server as SocketIOServer } from "socket.io";
import { HoldemGame, InvalidActionError } from "../lib/poker/engine";
import { cardToString } from "../lib/poker/cards";
import type { PlayerAction, TableConfig } from "../lib/poker/types";
import { tx } from "../lib/db";
import * as repo from "../lib/repo";

const NEXT_HAND_DELAY_MS = 5000;

interface TableRuntime {
  game: HoldemGame;
  tableId: string;
  currentHandId?: string;
  actionTimer?: NodeJS.Timeout;
  nextHandTimer?: NodeJS.Timeout;
  /** Seats dealt into the current hand, captured for per-hand stats. */
  handParticipants?: Array<{ seatIndex: number; userId: string }>;
}

function room(tableId: string): string {
  return `table:${tableId}`;
}

export class GameManager {
  private io: SocketIOServer | null = null;
  private tables = new Map<string, TableRuntime>();
  private loading = new Map<string, Promise<TableRuntime>>();

  setIo(io: SocketIOServer): void {
    this.io = io;
  }

  // --------------------------------------------------------------------------
  // Loading / rehydration
  // --------------------------------------------------------------------------
  async ensureLoaded(tableId: string): Promise<TableRuntime> {
    const existing = this.tables.get(tableId);
    if (existing) return existing;
    const inflight = this.loading.get(tableId);
    if (inflight) return inflight;

    const promise = (async () => {
      const row = await repo.getTable(tableId);
      if (!row || row.status !== "open") throw new InvalidActionError("میز یافت نشد");
      const config = row.config as TableConfig;
      const game = new HoldemGame(tableId, config);
      const seats = await repo.listSeats(tableId);
      for (const s of seats) {
        if (s.user_id && s.stack > 0) {
          const user = await repo.getUserById(s.user_id);
          if (user) {
            const seat = game.seats[s.seat_index];
            seat.userId = user.id;
            seat.name = user.display_name;
            seat.stack = Number(s.stack);
            seat.status = "sitting_out";
          }
        }
      }
      const rt: TableRuntime = { game, tableId };
      this.tables.set(tableId, rt);
      return rt;
    })();

    this.loading.set(tableId, promise);
    // Always clear the in-flight entry, even on failure, so a transient DB
    // error doesn't permanently poison this table's load path.
    promise.finally(() => this.loading.delete(tableId));
    return promise;
  }

  getRuntime(tableId: string): TableRuntime | undefined {
    return this.tables.get(tableId);
  }

  // --------------------------------------------------------------------------
  // Seating (buy-in draws chips from the player's bank)
  // --------------------------------------------------------------------------
  async sit(tableId: string, userId: string, seatIndex: number, buyIn: number): Promise<void> {
    const rt = await this.ensureLoaded(tableId);
    const cfg = rt.game.config;
    if (buyIn < cfg.minBuyIn || buyIn > cfg.maxBuyIn) {
      throw new InvalidActionError(`مبلغ ورود باید بین ${cfg.minBuyIn} و ${cfg.maxBuyIn} باشد`);
    }
    const user = await repo.getUserById(userId);
    if (!user) throw new InvalidActionError("کاربر یافت نشد");
    if (user.chip_balance < buyIn) throw new InvalidActionError("موجودی ژتون شما کافی نیست");

    // Validate + mutate the in-memory seat FIRST (throws on an invalid seat).
    // Only once seating succeeds do we debit the bank, so a rejected sit can
    // never make chips disappear. If the debit then fails, undo the seat.
    rt.game.sit(seatIndex, userId, user.display_name, buyIn);
    try {
      await tx(async (client) => {
        await repo.applyLedgerTx(client, {
          userId,
          type: "buy_in",
          amount: -buyIn,
          tableId,
          note: `ورود به میز`,
        });
      });
    } catch (err) {
      rt.game.leave(seatIndex); // roll back the in-memory seat
      throw err;
    }
    await repo.upsertSeat(tableId, seatIndex, userId, buyIn, buyIn);

    this.maybeStartHand(rt);
    await this.broadcast(tableId);
  }

  /** Leave the table and return the remaining stack to the bank. */
  async leave(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (!seat) return;
    const seatIndex = seat.seatIndex;
    const chips = rt.game.leave(seatIndex);
    if (chips > 0) {
      await repo.applyLedger({ userId, type: "cash_out", amount: chips, tableId, note: "خروج از میز" });
    }
    await repo.removeSeat(tableId, seatIndex);
    await this.afterMutation(rt);
  }

  async topUp(tableId: string, userId: string, amount: number): Promise<void> {
    const rt = await this.ensureLoaded(tableId);
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (!seat) throw new InvalidActionError("شما سر این میز نیستید");
    const user = await repo.getUserById(userId);
    if (!user || user.chip_balance < amount) throw new InvalidActionError("موجودی ژتون کافی نیست");

    // Mutate in-memory first (validates limits / mid-hand rule and throws),
    // then debit the bank; roll back the stack if the debit fails.
    const stackBefore = seat.stack;
    rt.game.topUp(seat.seatIndex, amount);
    try {
      await repo.applyLedger({ userId, type: "topup", amount: -amount, tableId, note: "افزایش ژتون سر میز" });
    } catch (err) {
      seat.stack = stackBefore; // undo
      throw err;
    }
    await repo.updateSeatStack(tableId, seat.seatIndex, seat.stack);
    this.maybeStartHand(rt);
    await this.broadcast(tableId);
  }

  setConnected(tableId: string, userId: string, connected: boolean): void {
    const rt = this.tables.get(tableId);
    rt?.game.setConnected(userId, connected);
  }

  /**
   * Tear down a live table: refuse while a hand is in progress, otherwise cash
   * every seated player out to their bank, stop timers, and drop the runtime so
   * no further play is possible once the DB row is marked closed.
   */
  async closeTable(tableId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    const phase = rt.game.phase;
    if (phase !== "waiting" && phase !== "hand_complete") {
      throw new InvalidActionError("تا پایان دست جاری نمی‌توان میز را بست");
    }
    if (rt.actionTimer) clearTimeout(rt.actionTimer);
    if (rt.nextHandTimer) clearTimeout(rt.nextHandTimer);

    // Cash out each player atomically (ledger credit + seat removal in one
    // transaction). If any DB op fails we let it propagate WITHOUT deleting the
    // runtime, so no chips are ever silently lost and the admin can retry.
    for (const seat of rt.game.seats) {
      if (!seat.userId) continue;
      const userId = seat.userId;
      const chips = seat.stack;
      await tx(async (client) => {
        if (chips > 0) {
          await repo.applyLedgerTx(client, { userId, type: "cash_out", amount: chips, tableId, note: "بسته‌شدن میز" });
        }
        await client.query("DELETE FROM table_seats WHERE table_id = $1 AND seat_index = $2", [tableId, seat.seatIndex]);
      });
      rt.game.leave(seat.seatIndex); // only mutate in-memory once the DB commit succeeded
    }
    await this.broadcast(tableId);
    this.tables.delete(tableId);
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------
  async act(tableId: string, userId: string, action: PlayerAction): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    rt.game.act(userId, action); // throws InvalidActionError on illegal moves
    await this.recordLastAction(rt);
    await this.afterMutation(rt);
  }

  // --------------------------------------------------------------------------
  // Hand lifecycle
  // --------------------------------------------------------------------------
  private maybeStartHand(rt: TableRuntime): void {
    if (rt.nextHandTimer || rt.actionTimer) return;
    if (rt.game.canStartHand()) {
      rt.nextHandTimer = setTimeout(() => this.startHand(rt), NEXT_HAND_DELAY_MS);
    }
  }

  private async startHand(rt: TableRuntime): Promise<void> {
    rt.nextHandTimer = undefined;
    if (!rt.game.canStartHand()) return;
    rt.game.startHand();
    // Snapshot who was dealt into this hand (for per-player stats).
    rt.handParticipants = rt.game.seats
      .filter((s) => s.userId && (s.holeCards?.length ?? 0) === 2)
      .map((s) => ({ seatIndex: s.seatIndex, userId: s.userId as string }));
    try {
      rt.currentHandId = await repo.insertHand(
        rt.tableId,
        rt.game.handNo,
        rt.game.buttonSeat,
        rt.game.deckCommitment
      );
    } catch (err) {
      console.error("insertHand failed", err);
    }
    await this.afterMutation(rt);
  }

  private async recordLastAction(rt: TableRuntime): Promise<void> {
    const la = rt.game.lastAction;
    if (!la || !rt.currentHandId) return;
    const seat = rt.game.seats[la.seatIndex];
    try {
      await repo.insertAction(rt.currentHandId, la.seatIndex, seat?.userId ?? null, rt.game.phase, la.type, la.amount);
    } catch (err) {
      console.error("insertAction failed", err);
    }
  }

  /** After any state change: (re)arm timers, persist end-of-hand, broadcast. */
  private async afterMutation(rt: TableRuntime): Promise<void> {
    // Clear any pending action timer; we recompute below.
    if (rt.actionTimer) {
      clearTimeout(rt.actionTimer);
      rt.actionTimer = undefined;
    }

    if (rt.game.phase === "hand_complete") {
      await this.onHandEnd(rt);
    } else if (rt.game.currentTurnSeat !== null && rt.game.actionDeadline) {
      const delay = Math.max(0, rt.game.actionDeadline - Date.now());
      rt.actionTimer = setTimeout(() => this.onActionTimeout(rt), delay + 250);
    }

    await this.broadcast(rt.tableId);
  }

  private async onActionTimeout(rt: TableRuntime): Promise<void> {
    rt.actionTimer = undefined;
    rt.game.timeout();
    await this.recordLastAction(rt);
    await this.afterMutation(rt);
  }

  private async onHandEnd(rt: TableRuntime): Promise<void> {
    const g = rt.game;
    // Capture + clear immediately so this is at-most-once per hand even if
    // another path (e.g. leave) re-enters afterMutation while we await I/O.
    const handId = rt.currentHandId;
    const participants = rt.handParticipants;
    rt.currentHandId = undefined;
    rt.handParticipants = undefined;

    // Persist the hand result + per-player stats together (one transaction).
    if (handId && g.lastResult) {
      const result = g.lastResult;
      const rows = (participants ?? []).map((p) => {
        const winnings = result.pots.reduce(
          (sum, pot) => sum + pot.winners.filter((w) => w.seatIndex === p.seatIndex).reduce((a, w) => a + w.amount, 0),
          0
        );
        const seat = g.seats[p.seatIndex];
        const committed = seat && seat.userId === p.userId ? seat.committedThisHand : 0;
        const net = winnings - committed;
        // "Won" = actually profitable this hand (net > 0), correct for split/side pots.
        return { seatIndex: p.seatIndex, userId: p.userId, won: net > 0, net };
      });
      try {
        await tx(async (client) => {
          await repo.finishHandTx(client, handId, g.community.map(cardToString), g.pot, result.rake, result.deckSeed, result);
          await repo.insertHandPlayersTx(client, handId, rt.tableId, rows);
        });
      } catch (err) {
        console.error("persist hand failed", err);
      }
    }

    // Sync each occupied seat's stack to the DB (survives restart).
    for (const s of g.seats) {
      if (s.userId) {
        try {
          await repo.updateSeatStack(rt.tableId, s.seatIndex, s.stack);
        } catch {
          /* best effort */
        }
      }
    }
    rt.currentHandId = undefined;
    // Schedule the next hand.
    this.maybeStartHand(rt);
  }

  // --------------------------------------------------------------------------
  // Broadcasting
  // --------------------------------------------------------------------------
  async broadcast(tableId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt || !this.io) return;
    const sockets = await this.io.in(room(tableId)).fetchSockets();
    for (const s of sockets) {
      const uid = (s.data as { userId?: string }).userId ?? null;
      s.emit("state", rt.game.publicState(uid));
    }
  }
}

export const gameManager = new GameManager();
