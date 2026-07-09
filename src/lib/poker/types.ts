/**
 * Shared poker types. These are safe to import from client code — none of them
 * contain private information (the deck and other players' hole cards never
 * leave the server; see PublicGameState below).
 */
import type { Card } from "./cards";

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";

/** A line in the table's event feed (join / leave / buy / win / kick …). */
export interface LogEntry {
  id: number;
  ts: number;
  text: string;
  /** "event" = table event (default), "chat" = player message, "allin" = all-in shout. */
  kind?: "event" | "chat" | "allin";
  /** Present for chat/all-in entries so the client can attribute + mute by user. */
  author?: { userId: string; name: string };
}

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise: the total amount the player is raising *to* this round. */
  amount?: number;
}

export type SeatStatus =
  | "empty"
  | "active" // in the current hand, still to act or acted
  | "folded"
  | "allin"
  | "sitting_out"; // seated but not dealt in

export type GamePhase =
  | "waiting" // not enough players / between hands
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "hand_complete";

export interface TableConfig {
  name: string;
  maxSeats: number; // 2..9
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** House rake as a percentage of each pot (0..100). */
  rakePercent: number;
  /** Max chips the house takes per hand. */
  rakeCap: number;
  /** "no flop, no drop": skip rake when the hand ends before the flop. */
  noFlopNoDrop: boolean;
  minBuyIn: number;
  maxBuyIn: number;
  /** Seconds each player has to act before auto fold/check. */
  thinkTimeSec: number;
  /** Whether players may request a top-up when their stack runs out. */
  allowTopUp: boolean;
  topUpMin: number;
  topUpMax: number;
  /** Optional table lifetime in minutes (0 = unlimited). */
  tableDurationMin: number;
  /** Max minutes a player may sit out before being removed from the table. */
  sitOutMaxMin: number;
  /** Seconds added each time a player uses extra time on their turn. */
  extraTimeSec: number;
  /** Extra-time requests allowed per player per hand (-1 = unlimited, 0 = off). */
  extraTimeRequests: number;
}

export interface SeatState {
  seatIndex: number;
  userId: string | null;
  name: string | null;
  stack: number; // chips currently in front of the player at this table
  status: SeatStatus;
  betThisRound: number;
  committedThisHand: number;
  /** Chips the seat had when the current hand was dealt (before blinds/antes).
   *  Used to rank players who bust in the same hand (bigger stack finishes higher). */
  stackAtHandStart?: number;
  hasActedThisRound: boolean;
  isConnected: boolean;
  /** After a sub-minimum all-in, players who already acted may only call/fold. */
  cappedThisRound?: boolean;
  /** Player asked to leave mid-hand; seat is removed once the hand settles. */
  pendingLeave?: boolean;
  /** Player is sitting out (keeps the seat but isn't dealt in). */
  sitOut?: boolean;
  /** Deadline by which a sitting-out player must return or be removed. */
  sitOutUntil?: number;
  /** Extra-time requests already used in the current hand. */
  extraTimeUsed?: number;
  /** Whether extra time was already taken on the current turn. */
  extraTimeThisTurn?: boolean;
  // Private — only ever sent to the owning player.
  holeCards?: Card[];
}

export interface PotResult {
  amount: number;
  winners: Array<{ seatIndex: number; amount: number; handName?: string }>;
}

export interface HandResult {
  handNo: number;
  pots: PotResult[];
  rake: number;
  /** Cards revealed at showdown, keyed by seat index. */
  shownCards: Record<number, Card[]>;
  /** Seed revealed for provable-fairness auditing. */
  deckSeed?: string;
}

/** State the server keeps privately (includes deck + all hole cards). */
export interface GameState {
  tableId: string;
  config: TableConfig;
  phase: GamePhase;
  handNo: number;
  buttonSeat: number;
  currentTurnSeat: number | null;
  seats: SeatState[];
  community: Card[];
  currentBet: number;
  minRaise: number;
  /** Sum of all committed chips this hand (for display; pots computed at end). */
  pot: number;
  /** Commitment (hash) published before the hand for provable fairness. */
  deckCommitment?: string;
  lastResult?: HandResult;
  /** The most recent action, for client-side animation/log. */
  lastAction?: { seatIndex: number; type: ActionType; amount: number };
  /** Unix ms deadline for the current player's action. */
  actionDeadline?: number;
  /** When a hand is won by everyone folding, the winner may reveal their
   *  cards until this deadline. */
  showOfferSeat?: number;
  showOfferUntil?: number;
}

/** Cosmetic profile bits shown at the table (attached by the game manager). */
export interface SeatProfile {
  avatar?: string;
  title?: string;
  tagline?: string;
  chipColor?: string;
}

/** Sanitised state broadcast to a specific viewer (their own cards only). */
export interface PublicGameState extends Omit<GameState, "seats"> {
  seats: Array<Omit<SeatState, "holeCards"> & { holeCards?: Card[]; hasCards: boolean } & SeatProfile>;
  /** The viewing player's own card-back theme (for their hidden cards). */
  myCardBack?: string;
  viewerSeat: number | null;
  /** Recent table events (attached by the game manager on broadcast). */
  log?: LogEntry[];
}
