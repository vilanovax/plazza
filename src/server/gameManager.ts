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
      this.loading.delete(tableId);
      return rt;
    })();

    this.loading.set(tableId, promise);
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

    // Debit the bank and seat the player atomically.
    await tx(async (client) => {
      await repo.applyLedgerTx(client, {
        userId,
        type: "buy_in",
        amount: -buyIn,
        tableId,
        note: `ورود به میز`,
      });
    });
    rt.game.sit(seatIndex, userId, user.display_name, buyIn);
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

    await repo.applyLedger({ userId, type: "topup", amount: -amount, tableId, note: "افزایش ژتون سر میز" });
    rt.game.topUp(seat.seatIndex, amount);
    await repo.updateSeatStack(tableId, seat.seatIndex, seat.stack);
    this.maybeStartHand(rt);
    await this.broadcast(tableId);
  }

  setConnected(tableId: string, userId: string, connected: boolean): void {
    const rt = this.tables.get(tableId);
    rt?.game.setConnected(userId, connected);
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
    // Persist hand result + final stacks.
    if (rt.currentHandId && g.lastResult) {
      try {
        await repo.finishHand(
          rt.currentHandId,
          g.community.map(cardToString),
          g.pot,
          g.lastResult.rake,
          g.lastResult.deckSeed,
          g.lastResult
        );
      } catch (err) {
        console.error("finishHand failed", err);
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
