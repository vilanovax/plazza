/**
 * Single-table (Sit & Go) tournament orchestrator.
 *
 * Runs on top of the normal table engine: it creates a table for the
 * tournament, seats registered players with the starting stack, escalates the
 * blinds on a timer, lets busted players re-buy during the rebuy period,
 * eliminates players (recording their finishing place) and, when one player
 * remains, splits the prize pool by the configured payout percentages.
 *
 * Note: this is a single-table format. Multi-table balancing is out of scope.
 */
import * as repo from "../lib/repo";
import type { TableConfig } from "../lib/poker/types";
import type { TournamentRow } from "../lib/models";
import { gameManager } from "./gameManager";
import { InvalidActionError } from "../lib/poker/engine";
import { validatePayouts, playableLevel } from "../lib/tournament/types";

const NEXT_LEVEL_GRACE_MS = 500;

export class TournamentManager {
  private levelTimers = new Map<string, NodeJS.Timeout>();
  private tableToTournament = new Map<string, string>();
  private processing = new Set<string>();
  private rebuying = new Set<string>();
  private lateRegistering = new Set<string>();

  init(): void {
    // Route table hand-end events to the owning tournament (if any).
    gameManager.onHandEndHook = (tableId: string) => {
      const tid = this.tableToTournament.get(tableId);
      if (tid) void this.onHandEnd(tid, tableId);
    };
  }

  /**
   * Rebuild in-memory tournament state after a server restart. The DB is the
   * source of truth (status/current_level/level_ends_at + persisted seat stacks);
   * this re-maps tables, restores the current blinds/break, re-arms the blind
   * timer from the persisted deadline, and resumes dealing.
   */
  async resumeRunning(): Promise<void> {
    let running: TournamentRow[] = [];
    try {
      running = await repo.listTournaments(["running"]);
    } catch (err) {
      console.error("resumeRunning: failed to list tournaments", err);
      return;
    }
    for (const t of running) {
      if (!t.table_id) continue;
      try {
        this.tableToTournament.set(t.table_id, t.id);
        await gameManager.ensureLoaded(t.table_id); // rehydrate seats + isTournament flag
        const level = this.levelOf(t, t.current_level || 1);
        if (level.isBreak) {
          await gameManager.setPaused(t.table_id, true);
        } else {
          await gameManager.setBlinds(t.table_id, level.sb, level.bb, level.ante);
        }
        // Re-arm the level timer from the persisted deadline (fire ~immediately
        // if it already elapsed during downtime). Don't schedule past the last level.
        const isTerminal = t.current_level >= t.blind_schedule.length;
        if (!isTerminal) {
          const remaining = t.level_ends_at ? Date.parse(t.level_ends_at) - Date.now() : 0;
          this.scheduleLevel(t.id, Math.max(0, remaining));
        }
        if (!level.isBreak) gameManager.startTable(t.table_id);
        gameManager.logMessage(t.table_id, "تورنومنت پس از راه‌اندازی مجدد سرور ادامه یافت");
      } catch (err) {
        console.error(`resumeRunning: tournament ${t.id} failed to resume`, err);
      }
    }
  }

  private levelOf(t: TournamentRow, level: number) {
    if (!Array.isArray(t.blind_schedule) || t.blind_schedule.length === 0) {
      throw new InvalidActionError("جدول بلایند تورنومنت نامعتبر است");
    }
    const idx = Math.min(Math.max(1, level), t.blind_schedule.length) - 1;
    return t.blind_schedule[idx];
  }

  // --------------------------------------------------------------------------
  // Start
  // --------------------------------------------------------------------------
  async start(tournamentId: string, adminId: string): Promise<void> {
    const t = await repo.getTournament(tournamentId);
    if (!t) throw new InvalidActionError("تورنومنت یافت نشد");
    if (t.status !== "scheduled") throw new InvalidActionError("تورنومنت قابل شروع نیست");
    const entries = (await repo.listEntries(tournamentId)).filter((e) => e.status === "registered");
    if (entries.length < 2) throw new InvalidActionError("حداقل دو شرکت‌کننده لازم است");
    const maxSeats = Math.min(9, Math.max(2, t.max_players));
    if (entries.length > maxSeats) throw new InvalidActionError("تعداد شرکت‌کنندگان بیش از ظرفیت میز است");

    const l1 = this.levelOf(t, 1);
    const settings = await repo.getSettings();
    // starting_stack is BIGINT → pg returns it as a string; coerce so the engine
    // (which clamps numeric config) sees a real number, not NaN.
    const startingStack = Number(t.starting_stack);
    const config: TableConfig = {
      name: t.name,
      maxSeats: Math.min(9, Math.max(2, t.max_players)),
      smallBlind: l1.sb,
      bigBlind: l1.bb,
      ante: l1.ante,
      rakePercent: 0,
      rakeCap: 0,
      noFlopNoDrop: true,
      minBuyIn: startingStack,
      maxBuyIn: startingStack,
      thinkTimeSec: settings.default_think_time_sec,
      allowTopUp: false,
      topUpMin: 0,
      topUpMax: 0,
      tableDurationMin: 0,
      sitOutMaxMin: settings.sit_out_max_min,
      extraTimeSec: settings.extra_time_sec,
      extraTimeRequests: settings.extra_time_requests,
    };
    const table = await repo.createTable(config.name, config, adminId);
    await repo.setTableTournament(table.id, tournamentId);
    this.tableToTournament.set(table.id, tournamentId);

    // Seat every registered player with the starting stack (chips already paid).
    let seat = 0;
    for (const e of entries) {
      const user = await repo.getUserById(e.user_id);
      if (!user) continue;
      await gameManager.seatTournamentPlayer(table.id, seat++, e.user_id, user.display_name, startingStack);
      await repo.setEntry(tournamentId, e.user_id, { status: "active", chips: startingStack });
    }

    const levelEnds = new Date(Date.now() + l1.minutes * 60_000).toISOString();
    await repo.updateTournament(tournamentId, {
      status: "running",
      current_level: 1,
      table_id: table.id,
      started_at: new Date().toISOString(),
      level_ends_at: levelEnds,
    });
    gameManager.logMessage(table.id, `تورنومنت شروع شد — سطح ۱`);
    this.scheduleLevel(tournamentId, l1.minutes * 60_000);
    gameManager.startTable(table.id);
  }

  // --------------------------------------------------------------------------
  // Blind levels
  // --------------------------------------------------------------------------
  private scheduleLevel(tournamentId: string, ms: number): void {
    this.clearLevelTimer(tournamentId);
    this.levelTimers.set(tournamentId, setTimeout(() => void this.levelUp(tournamentId), ms + NEXT_LEVEL_GRACE_MS));
  }

  private clearLevelTimer(tournamentId: string): void {
    const t = this.levelTimers.get(tournamentId);
    if (t) {
      clearTimeout(t);
      this.levelTimers.delete(tournamentId);
    }
  }

  private async levelUp(tournamentId: string): Promise<void> {
    const t = await repo.getTournament(tournamentId);
    if (!t || t.status !== "running" || !t.table_id) return;
    const next = Math.min(t.current_level + 1, t.blind_schedule.length);
    const level = this.levelOf(t, next);
    await repo.updateTournament(tournamentId, {
      current_level: next,
      level_ends_at: new Date(Date.now() + level.minutes * 60_000).toISOString(),
    });
    const isTerminal = next >= t.blind_schedule.length;
    if (level.isBreak && !isTerminal) {
      // Scheduled break: hold the blinds, pause new hands, and let the level
      // timer advance us to the next play level after `minutes`.
      await gameManager.setPaused(t.table_id, true);
      gameManager.logMessage(t.table_id, `استراحت — ${level.minutes.toLocaleString("fa")} دقیقه`);
    } else {
      // A play level — or a (malformed) terminal break, which must NOT pause
      // forever since no further level is scheduled: resume and keep prior blinds.
      await gameManager.setPaused(t.table_id, false);
      if (!level.isBreak) await gameManager.setBlinds(t.table_id, level.sb, level.bb, level.ante);
    }

    // If the rebuy period just closed, remove anyone still busted — but only if
    // no hand is live. Mid-hand an all-in player has stack 0 yet is still
    // contesting the pot; eliminating them would corrupt the pot and placement.
    // A live hand's next natural end runs onHandEnd anyway (rebuy is now closed).
    // Thresholds are in *playable* levels so breaks don't shift them.
    if (playableLevel(t.blind_schedule, next) > t.config.rebuyThroughLevel) {
      const rt = gameManager.getRuntime(t.table_id);
      const handLive = !!rt && rt.game.phase !== "waiting" && rt.game.phase !== "hand_complete";
      if (!handLive) await this.onHandEnd(tournamentId, t.table_id, true);
    }
    if (!isTerminal) this.scheduleLevel(tournamentId, level.minutes * 60_000);
  }

  // --------------------------------------------------------------------------
  // Re-buy
  // --------------------------------------------------------------------------
  private canRebuy(t: TournamentRow, entryRebuys: number): boolean {
    return (
      t.status === "running" &&
      t.config.rebuyAllowed &&
      playableLevel(t.blind_schedule, t.current_level) <= t.config.rebuyThroughLevel &&
      (t.config.rebuyMaxCount < 0 || entryRebuys < t.config.rebuyMaxCount)
    );
  }

  async rebuyByTable(tableId: string, userId: string): Promise<void> {
    const tid = this.tableToTournament.get(tableId) ?? (await repo.getTournamentByTable(tableId))?.id;
    if (!tid) throw new InvalidActionError("این میز تورنومنت نیست");
    await this.rebuy(tid, userId);
  }

  async rebuy(tournamentId: string, userId: string): Promise<void> {
    // Serialise concurrent rebuy attempts by the same player so a double-click
    // can't charge the buy-in (and add chips) twice.
    const key = `${tournamentId}:${userId}`;
    if (this.rebuying.has(key)) throw new InvalidActionError("درخواست ری‌بای در حال پردازش است");
    this.rebuying.add(key);
    try {
      const t = await repo.getTournament(tournamentId);
      if (!t || !t.table_id) throw new InvalidActionError("تورنومنت فعال نیست");
      const entry = await repo.getEntry(tournamentId, userId);
      if (!entry || entry.status !== "active") throw new InvalidActionError("شما در این تورنومنت فعال نیستید");
      if (!this.canRebuy(t, entry.rebuys)) throw new InvalidActionError("امکان ری‌بای وجود ندارد");
      const rt = gameManager.getRuntime(t.table_id);
      const seat = rt?.game.seats.find((s) => s.userId === userId);
      if (!seat || seat.stack > 0) throw new InvalidActionError("فقط پس از حذف شدن ژتون‌ها می‌توانید ری‌بای کنید");
      // Never charge a buy-in we can't immediately credit: an all-in player has
      // stack 0 but is still in a live hand, where addChips() (correctly) refuses
      // the top-up. Require the hand to be settled first.
      if (rt && rt.game.phase !== "waiting" && rt.game.phase !== "hand_complete") {
        throw new InvalidActionError("تا پایان دست فعلی نمی‌توان ری‌بای کرد");
      }

      // BIGINT columns arrive as strings — coerce before arithmetic/engine use.
      const startingStack = Number(t.starting_stack);
      await repo.buyIntoTournament(tournamentId, userId, Number(t.buy_in_chips), true);
      await gameManager.addTournamentChips(t.table_id, userId, startingStack);
      await repo.setEntry(tournamentId, userId, { chips: startingStack });
      gameManager.logMessage(t.table_id, `${seat.name ?? "بازیکن"} ری‌بای کرد`);
      gameManager.startTable(t.table_id);
    } finally {
      this.rebuying.delete(key);
    }
  }

  // --------------------------------------------------------------------------
  // Late registration — join a running tournament within the late-reg window
  // --------------------------------------------------------------------------
  /** True if a running tournament is still inside its late-registration window.
   *  The window is measured in *playable* levels so breaks don't close it early. */
  lateRegOpen(t: TournamentRow): boolean {
    const through = t.config.lateRegThroughLevel ?? 0;
    return t.status === "running" && through > 0 && playableLevel(t.blind_schedule, t.current_level) <= through;
  }

  async lateRegister(tournamentId: string, userId: string): Promise<void> {
    // Serialise per tournament: seat allocation reads the live table then seats
    // after a DB round-trip, so concurrent late-regs must not pick the same seat.
    if (this.lateRegistering.has(tournamentId)) throw new InvalidActionError("ثبت‌نام با تأخیر در حال پردازش است");
    this.lateRegistering.add(tournamentId);
    try {
      const t = await repo.getTournament(tournamentId);
      if (!t || !t.table_id) throw new InvalidActionError("تورنومنت در حال اجرا نیست");
      if (!this.lateRegOpen(t)) throw new InvalidActionError("مهلت ثبت‌نام با تأخیر به پایان رسیده است");
      const user = await repo.getUserById(userId);
      if (!user) throw new InvalidActionError("کاربر یافت نشد");

      const rt = await gameManager.ensureLoaded(t.table_id);
      const empty = rt.game.seats.find((s) => s.status === "empty");
      if (!empty) throw new InvalidActionError("ظرفیت میز تکمیل است");

      const startingStack = Number(t.starting_stack);
      // Seat the player first (in-memory + table_seats — reversible), THEN debit
      // and create the entry atomically. If the charge fails (insufficient funds,
      // window closed, duplicate) we roll the seat back, so a player is never
      // charged without ending up seated.
      await gameManager.seatTournamentPlayer(t.table_id, empty.seatIndex, userId, user.display_name, startingStack);
      try {
        await repo.lateRegisterEntry(
          tournamentId,
          userId,
          Number(t.buy_in_chips),
          startingStack,
          t.config.lateRegThroughLevel ?? 0
        );
      } catch (err) {
        await gameManager.removeTournamentPlayer(t.table_id, userId, `${user.display_name} — ثبت‌نام ناموفق`).catch(() => {});
        throw err;
      }
      gameManager.logMessage(t.table_id, `${user.display_name} با ثبت‌نام با تأخیر وارد شد`);
      gameManager.startTable(t.table_id);
    } finally {
      this.lateRegistering.delete(tournamentId);
    }
  }

  // --------------------------------------------------------------------------
  // Hand-end: busts, eliminations, finish
  // --------------------------------------------------------------------------
  private async onHandEnd(tournamentId: string, tableId: string, force = false): Promise<void> {
    if (this.processing.has(tournamentId)) return;
    this.processing.add(tournamentId);
    try {
      const t = await repo.getTournament(tournamentId);
      if (!t || t.status !== "running") return;
      const rt = gameManager.getRuntime(tableId);
      if (!rt) return;

      const seated = rt.game.seats.filter((s) => s.userId);
      for (const s of seated) await repo.setEntry(tournamentId, s.userId as string, { chips: s.stack });

      const active = (await repo.listEntries(tournamentId)).filter((e) => e.status === "active");
      const busted = active
        .map((e) => {
          const seat = seated.find((s) => s.userId === e.user_id);
          // Chips the player brought into the hand — falls back to what they
          // committed (a busted all-in player has committed their whole stack).
          const startStack = seat?.stackAtHandStart ?? seat?.committedThisHand ?? 0;
          return { e, seat, stack: seat ? seat.stack : 0, startStack };
        })
        .filter((b) => b.stack <= 0);

      // During the rebuy period, keep re-buyable players (unless forced).
      const eliminate = busted.filter((b) => force || !this.canRebuy(t, b.e.rebuys));
      // Players who bust in the SAME hand are ranked by the stack they started
      // the hand with: the shorter stack takes the worse (higher-numbered) place.
      eliminate.sort((a, b) => a.startStack - b.startStack);

      let remaining = active.length;
      for (const b of eliminate) {
        const place = remaining;
        remaining -= 1;
        await repo.setEntry(tournamentId, b.e.user_id, { place, status: "busted" });
        const name = b.seat?.name ?? "بازیکن";
        await gameManager.removeTournamentPlayer(tableId, b.e.user_id, `${name} در رتبه ${place} حذف شد`);
      }

      const stillActive = (await repo.listEntries(tournamentId)).filter((e) => e.status === "active");
      if (stillActive.length <= 1) await this.finish(tournamentId, tableId, stillActive[0]?.user_id);
    } finally {
      this.processing.delete(tournamentId);
    }
  }

  private async finish(tournamentId: string, tableId: string, winnerUserId?: string): Promise<void> {
    const t = await repo.getTournament(tournamentId);
    if (!t || t.status !== "running") return;
    // Atomically claim the payout phase (running -> finishing). If another call
    // already claimed it, bail out so the prize pool can't be paid out twice.
    if (!(await repo.claimTournamentFinish(tournamentId))) return;
    if (winnerUserId) await repo.setEntry(tournamentId, winnerUserId, { place: 1, status: "active" });

    const entries = await repo.listEntries(tournamentId);
    const byPlace = entries.filter((e) => e.place != null).sort((a, b) => (a.place as number) - (b.place as number));
    const pool = Number(t.prize_pool); // BIGINT → string; coerce for payout math
    // Payouts are validated at creation, so an invalid config here means stored
    // data was corrupted. Rather than strand the already-collected pool, pay it
    // to first place — but make the deviation loud (server log + table feed) so
    // an admin can reconcile, instead of silently rewriting the split.
    let payouts = t.config.payouts;
    if (!validatePayouts(payouts)) {
      payouts = [100];
      console.error(
        `tournament ${tournamentId}: invalid payout config ${JSON.stringify(t.config.payouts)} — paying winner-takes-all`
      );
      gameManager.logMessage(tableId, "هشدار: تنظیم جوایز نامعتبر بود؛ کل جایزه به نفر اول پرداخت شد");
    }

    const awards: Array<{ userId: string; amount: number; place: number }> = [];
    let distributed = 0;
    for (let i = 0; i < payouts.length; i++) {
      const place = i + 1;
      const e = byPlace.find((x) => x.place === place);
      if (!e) continue;
      const amount = Math.floor((pool * payouts[i]) / 100);
      awards.push({ userId: e.user_id, amount, place });
      distributed += amount;
    }
    if (awards.length && pool - distributed > 0) awards[0].amount += pool - distributed; // odd chips to 1st

    for (const a of awards) {
      await repo.awardPrize(tournamentId, a.userId, a.amount, a.place, a.place === 1 ? "winner" : "busted");
      const u = await repo.getUserById(a.userId);
      gameManager.logMessage(tableId, `${u?.display_name ?? "بازیکن"} رتبه ${a.place} — جایزه ${a.amount.toLocaleString("fa")} ژتون`);
    }

    this.clearLevelTimer(tournamentId);
    this.tableToTournament.delete(tableId);
    await repo.updateTournament(tournamentId, { status: "finished", finished_at: new Date().toISOString() });
    await repo.closeTable(tableId);
    await gameManager.teardownTable(tableId);
  }
}

// Shared across the socket bundle and Next route handlers (see gameManager).
declare global {
  var __tournamentManager: TournamentManager | undefined;
}
export const tournamentManager: TournamentManager = (globalThis.__tournamentManager ??= new TournamentManager());
