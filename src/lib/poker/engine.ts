/**
 * Texas Hold'em game engine — pure, deterministic, server-only.
 *
 * The engine owns the shuffled deck and every player's hole cards. It exposes:
 *   - startHand(): deal + post blinds
 *   - act(): validate and apply a player's action, auto-advancing streets
 *   - timeout(): auto fold/check a player who ran out of think time
 *   - publicState(): a sanitised view for a given viewer
 *
 * It never trusts client input: every action is re-validated against the
 * authoritative state, and amounts are clamped to the player's real stack.
 */
import { type Card } from "./cards";
import { createShuffledDeck, drawMany, type ShuffledDeck } from "./deck";
import { evaluate, CATEGORY_NAMES_FA } from "./evaluator";
import type {
  GameState,
  GamePhase,
  HandResult,
  PlayerAction,
  PotResult,
  PublicGameState,
  SeatState,
  TableConfig,
} from "./types";

export class InvalidActionError extends Error {
  // Set a stable name so callers can identify this across module-graph
  // boundaries (the esbuild server bundle and Next's compiled routes hold
  // separate copies of this class, so `instanceof` is unreliable between them).
  constructor(message?: string) {
    super(message);
    this.name = "InvalidActionError";
  }
}

const MAX_TIMER_SEC = 3600; // 1h — keeps timer math well within setTimeout limits

function fin(v: number, def: number): number {
  return Number.isFinite(v) ? v : def;
}

/** Coerce any config loaded from JSON into safe, finite values the engine relies on. */
function normalizeConfig(c: TableConfig): TableConfig {
  // extra-time requests use sentinels: -1 = unlimited, 0 = off, N>0 = capped.
  // Any other (e.g. NaN or a stray negative) collapses to the -1 default.
  const etr = Math.trunc(fin(c.extraTimeRequests, -1));
  return {
    ...c,
    maxSeats: Math.min(9, Math.max(2, Math.trunc(fin(c.maxSeats, 6)))),
    smallBlind: Math.max(1, Math.trunc(fin(c.smallBlind, 5))),
    bigBlind: Math.max(1, Math.trunc(fin(c.bigBlind, 10))),
    ante: Math.max(0, Math.trunc(fin(c.ante, 0))),
    // Chip-path bounds: NaN here would silently disable the buy-in/top-up/rake
    // guards or poison every pot, so clamp them all to finite, non-negative values.
    rakePercent: Math.min(100, Math.max(0, fin(c.rakePercent, 0))),
    rakeCap: Math.max(0, Math.trunc(fin(c.rakeCap, 0))),
    minBuyIn: Math.max(0, Math.trunc(fin(c.minBuyIn, 0))),
    maxBuyIn: Math.max(0, Math.trunc(fin(c.maxBuyIn, 0))),
    topUpMin: Math.max(0, Math.trunc(fin(c.topUpMin, 0))),
    topUpMax: Math.max(0, Math.trunc(fin(c.topUpMax, 0))),
    thinkTimeSec: Math.min(MAX_TIMER_SEC, Math.max(3, Math.trunc(fin(c.thinkTimeSec, 30)))),
    sitOutMaxMin: Math.min(1440, Math.max(0, Math.trunc(fin(c.sitOutMaxMin, 5)))),
    extraTimeSec: Math.min(MAX_TIMER_SEC, Math.max(0, Math.trunc(fin(c.extraTimeSec, 15)))),
    extraTimeRequests: etr < -1 ? -1 : etr,
  };
}

function emptySeat(seatIndex: number): SeatState {
  return {
    seatIndex,
    userId: null,
    name: null,
    stack: 0,
    status: "empty",
    betThisRound: 0,
    committedThisHand: 0,
    hasActedThisRound: false,
    isConnected: false,
  };
}

export class HoldemGame {
  readonly tableId: string;
  config: TableConfig;
  phase: GamePhase = "waiting";
  handNo = 0;
  buttonSeat = 0;
  currentTurnSeat: number | null = null;
  seats: SeatState[];
  community: Card[] = [];
  currentBet = 0;
  minRaise = 0;
  deckCommitment?: string;
  lastResult?: HandResult;
  lastAction?: GameState["lastAction"];
  actionDeadline?: number;
  showOfferSeat?: number;
  showOfferUntil?: number;

  private deck: ShuffledDeck | null = null;

  constructor(tableId: string, config: TableConfig, seats?: SeatState[]) {
    this.tableId = tableId;
    this.config = normalizeConfig(config);
    this.seats = seats ?? Array.from({ length: this.config.maxSeats }, (_, i) => emptySeat(i));
    this.minRaise = this.config.bigBlind;
  }

  // ---------------------------------------------------------------------------
  // Seating
  // ---------------------------------------------------------------------------

  sit(seatIndex: number, userId: string, name: string, buyIn: number): void {
    const seat = this.seats[seatIndex];
    if (!seat) throw new InvalidActionError("صندلی نامعتبر است");
    if (seat.status !== "empty") throw new InvalidActionError("این صندلی اشغال است");
    if (this.seats.some((s) => s.userId === userId)) {
      throw new InvalidActionError("شما همین حالا سر این میز نشسته‌اید");
    }
    if (buyIn < this.config.minBuyIn || buyIn > this.config.maxBuyIn) {
      throw new InvalidActionError("مبلغ ورود خارج از محدوده مجاز است");
    }
    seat.userId = userId;
    seat.name = name;
    seat.stack = buyIn;
    seat.status = "sitting_out"; // dealt in on the next hand
    seat.isConnected = true;
    seat.committedThisHand = 0;
    seat.betThisRound = 0;
    seat.sitOut = false;
    seat.sitOutUntil = undefined;
    // A new occupant can't inherit the previous winner's reveal offer.
    if (this.showOfferSeat === seatIndex) this.clearShowOffer();
  }

  /** Remove a player. Returns the chips they take away from the table. */
  leave(seatIndex: number): number {
    const seat = this.seats[seatIndex];
    if (!seat || seat.status === "empty") return 0;
    const chips = seat.stack;

    const handInProgress = this.phase !== "waiting" && this.phase !== "hand_complete";
    const inHand = seat.status === "active" || seat.status === "allin";
    // If the player has chips committed to the current pot, we must NOT drop
    // the seat now — its committedThisHand still belongs to the pot. Fold them,
    // hand back their remaining stack, and clear the seat only at settlement.
    if (handInProgress && (inHand || seat.committedThisHand > 0)) {
      const wasTurn = this.currentTurnSeat === seatIndex;
      seat.status = "folded";
      seat.stack = 0; // remaining stack is returned to the bank by the caller
      seat.pendingLeave = true;
      if (wasTurn) this.advance();
    } else {
      this.seats[seatIndex] = emptySeat(seatIndex);
    }
    // If the reveal-offer holder leaves, the offer no longer applies.
    if (this.showOfferSeat === seatIndex) this.clearShowOffer();
    return chips;
  }

  setConnected(userId: string, connected: boolean): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (seat) seat.isConnected = connected;
  }

  topUp(seatIndex: number, amount: number): void {
    const seat = this.seats[seatIndex];
    if (!seat || seat.status === "empty") throw new InvalidActionError("صندلی نامعتبر است");
    if (!Number.isFinite(amount) || amount <= 0) throw new InvalidActionError("مبلغ نامعتبر است");
    if (this.config.topUpMin > 0 && amount < this.config.topUpMin) {
      throw new InvalidActionError(`حداقل مبلغ ${this.config.topUpMin} است`);
    }
    if (this.config.topUpMax > 0 && amount > this.config.topUpMax) {
      throw new InvalidActionError(`حداکثر مبلغ ${this.config.topUpMax} است`);
    }
    // Chips added while in a hand only take effect between hands (simplest);
    // here we allow it while sitting out / folded / between hands.
    if (seat.status === "active" || seat.status === "allin") {
      throw new InvalidActionError("در میانه دست نمی‌توان ژتون اضافه کرد");
    }
    seat.stack += amount;
  }

  // ---------------------------------------------------------------------------
  // Hand lifecycle
  // ---------------------------------------------------------------------------

  private dealableSeats(): SeatState[] {
    return this.seats.filter((s) => s.userId && s.stack > 0 && s.status !== "empty" && !s.sitOut);
  }

  canStartHand(): boolean {
    return this.phase === "waiting" || this.phase === "hand_complete"
      ? this.dealableSeats().length >= 2
      : false;
  }

  startHand(): void {
    const dealable = this.dealableSeats();
    if (dealable.length < 2) throw new InvalidActionError("برای شروع دست حداقل دو بازیکن لازم است");

    this.handNo += 1;
    this.community = [];
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.lastResult = undefined;
    this.lastAction = undefined;
    this.showOfferSeat = undefined;
    this.showOfferUntil = undefined;

    // Reset every seat for the new hand.
    for (const seat of this.seats) {
      seat.betThisRound = 0;
      seat.committedThisHand = 0;
      seat.hasActedThisRound = false;
      seat.cappedThisRound = false;
      seat.pendingLeave = false;
      seat.extraTimeUsed = 0;
      seat.extraTimeThisTurn = false;
      seat.holeCards = undefined;
      // Record the pre-blind stack so a same-hand bust can be ranked correctly.
      seat.stackAtHandStart = seat.stack;
      if (seat.userId && seat.stack > 0 && !seat.sitOut) seat.status = "active";
      else if (seat.userId) seat.status = "sitting_out";
    }

    // Place / move the button. First hand: first dealable seat. After that:
    // advance clockwise to the next seat that is in the hand.
    this.buttonSeat =
      this.handNo === 1 ? dealable[0].seatIndex : this.nextSeatInHand(this.buttonSeat);

    // Fresh shuffled deck + commitment (provable fairness).
    this.deck = createShuffledDeck();
    this.deckCommitment = this.deck.commitment;

    // Deal two hole cards to each active seat, in button order.
    const order = this.seatsInHandOrder(this.buttonSeat);
    for (const seat of order) seat.holeCards = drawMany(this.deck, 2);

    // Antes.
    if (this.config.ante > 0) {
      for (const seat of order) this.commitChips(seat, this.config.ante);
    }

    // Blinds.
    const heads = order.length === 2;
    const sbSeat = heads ? this.buttonSeat : this.nextSeatInHand(this.buttonSeat);
    const bbSeat = this.nextSeatInHand(sbSeat);
    this.postBlind(sbSeat, this.config.smallBlind);
    this.postBlind(bbSeat, this.config.bigBlind);
    this.currentBet = this.config.bigBlind;
    this.minRaise = this.config.bigBlind;

    // First to act preflop = seat after the big blind.
    this.phase = "preflop";
    const first = this.findNextToAct(bbSeat);
    if (first === -1) {
      // Everyone is all-in from blinds/antes — run it out.
      this.gotoNextStreetOrShowdown();
    } else {
      this.currentTurnSeat = first;
      this.setDeadline();
    }
  }

  private commitChips(seat: SeatState, amount: number): number {
    const pay = Math.min(amount, seat.stack);
    seat.stack -= pay;
    seat.betThisRound += pay;
    seat.committedThisHand += pay;
    if (seat.stack === 0) seat.status = "allin";
    return pay;
  }

  private postBlind(seatIndex: number, blind: number): void {
    const seat = this.seats[seatIndex];
    this.commitChips(seat, blind);
    seat.hasActedThisRound = false; // blinds do not count as "acted" (BB gets option)
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  act(userId: string, action: PlayerAction): void {
    if (this.currentTurnSeat === null) throw new InvalidActionError("الان نوبت اقدام نیست");
    const seat = this.seats[this.currentTurnSeat];
    if (!seat || seat.userId !== userId) throw new InvalidActionError("نوبت شما نیست");
    if (seat.status !== "active") throw new InvalidActionError("شما نمی‌توانید اقدام کنید");

    const toCall = this.currentBet - seat.betThisRound;

    switch (action.type) {
      case "fold":
        seat.status = "folded";
        break;

      case "check":
        if (toCall > 0) throw new InvalidActionError("نمی‌توانید چک کنید؛ باید کال یا فولد کنید");
        break;

      case "call": {
        if (toCall <= 0) throw new InvalidActionError("چیزی برای کال کردن نیست");
        this.commitChips(seat, toCall);
        break;
      }

      case "bet":
      case "raise":
      case "allin": {
        this.applyAggressive(seat, action);
        break;
      }

      default:
        throw new InvalidActionError("اقدام نامعتبر");
    }

    seat.hasActedThisRound = true;
    this.lastAction = { seatIndex: seat.seatIndex, type: action.type, amount: seat.betThisRound };
    this.advance();
  }

  private applyAggressive(seat: SeatState, action: PlayerAction): void {
    const maxTotal = seat.betThisRound + seat.stack; // all-in ceiling
    let target: number;

    if (action.type === "allin") {
      target = maxTotal;
    } else {
      if (!Number.isFinite(action.amount)) throw new InvalidActionError("مبلغ نامعتبر است");
      target = Math.floor(action.amount as number);
      if (action.type === "bet" && this.currentBet !== 0) {
        throw new InvalidActionError("اینجا باید رِیز کنید نه بِت");
      }
      if (action.type === "raise" && this.currentBet === 0) {
        throw new InvalidActionError("چیزی برای رِیز وجود ندارد؛ بِت کنید");
      }
      if (target > maxTotal) throw new InvalidActionError("بیشتر از موجودی شما است");
    }

    const isAllIn = target === maxTotal;
    const minLegalTarget =
      this.currentBet === 0 ? this.config.bigBlind : this.currentBet + this.minRaise;

    if (target <= this.currentBet) {
      throw new InvalidActionError("مبلغ باید بیشتر از شرط فعلی باشد");
    }
    if (target < minLegalTarget && !isAllIn) {
      throw new InvalidActionError(`حداقل مبلغ مجاز ${minLegalTarget} است`);
    }
    // If a previous short all-in did not reopen the betting for this seat, they
    // may only call or fold — not put in more than the current bet.
    if (seat.cappedThisRound && target > this.currentBet) {
      throw new InvalidActionError("اکشن باز نشده؛ فقط می‌توانید کال یا فولد کنید");
    }

    const raiseSize = target - this.currentBet;
    const fullRaise = raiseSize >= this.minRaise;
    this.commitChips(seat, target - seat.betThisRound);
    this.currentBet = target;

    if (fullRaise) {
      // A full-size raise reopens the betting for everyone else.
      this.minRaise = raiseSize;
      for (const s of this.seats) {
        if (s.status === "active" && s !== seat) {
          s.hasActedThisRound = false;
          s.cappedThisRound = false;
        }
      }
    } else {
      // Sub-minimum (short) all-in: players who have already acted are capped
      // to call/fold; players yet to act keep full rights.
      for (const s of this.seats) {
        if (s !== seat && s.status === "active" && s.hasActedThisRound) s.cappedThisRound = true;
      }
    }
  }

  timeout(): void {
    if (this.currentTurnSeat === null) return;
    const seat = this.seats[this.currentTurnSeat];
    if (!seat || seat.status !== "active") return;
    const toCall = this.currentBet - seat.betThisRound;
    // Auto-check when free, otherwise fold. Also sit them out to avoid stalling.
    if (toCall <= 0) {
      seat.hasActedThisRound = true;
      this.lastAction = { seatIndex: seat.seatIndex, type: "check", amount: seat.betThisRound };
    } else {
      seat.status = "folded";
      this.lastAction = { seatIndex: seat.seatIndex, type: "fold", amount: seat.betThisRound };
    }
    this.advance();
  }

  // ---------------------------------------------------------------------------
  // Round / street progression
  // ---------------------------------------------------------------------------

  private advance(): void {
    if (this.seatsInHand().length <= 1) {
      this.settle(false);
      return;
    }
    const next = this.findNextToAct(this.currentTurnSeat ?? this.buttonSeat);
    if (next !== -1) {
      this.currentTurnSeat = next;
      this.setDeadline();
      return;
    }
    this.gotoNextStreetOrShowdown();
  }

  private gotoNextStreetOrShowdown(): void {
    while (this.phase !== "river") {
      this.dealNextStreet();
      this.resetBettingRound();
      if (this.activeCount() >= 2) {
        this.currentTurnSeat = this.findNextToAct(this.buttonSeat);
        this.setDeadline();
        return;
      }
    }
    this.settle(true);
  }

  private dealNextStreet(): void {
    if (!this.deck) throw new Error("No deck");
    switch (this.phase) {
      case "preflop":
        this.community.push(...drawMany(this.deck, 3));
        this.phase = "flop";
        break;
      case "flop":
        this.community.push(...drawMany(this.deck, 1));
        this.phase = "turn";
        break;
      case "turn":
        this.community.push(...drawMany(this.deck, 1));
        this.phase = "river";
        break;
      default:
        break;
    }
  }

  private resetBettingRound(): void {
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.currentTurnSeat = null;
    for (const seat of this.seats) {
      seat.betThisRound = 0;
      seat.cappedThisRound = false;
      if (seat.status === "active") seat.hasActedThisRound = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Settlement (pots, rake, showdown)
  // ---------------------------------------------------------------------------

  private settle(showdown: boolean): void {
    this.currentTurnSeat = null;
    this.actionDeadline = undefined;
    const flopSeen = this.community.length >= 3;

    const contenders = this.seats.filter((s) => s.status === "active" || s.status === "allin");
    const pots = this.buildSidePots();

    const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
    let rake = 0;
    if (!(this.config.noFlopNoDrop && !flopSeen)) {
      rake = Math.min(Math.floor((totalPot * this.config.rakePercent) / 100), this.config.rakeCap);
    }
    // Take rake off the top, main pot first.
    let rakeLeft = rake;
    for (const pot of pots) {
      const take = Math.min(pot.amount, rakeLeft);
      pot.amount -= take;
      rakeLeft -= take;
      if (rakeLeft <= 0) break;
    }

    const shownCards: Record<number, Card[]> = {};
    const results: PotResult[] = [];

    for (const pot of pots) {
      if (pot.amount <= 0) continue;
      const eligible = pot.eligibleSeats
        .map((i) => this.seats[i])
        .filter((s) => s.status === "active" || s.status === "allin");
      if (eligible.length === 0) continue;

      let winners: SeatState[];
      let handName: string | undefined;
      if (eligible.length === 1 || !showdown) {
        winners = [eligible[0]];
      } else {
        // Score each eligible player's best 7-card hand.
        let best = -Infinity;
        winners = [];
        for (const s of eligible) {
          const rank = evaluate([...(s.holeCards ?? []), ...this.community]);
          shownCards[s.seatIndex] = s.holeCards ?? [];
          if (rank.score > best) {
            best = rank.score;
            winners = [s];
            handName = CATEGORY_NAMES_FA[rank.category];
          } else if (rank.score === best) {
            winners.push(s);
          }
        }
      }

      // Split the pot; odd chips go to the earliest seat left of the button.
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      const ordered = this.seatsInHandOrder(this.buttonSeat).filter((s) => winners.includes(s));
      const potResult: PotResult = { amount: pot.amount, winners: [] };
      for (const w of ordered) {
        let take = share;
        if (remainder > 0) {
          take += 1;
          remainder -= 1;
        }
        w.stack += take;
        potResult.winners.push({ seatIndex: w.seatIndex, amount: take, handName });
      }
      results.push(potResult);
    }

    // Reveal hole cards of everyone who reached showdown.
    if (showdown) {
      for (const s of contenders) shownCards[s.seatIndex] = s.holeCards ?? [];
    }

    this.lastResult = {
      handNo: this.handNo,
      pots: results,
      rake,
      shownCards,
      deckSeed: this.deck?.seed,
    };

    // Won without a showdown (everyone folded): offer the winner a brief window
    // to voluntarily reveal their cards.
    if (!showdown) {
      const winnerSeat = results[0]?.winners[0]?.seatIndex;
      if (winnerSeat != null) {
        this.showOfferSeat = winnerSeat;
        this.showOfferUntil = Date.now() + 3000;
      }
    } else {
      this.showOfferSeat = undefined;
      this.showOfferUntil = undefined;
    }

    // Now that the pot has been read and distributed, remove players who asked
    // to leave mid-hand (their committed chips have already been settled).
    for (const s of this.seats) {
      if (s.pendingLeave) this.seats[s.seatIndex] = emptySeat(s.seatIndex);
    }
    this.phase = "hand_complete";
  }

  /** Winner voluntarily reveals their hole cards during the show window. */
  showCards(userId: string): void {
    if (this.phase !== "hand_complete") throw new InvalidActionError("الان نمی‌توان کارت نشان داد");
    if (this.showOfferSeat == null || !this.showOfferUntil) throw new InvalidActionError("امکان نمایش کارت نیست");
    if (Date.now() > this.showOfferUntil) throw new InvalidActionError("زمان نمایش کارت گذشت");
    const seat = this.seats[this.showOfferSeat];
    if (!seat || seat.userId !== userId) throw new InvalidActionError("فقط برنده می‌تواند کارت نشان دهد");
    if (this.lastResult && seat.holeCards?.length) {
      this.lastResult.shownCards[seat.seatIndex] = [...seat.holeCards];
    }
    this.clearShowOffer(); // one-shot: hide the offer once revealed
  }

  private clearShowOffer(): void {
    this.showOfferSeat = undefined;
    this.showOfferUntil = undefined;
  }

  /** Add chips directly to a seat (tournament rebuy). Not allowed mid-hand. */
  addChips(userId: string, amount: number): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat || seat.status === "empty") throw new InvalidActionError("بازیکن یافت نشد");
    if (!Number.isFinite(amount) || amount <= 0) throw new InvalidActionError("مبلغ نامعتبر است");
    // Guard on the *game phase* (not seat status): after a showdown settle() sets
    // phase = "hand_complete" without resetting all-in/busted seat statuses, so a
    // status check would wrongly reject a rebuy for a just-busted player. While a
    // hand is live, a seat that is in it (or has chips in the pot) can't be topped
    // up. A seat leaving the table is emptied at settlement, discarding any chips.
    const handInProgress = this.phase !== "waiting" && this.phase !== "hand_complete";
    const inHand = seat.status === "active" || seat.status === "allin";
    if (seat.pendingLeave || (handInProgress && (inHand || seat.committedThisHand > 0))) {
      throw new InvalidActionError("در میانه دست نمی‌توان ژتون اضافه کرد");
    }
    seat.stack += amount;
  }

  /** Toggle a player's sit-out. Takes effect from the next hand. */
  setSitOut(userId: string, out: boolean): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat || seat.status === "empty") throw new InvalidActionError("شما سر این میز نیستید");
    const wasOut = seat.sitOut === true;
    seat.sitOut = out;
    // Only (re)start the expiry clock on the transition INTO sit-out, so a
    // player can't postpone auto-removal by re-toggling.
    if (out && !wasOut) seat.sitOutUntil = Date.now() + this.config.sitOutMaxMin * 60_000;
    else if (!out) seat.sitOutUntil = undefined;
  }

  /** Extend the current player's think time (time bank). */
  requestExtraTime(userId: string): void {
    if (this.currentTurnSeat == null) throw new InvalidActionError("الان نوبت شما نیست");
    const seat = this.seats[this.currentTurnSeat];
    if (!seat || seat.userId !== userId) throw new InvalidActionError("نوبت شما نیست");
    const allowed = this.config.extraTimeRequests; // -1 = unlimited, 0 = off
    if (allowed === 0) throw new InvalidActionError("زمان اضافه در این میز غیرفعال است");
    // At most one extension per turn, even when unlimited per hand — prevents a
    // single decision from being stalled indefinitely.
    if (seat.extraTimeThisTurn) throw new InvalidActionError("این نوبت یک‌بار زمان اضافه گرفته‌اید");
    const used = seat.extraTimeUsed ?? 0;
    if (allowed > 0 && used >= allowed) throw new InvalidActionError("سقف درخواست زمان اضافه پر شده است");
    seat.extraTimeUsed = used + 1;
    seat.extraTimeThisTurn = true;
    this.actionDeadline = (this.actionDeadline ?? Date.now()) + this.config.extraTimeSec * 1000;
  }

  /** Layered side pots from every seat's total commitment this hand. */
  private buildSidePots(): Array<{ amount: number; eligibleSeats: number[] }> {
    const committed = this.seats
      .map((s) => ({ seatIndex: s.seatIndex, amount: s.committedThisHand, folded: s.status === "folded" }))
      .filter((s) => s.amount > 0);
    const levels = Array.from(new Set(committed.map((c) => c.amount))).sort((a, b) => a - b);

    const pots: Array<{ amount: number; eligibleSeats: number[] }> = [];
    let prev = 0;
    for (const level of levels) {
      const contributors = committed.filter((c) => c.amount >= level);
      const amount = (level - prev) * contributors.length;
      const eligibleSeats = contributors
        .filter((c) => !committed.find((x) => x.seatIndex === c.seatIndex)!.folded)
        .map((c) => c.seatIndex);
      if (amount > 0) pots.push({ amount, eligibleSeats });
      prev = level;
    }
    return pots;
  }

  // ---------------------------------------------------------------------------
  // Seat traversal helpers
  // ---------------------------------------------------------------------------

  private seatsInHand(): SeatState[] {
    return this.seats.filter((s) => s.status === "active" || s.status === "allin");
  }

  private activeCount(): number {
    return this.seats.filter((s) => s.status === "active").length;
  }

  /** Seats that are in the hand, ordered starting just left of the button. */
  private seatsInHandOrder(fromExclusive: number): SeatState[] {
    const out: SeatState[] = [];
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const seat = this.seats[(fromExclusive + i) % n];
      if (seat.status === "active" || seat.status === "allin") out.push(seat);
    }
    return out;
  }

  /** Next seat index (clockwise) that is in the current hand. */
  private nextSeatInHand(fromExclusive: number): number {
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromExclusive + i) % n;
      const seat = this.seats[idx];
      if (seat.status === "active" || seat.status === "allin") return idx;
    }
    return fromExclusive;
  }

  /** First seat after `fromExclusive` that still owes an action, or -1. */
  private findNextToAct(fromExclusive: number): number {
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromExclusive + i) % n;
      const seat = this.seats[idx];
      if (seat.status !== "active") continue;
      const needs = !seat.hasActedThisRound || seat.betThisRound < this.currentBet;
      if (needs) return idx;
    }
    return -1;
  }

  private setDeadline(): void {
    // Fresh turn -> the player may take one extra-time extension again.
    if (this.currentTurnSeat != null) this.seats[this.currentTurnSeat].extraTimeThisTurn = false;
    this.actionDeadline = Date.now() + this.config.thinkTimeSec * 1000;
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  get pot(): number {
    return this.seats.reduce((sum, s) => sum + s.committedThisHand, 0);
  }

  /** Public view for a specific viewer (only their own hole cards). */
  publicState(viewerUserId: string | null): PublicGameState {
    const viewerSeat = this.seats.find((s) => s.userId === viewerUserId)?.seatIndex ?? null;
    const showdown = this.phase === "hand_complete";
    const shown = this.lastResult?.shownCards ?? {};

    return {
      tableId: this.tableId,
      config: this.config,
      phase: this.phase,
      handNo: this.handNo,
      buttonSeat: this.buttonSeat,
      currentTurnSeat: this.currentTurnSeat,
      community: this.community,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.pot,
      deckCommitment: this.deckCommitment,
      lastResult: this.lastResult,
      lastAction: this.lastAction,
      actionDeadline: this.actionDeadline,
      showOfferSeat: this.showOfferSeat,
      showOfferUntil: this.showOfferUntil,
      viewerSeat,
      seats: this.seats.map((s) => {
        const isViewer = s.userId != null && s.userId === viewerUserId;
        const revealed = showdown && shown[s.seatIndex] ? shown[s.seatIndex] : undefined;
        const holeCards = isViewer ? s.holeCards : revealed;
        return {
          seatIndex: s.seatIndex,
          userId: s.userId,
          name: s.name,
          stack: s.stack,
          status: s.status,
          betThisRound: s.betThisRound,
          committedThisHand: s.committedThisHand,
          hasActedThisRound: s.hasActedThisRound,
          isConnected: s.isConnected,
          sitOut: s.sitOut,
          sitOutUntil: s.sitOutUntil,
          extraTimeUsed: s.extraTimeUsed,
          hasCards: (s.holeCards?.length ?? 0) > 0,
          holeCards,
        };
      }),
    };
  }

  snapshotSeats(): SeatState[] {
    return this.seats.map((s) => ({ ...s, holeCards: s.holeCards ? [...s.holeCards] : undefined }));
  }
}
