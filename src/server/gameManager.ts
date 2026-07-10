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
import type { Server as SocketIOServer, Socket } from "socket.io";
import { HoldemGame, InvalidActionError } from "../lib/poker/engine";
import { cardToString } from "../lib/poker/cards";
import { evaluate } from "../lib/poker/evaluator";
import type { LogEntry, PlayerAction, TableConfig } from "../lib/poker/types";
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
  /** Id of the most recently finished hand (for late reveal persistence). */
  lastHandId?: string;
  /** Rolling table event feed. */
  log: LogEntry[];
  logSeq: number;
  /** Per-user auto-removal timers for players who sit out too long. */
  sitOutTimers: Map<string, NodeJS.Timeout>;
  /** True when this table backs a tournament (disables voluntary sit-out). */
  isTournament: boolean;
  /** When true, no new hands are dealt (e.g. a scheduled tournament break). */
  paused?: boolean;
  /** Cached cosmetic profiles for seated players (attached to broadcasts). */
  profiles: Map<string, { avatar: string; title: string; tagline: string; chipColor: string; cardBack: string }>;
}

const LOG_CAP = 60;

export class GameManager {
  private io: SocketIOServer | null = null;
  private tables = new Map<string, TableRuntime>();
  private loading = new Map<string, Promise<TableRuntime>>();
  /** Live sockets per table room — avoids fetchSockets() on every broadcast. */
  private roomSockets = new Map<string, Set<Socket>>();
  /** Optional hook fired after a hand fully settles (used by tournaments). */
  onHandEndHook?: (tableId: string) => void;

  setIo(io: SocketIOServer): void {
    this.io = io;
  }

  /** Track a socket that joined a table room (called from the join handler). */
  registerSocket(tableId: string, socket: Socket): void {
    let set = this.roomSockets.get(tableId);
    if (!set) {
      set = new Set();
      this.roomSockets.set(tableId, set);
    }
    set.add(socket);
  }

  /** Drop a socket from the table room registry (disconnect or table switch). */
  unregisterSocket(tableId: string, socket: Socket): void {
    const set = this.roomSockets.get(tableId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.roomSockets.delete(tableId);
  }

  private dropTableRuntime(tableId: string): void {
    this.roomSockets.delete(tableId);
    this.tables.delete(tableId);
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
      const activeSeatUserIds = seats
        .filter((s) => s.user_id && s.stack > 0)
        .map((s) => s.user_id!);
      const [users, profiles] = await Promise.all([
        repo.getUsersByIds(activeSeatUserIds),
        repo.getProfilesByIds(activeSeatUserIds),
      ]);
      const userMap = new Map(users.map((u) => [u.id, u]));
      const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
      for (const s of seats) {
        if (s.user_id && s.stack > 0) {
          const user = userMap.get(s.user_id);
          if (user) {
            const seat = game.seats[s.seat_index];
            seat.userId = user.id;
            seat.name = user.display_name;
            seat.stack = Number(s.stack);
            seat.status = "sitting_out";
          }
        }
      }
      const rt: TableRuntime = {
        game,
        tableId,
        log: [],
        logSeq: 0,
        sitOutTimers: new Map(),
        isTournament: row.tournament_id != null,
        profiles: new Map(),
      };
      for (const uid of activeSeatUserIds) {
        const p = profileMap.get(uid);
        rt.profiles.set(uid, {
          avatar: p?.avatar ?? "",
          title: p?.title ?? "",
          tagline: p?.tagline ?? "",
          chipColor: p?.chip_color ?? "",
          cardBack: p?.card_back ?? "",
        });
      }
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
    // Tournament seats are filled only through registration/seatTournamentPlayer;
    // the cash buy-in path must never debit the bank for a tournament table.
    if (rt.isTournament) throw new InvalidActionError("صندلی‌های تورنومنت از راه ثبت‌نام پر می‌شوند");
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
    await this.cacheProfile(rt, userId);

    this.pushLog(rt, `${user.display_name} با ${buyIn.toLocaleString("fa")} ژتون به میز اضافه شد`);
    this.maybeStartHand(rt);
    this.broadcast(tableId);
  }

  /**
   * Core seat removal: fold+remove the seat, optionally cash the stack back to
   * the bank, clear the sit-out timer. Does NOT log or broadcast — callers do
   * that once with an accurate message.
   */
  private async removeSeatCore(rt: TableRuntime, userId: string, cashOut: boolean): Promise<string | null> {
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (!seat) return null;
    const name = seat.name ?? "بازیکن";
    const chips = rt.game.leave(seat.seatIndex);
    if (cashOut && chips > 0) {
      await repo.applyLedger({ userId, type: "cash_out", amount: chips, tableId: rt.tableId, note: "خروج از میز" });
    }
    await repo.removeSeat(rt.tableId, seat.seatIndex);
    this.clearSitOutTimer(rt, userId);
    rt.profiles.delete(userId); // keep the cosmetic cache scoped to seated players
    return name;
  }

  /** Leave the table and return the remaining stack to the bank. */
  async leave(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    // In a tournament, play chips are not bank chips — cashing them out via
    // leave() would credit the real ledger. Players play or bust; no leaving.
    if (rt.isTournament) throw new InvalidActionError("در تورنومنت نمی‌توانید میز را ترک کنید");
    const name = await this.removeSeatCore(rt, userId, true);
    if (name === null) return;
    this.pushLog(rt, `${name} میز را ترک کرد`);
    await this.afterMutation(rt);
  }

  async topUp(tableId: string, userId: string, amount: number): Promise<void> {
    const rt = await this.ensureLoaded(tableId);
    // Tournament stacks change only via blinds/pots/rebuy — never a bank top-up.
    if (rt.isTournament) throw new InvalidActionError("در تورنومنت فقط ری‌بای ممکن است");
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
    this.pushLog(rt, `${seat.name ?? "بازیکن"} مقدار ${amount.toLocaleString("fa")} ژتون خرید`);
    this.maybeStartHand(rt);
    this.broadcast(tableId);
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
    // A tournament table is torn down by the tournament lifecycle (teardownTable),
    // which does NOT cash play chips to the bank. Block the cash-out close path —
    // even when the runtime isn't loaded (e.g. after a restart), by consulting
    // the DB so an unloaded state can't bypass the guard.
    if (!rt) {
      const row = await repo.getTable(tableId);
      if (row?.tournament_id) throw new InvalidActionError("میز تورنومنت با پایان تورنومنت بسته می‌شود");
      const seats = await repo.listSeats(tableId);
      for (const seat of seats) {
        if (!seat.user_id) {
          await repo.removeSeat(tableId, seat.seat_index);
          continue;
        }
        const chips = Number(seat.stack);
        await tx(async (client) => {
          if (chips > 0) {
            await repo.applyLedgerTx(client, {
              userId: seat.user_id,
              type: "cash_out",
              amount: chips,
              tableId,
              note: "بسته‌شدن میز",
            });
          }
          await client.query("DELETE FROM table_seats WHERE table_id = $1 AND seat_index = $2", [
            tableId,
            seat.seat_index,
          ]);
        });
      }
      return;
    }
    if (rt.isTournament) throw new InvalidActionError("میز تورنومنت با پایان تورنومنت بسته می‌شود");
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
    this.broadcast(tableId);
    this.dropTableRuntime(tableId);
  }

  /** Admin: rename or adjust table settings (not for tournament tables). */
  async updateTable(tableId: string, input: { name?: string; config?: Partial<TableConfig> }): Promise<void> {
    const row = await repo.getTable(tableId);
    if (!row || row.status !== "open") throw new InvalidActionError("میز یافت نشد");
    if (row.tournament_id) throw new InvalidActionError("میز تورنومنت قابل ویرایش نیست");

    const merged: TableConfig = { ...row.config, ...input.config };
    if (input.name) merged.name = input.name;

    const { smallBlind: sb, bigBlind: bb, minBuyIn, maxBuyIn, maxSeats } = merged;
    if (!Number.isFinite(sb) || !Number.isFinite(bb) || sb <= 0 || bb <= 0 || sb > bb) {
      throw new InvalidActionError("مقادیر بلایند نامعتبر است");
    }
    if (minBuyIn < bb || maxBuyIn < minBuyIn) {
      throw new InvalidActionError("محدوده ورود نامعتبر است");
    }
    if (maxSeats < 2 || maxSeats > 9) {
      throw new InvalidActionError("تعداد صندلی نامعتبر است");
    }

    const rt = this.tables.get(tableId);
    if (input.config && rt) {
      const phase = rt.game.phase;
      if (phase !== "waiting" && phase !== "hand_complete") {
        throw new InvalidActionError("تا پایان دست جاری نمی‌توان تنظیمات را تغییر داد");
      }
      const seated = rt.game.seats.filter((s) => s.userId).length;
      if (maxSeats < seated) {
        throw new InvalidActionError("صندلی کمتر از تعداد بازیکنان نشسته است");
      }
      Object.assign(rt.game.config, merged);
      this.broadcast(tableId);
    } else if (input.name && rt) {
      rt.game.config.name = merged.name;
      this.broadcast(tableId);
    }

    const updated = await repo.updateTable(tableId, { name: merged.name, config: merged });
    if (!updated) throw new InvalidActionError("میز یافت نشد");
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------
  async act(tableId: string, userId: string, action: PlayerAction): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    rt.game.act(userId, action); // throws InvalidActionError on illegal moves
    // Announce an all-in in the feed. An all-in seat can't act again this hand,
    // so this fires exactly once per player per all-in (on the transition).
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (seat && seat.status === "allin") {
      this.pushLog(rt, `${seat.name ?? "بازیکن"} آل‌این کرد! 🔥`, "allin", { userId, name: seat.name ?? "بازیکن" });
    }
    await this.recordLastAction(rt);
    await this.afterMutation(rt);
  }

  /** Winner reveals their cards after a fold-win (within the show window). */
  async showCards(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    rt.game.showCards(userId); // throws if not allowed / window passed
    // Re-persist the updated result so the reveal survives in hand history.
    if (rt.lastHandId && rt.game.lastResult) {
      try {
        await repo.updateHandResult(rt.lastHandId, rt.game.lastResult);
      } catch (err) {
        console.error("updateHandResult failed", err);
      }
    }
    this.broadcast(tableId);
  }

  /** Toggle a player's sit-out; auto-remove them after the configured window. */
  async sitOut(tableId: string, userId: string, out: boolean): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    // Sitting out in a tournament would let a player dodge the blinds while
    // keeping their stack — not allowed. They must play or bust.
    if (rt.isTournament) throw new InvalidActionError("در تورنومنت امکان سیت‌اوت وجود ندارد");
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (!seat) throw new InvalidActionError("شما سر این میز نیستید");
    const wasOut = seat.sitOut === true;
    if (wasOut === out) return; // no change — don't reset the removal timer
    const name = seat.name ?? "بازیکن";

    rt.game.setSitOut(userId, out);
    this.clearSitOutTimer(rt, userId);
    if (out) {
      const ms = Math.min(2 ** 31 - 1, Math.max(0, rt.game.config.sitOutMaxMin) * 60_000);
      this.pushLog(rt, `${name} نشست بیرون (سیت‌اوت)`);
      if (ms > 0) {
        rt.sitOutTimers.set(userId, setTimeout(() => this.autoRemoveSatOut(tableId, userId), ms));
      }
    } else {
      this.pushLog(rt, `${name} به بازی برگشت`);
    }
    this.maybeStartHand(rt);
    this.broadcast(tableId);
  }

  private clearSitOutTimer(rt: TableRuntime, userId: string): void {
    const t = rt.sitOutTimers.get(userId);
    if (t) {
      clearTimeout(t);
      rt.sitOutTimers.delete(userId);
    }
  }

  private async autoRemoveSatOut(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    rt.sitOutTimers.delete(userId);
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (!seat || !seat.sitOut) return; // came back in the meantime
    const name = await this.removeSeatCore(rt, userId, true);
    if (name === null) return;
    this.pushLog(rt, `${name} به دلیل سیت‌اوت طولانی حذف شد`);
    await this.afterMutation(rt);
  }

  /** Admin removes a player from the table (cashing out their stack). */
  async kick(tableId: string, actorRole: string, seatIndex: number, expectedUserId?: string): Promise<void> {
    if (actorRole !== "admin") throw new InvalidActionError("فقط مدیر می‌تواند بازیکن را حذف کند");
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    // Kicking cashes the stack to the bank; in a tournament use the tournament
    // removal flow instead so play chips are never credited to the real ledger.
    if (rt.isTournament) throw new InvalidActionError("برای حذف بازیکن تورنومنت از ابزار تورنومنت استفاده کنید");
    const seat = rt.game.seats[seatIndex];
    if (!seat || !seat.userId) throw new InvalidActionError("صندلی خالی است");
    // Guard against the seat changing occupants between selection and confirm.
    if (expectedUserId && seat.userId !== expectedUserId) {
      throw new InvalidActionError("بازیکن این صندلی تغییر کرده است");
    }
    const name = await this.removeSeatCore(rt, seat.userId, true);
    if (name === null) return;
    this.pushLog(rt, `${name} توسط مدیر از میز حذف شد`);
    await this.afterMutation(rt);
  }

  /** Player asks for extra think-time on their turn (time bank). */
  async requestExtraTime(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    rt.game.requestExtraTime(userId); // throws if not allowed
    await this.afterMutation(rt); // reschedules the action timer to the new deadline
  }

  // --------------------------------------------------------------------------
  // Hand lifecycle
  // --------------------------------------------------------------------------
  private maybeStartHand(rt: TableRuntime): void {
    if (rt.paused) return; // e.g. a scheduled tournament break — no new hands
    if (rt.nextHandTimer || rt.actionTimer) return;
    if (rt.game.canStartHand()) {
      rt.nextHandTimer = setTimeout(() => this.startHand(rt), NEXT_HAND_DELAY_MS);
    }
  }

  /** Pause/resume dealing new hands (scheduled tournament breaks). The current
   *  hand, if any, finishes normally; only the *next* hand is gated. */
  async setPaused(tableId: string, paused: boolean): Promise<void> {
    // Eagerly load so a pause request isn't silently dropped for an unloaded table.
    const rt = await this.ensureLoaded(tableId).catch(() => this.tables.get(tableId));
    if (!rt) return;
    rt.paused = paused;
    if (paused) {
      // Cancel any queued next hand so a pending timer can't deal during the break.
      if (rt.nextHandTimer) {
        clearTimeout(rt.nextHandTimer);
        rt.nextHandTimer = undefined;
      }
    } else {
      this.maybeStartHand(rt);
    }
    // Broadcast on both paths so clients see the break start and end symmetrically.
    this.broadcast(tableId);
  }

  private async startHand(rt: TableRuntime): Promise<void> {
    rt.nextHandTimer = undefined;
    if (rt.paused) return; // a break may have begun after this hand was queued
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

    this.broadcast(rt.tableId);
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
    rt.lastHandId = handId; // remembered so a late reveal can re-persist

    // Announce winners in the table feed.
    if (g.lastResult) {
      for (const pot of g.lastResult.pots) {
        for (const w of pot.winners) {
          const name = g.seats[w.seatIndex]?.name ?? "بازیکن";
          const via = w.handName ? ` با ${w.handName}` : "";
          this.pushLog(rt, `${name}${via} مبلغ ${w.amount.toLocaleString("fa")} ژتون برد`);
        }
      }
    }

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
        // Record the made-hand category only for players who actually reached a
        // showdown — result.shownCards is populated for revealed hands and stays
        // empty on a fold-win, so an unrevealed river fold-win isn't counted.
        let bestHandRank: number | null = null;
        const shown = result.shownCards[p.seatIndex];
        if (seat && shown?.length === 2 && g.community.length === 5 && seat.status !== "folded") {
          bestHandRank = evaluate([...shown, ...g.community]).category;
        }
        // "Won" = actually profitable this hand (net > 0), correct for split/side pots.
        return { seatIndex: p.seatIndex, userId: p.userId, won: net > 0, net, bestHandRank };
      });
      try {
        await tx(async (client) => {
          await repo.finishHandTx(client, handId, g.community.map(cardToString), g.pot, result.rake, result.deckSeed, result);
          await repo.insertHandPlayersTx(client, handId, rt.tableId, rows, g.pot);
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
    // Let a tournament (if any) process busts / eliminations / payouts.
    this.onHandEndHook?.(rt.tableId);
  }

  // --------------------------------------------------------------------------
  // Tournament integration (chips here are play chips, not bank chips)
  // --------------------------------------------------------------------------
  async setBlinds(tableId: string, sb: number, bb: number, ante: number): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    if (![sb, bb, ante].every((n) => Number.isFinite(n) && n >= 0) || sb <= 0 || bb < sb) {
      throw new InvalidActionError("بلایندهای نامعتبر");
    }
    rt.game.config.smallBlind = sb;
    rt.game.config.bigBlind = bb;
    rt.game.config.ante = ante;
    this.pushLog(rt, `بلایندها به ${sb}/${bb} افزایش یافت`);
    this.broadcast(tableId);
  }

  async seatTournamentPlayer(tableId: string, seatIndex: number, userId: string, name: string, stack: number): Promise<void> {
    const rt = await this.ensureLoaded(tableId);
    rt.isTournament = true;
    rt.game.sit(seatIndex, userId, name, stack);
    await repo.upsertSeat(tableId, seatIndex, userId, stack, stack);
    await this.cacheProfile(rt, userId);
    this.pushLog(rt, `${name} وارد تورنومنت شد`);
  }

  async addTournamentChips(tableId: string, userId: string, amount: number): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    rt.game.addChips(userId, amount);
    const seat = rt.game.seats.find((s) => s.userId === userId);
    if (seat) await repo.updateSeatStack(tableId, seat.seatIndex, seat.stack);
  }

  async removeTournamentPlayer(tableId: string, userId: string, reason: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    const name = await this.removeSeatCore(rt, userId, false); // play chips, no bank credit
    if (name === null) return;
    this.pushLog(rt, reason);
    await this.afterMutation(rt);
  }

  /**
   * Move a forfeiting player's remaining stack to other seated players before
   * they are removed. Caller must verify the hand is not live.
   */
  async redistributeTournamentForfeit(
    tableId: string,
    fromUserId: string,
    splitMap: Map<string, number>
  ): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    const seat = rt.game.seats.find((s) => s.userId === fromUserId);
    if (!seat) throw new InvalidActionError("بازیکن یافت نشد");
    const total = [...splitMap.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    if (total > seat.stack) throw new InvalidActionError("خطای تقسیم ژتون");

    seat.stack -= total;
    await repo.updateSeatStack(tableId, seat.seatIndex, seat.stack);

    for (const s of rt.game.seats) {
      if (!s.userId || s.userId === fromUserId) continue;
      const add = splitMap.get(s.userId) ?? 0;
      if (add > 0) await this.addTournamentChips(tableId, s.userId, add);
    }
    this.broadcast(tableId);
  }

  startTable(tableId: string): void {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    this.maybeStartHand(rt);
    this.broadcast(tableId);
  }

  /** Remove a table's runtime without cashing play chips to the bank. */
  async teardownTable(tableId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    if (rt.actionTimer) clearTimeout(rt.actionTimer);
    if (rt.nextHandTimer) clearTimeout(rt.nextHandTimer);
    for (const t of rt.sitOutTimers.values()) clearTimeout(t);
    for (const seat of rt.game.seats) {
      if (seat.userId) await repo.removeSeat(tableId, seat.seatIndex).catch(() => {});
    }
    this.broadcast(tableId);
    this.dropTableRuntime(tableId);
  }

  logMessage(tableId: string, text: string): void {
    const rt = this.tables.get(tableId);
    if (rt) this.pushLog(rt, text);
  }

  // --------------------------------------------------------------------------
  // Broadcasting
  // --------------------------------------------------------------------------
  private pushLog(rt: TableRuntime, text: string, kind: LogEntry["kind"] = "event", author?: LogEntry["author"]): void {
    rt.log.push({ id: ++rt.logSeq, ts: Date.now(), text, kind, author });
    if (rt.log.length > LOG_CAP) rt.log.splice(0, rt.log.length - LOG_CAP);
  }

  /** A player chat message into the table feed (validated + rate-limited by the socket layer). */
  async chat(tableId: string, userId: string, text: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) throw new InvalidActionError("میز فعال نیست");
    const msg = text.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 200);
    if (!msg) return;
    // Resolve the display name from the seat if present, else from the DB.
    const seat = rt.game.seats.find((s) => s.userId === userId);
    const name = seat?.name ?? (await repo.getUserById(userId))?.display_name ?? "بازیکن";
    this.pushLog(rt, msg, "chat", { userId, name });
    this.broadcast(tableId);
  }

  /** Refresh a player's cached cosmetic profile at a table and broadcast so
   *  connected clients immediately see the updated avatar/title/etc. */
  async refreshProfile(tableId: string, userId: string): Promise<void> {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    const seated = rt.game.seats.some((s) => s.userId === userId);
    if (seated && !rt.profiles.has(userId)) await this.cacheProfile(rt, userId);
    this.broadcast(tableId);
  }

  /** Fetch + cache a player's cosmetic profile for table display (best-effort). */
  private async cacheProfile(rt: TableRuntime, userId: string): Promise<void> {
    try {
      const p = await repo.getProfile(userId);
      // Re-check seat membership AFTER the async fetch: the player may have left
      // (and had their cache entry evicted) while we awaited, and we must not
      // resurrect a stale entry for a now-unseated player.
      if (!rt.game.seats.some((s) => s.userId === userId)) return;
      rt.profiles.set(userId, {
        avatar: p?.avatar ?? "",
        title: p?.title ?? "",
        tagline: p?.tagline ?? "",
        chipColor: p?.chip_color ?? "",
        cardBack: p?.card_back ?? "",
      });
    } catch {
      /* cosmetic only — ignore */
    }
  }

  private attachProfiles(ps: ReturnType<HoldemGame["publicState"]>, rt: TableRuntime, viewerId: string | null): void {
    for (const seat of ps.seats) {
      if (!seat.userId) continue;
      const p = rt.profiles.get(seat.userId);
      if (p) {
        seat.avatar = p.avatar;
        seat.title = p.title;
        seat.tagline = p.tagline;
        seat.chipColor = p.chipColor;
        seat.cardBack = p.cardBack;
      }
    }
    if (viewerId) ps.myCardBack = rt.profiles.get(viewerId)?.cardBack ?? "";
  }

  broadcast(tableId: string): void {
    const rt = this.tables.get(tableId);
    if (!rt) return;
    const sockets = this.roomSockets.get(tableId);
    if (!sockets?.size) return;
    const log = rt.log;
    for (const s of sockets) {
      const uid = (s.data as { userId?: string }).userId ?? null;
      const ps = rt.game.publicState(uid);
      ps.log = log;
      this.attachProfiles(ps, rt, uid);
      s.emit("state", ps);
    }
  }

  /** Emit an event to every socket in a table room (same payload for all). */
  emitToTable(tableId: string, event: string, payload: unknown): void {
    const sockets = this.roomSockets.get(tableId);
    if (!sockets?.size) return;
    for (const s of sockets) s.emit(event, payload);
  }

  /** Emit per-viewer payloads (e.g. tournament banner with personal canRebuy). */
  emitToTablePersonalized(
    tableId: string,
    event: string,
    payloadFor: (userId: string | null) => unknown
  ): void {
    const sockets = this.roomSockets.get(tableId);
    if (!sockets?.size) return;
    for (const s of sockets) {
      const uid = (s.data as { userId?: string }).userId ?? null;
      s.emit(event, payloadFor(uid));
    }
  }
}

// The custom server bundle (sockets) and Next's compiled route handlers are
// separate module graphs in the SAME process, so a plain module-level singleton
// would give each side its own instance. Pin it on globalThis so both share one.
declare global {
  var __gameManager: GameManager | undefined;
}
export const gameManager: GameManager = (globalThis.__gameManager ??= new GameManager());
