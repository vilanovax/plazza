import type { TableConfig } from "./poker/types";
import type { BlindLevel, TournamentConfig } from "./tournament/types";

export type Role = "admin" | "player";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  chip_balance: number;
  is_active: boolean;
  created_at: string;
}

export interface UserProfileRow {
  user_id: string;
  avatar: string;
  tagline: string;
  title: string;
  favorite_cards: string[];
  card_back: string;
  chip_color: string;
  emotes: string[];
  stats_public: boolean;
  updated_at: string;
}

export interface PokerTableRow {
  id: string;
  name: string;
  config: TableConfig;
  status: "open" | "closed";
  tournament_id: string | null;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export type LedgerType =
  | "admin_credit"
  | "admin_debit"
  | "buy_in"
  | "cash_out"
  | "topup"
  | "win"
  | "loss"
  | "rake"
  | "settlement"
  | "adjustment";

export interface LedgerEntry {
  id: string;
  user_id: string;
  type: LedgerType;
  amount: number;
  balance_after: number;
  table_id: string | null;
  hand_id: string | null;
  counterparty_id: string | null;
  note: string | null;
  settled: boolean;
  settled_by: string | null;
  settled_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TopupRequest {
  id: string;
  user_id: string;
  table_id: string;
  seat_index: number | null;
  amount: number;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AdminSettings {
  default_small_blind: number;
  default_big_blind: number;
  default_rake_percent: number;
  default_rake_cap: number;
  default_think_time_sec: number;
  default_min_buyin: number;
  default_max_buyin: number;
  allow_self_topup: boolean;
  topup_min: number;
  topup_max: number;
  allow_self_register: boolean;
  sit_out_max_min: number;
  extra_time_sec: number;
  extra_time_requests: number;
}

export type TournamentStatus = "scheduled" | "running" | "finished" | "cancelled";

export interface TournamentRow {
  id: string;
  name: string;
  status: TournamentStatus;
  buy_in_chips: number;
  starting_stack: number;
  max_players: number;
  blind_schedule: BlindLevel[];
  config: TournamentConfig;
  created_by: string | null;
  prize_pool: number;
  current_level: number;
  table_id: string | null;
  level_ends_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export type EntryStatus = "registered" | "active" | "busted" | "winner";

export interface TournamentEntryRow {
  tournament_id: string;
  user_id: string;
  chips: number;
  place: number | null;
  status: EntryStatus;
  rebuys: number;
  prize: number;
  registered_at: string;
}
