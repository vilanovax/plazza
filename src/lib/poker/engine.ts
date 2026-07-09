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

export class InvalidActionError extends Error {}

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

  private deck: ShuffledDeck | null = null;

  constructor(tableId: string, config: TableConfig, seats?: SeatState[]) {
    this.tableId = tableId;
    this.config = config;
    this.seats = seats ?? Array.from({ length: config.maxSeats }, (_, i) => emptySeat(i));
    this.minRaise = config.bigBlind;
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
  }

  /** Remove a player. Returns the chips they take away from the table. */
  leave(seatIndex: number): number {
    const seat = this.seats[seatIndex];
    if (!seat || seat.status === "empty") return 0;
    const chips = seat.stack;
    if (seat.status === "active" || seat.status === "allin") {
      // Fold them out of the live hand before removing.
      seat.status = "folded";
      if (this.currentTurnSeat === seatIndex) this.advance();
    }
    this.seats[seatIndex] = emptySeat(seatIndex);
    return chips;
  }

  setConnected(userId: string, connected: boolean): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (seat) seat.isConnected = connected;
  }

  topUp(seatIndex: number, amount: number): void {
    const seat = this.seats[seatIndex];
    if (!seat || seat.status === "empty") throw new InvalidActionError("صندلی نامعتبر است");
    // Chips added while in a hand only take effect between hands is simplest;
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
    return this.seats.filter((s) => s.userId && s.stack > 0 && s.status !== "empty");
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

    // Reset every seat for the new hand.
    for (const seat of this.seats) {
      seat.betThisRound = 0;
      seat.committedThisHand = 0;
      seat.hasActedThisRound = false;
      seat.holeCards = undefined;
      if (seat.userId && seat.stack > 0) seat.status = "active";
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
      target = Math.floor(action.amount ?? 0);
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

    const raiseSize = target - this.currentBet;
    this.commitChips(seat, target - seat.betThisRound);

    // A full-size raise reopens the betting for everyone else.
    if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
    this.currentBet = target;
    for (const s of this.seats) {
      if (s !== seat && s.status === "active") s.hasActedThisRound = false;
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
    this.phase = "hand_complete";
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
