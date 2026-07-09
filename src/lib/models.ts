import type { TableConfig } from "./poker/types";

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
}
