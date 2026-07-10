import type { TournamentEntryRow, TournamentRow } from "../models";
import type { BlindLevel } from "./types";

export interface TournamentDetailEntry {
  userId: string;
  name: string;
  status: string;
  chips: number;
  place: number | null;
  rebuys: number;
  prize: number;
}

export interface TournamentDetail {
  id: string;
  name: string;
  status: string;
  buyInChips: number;
  startingStack: number;
  maxPlayers: number;
  prizePool: number;
  currentLevel: number;
  levelEndsAt: string | null;
  tableId: string | null;
  config: TournamentRow["config"];
  entries: TournamentDetailEntry[];
  blindSchedule: BlindLevel[];
}

export function buildTournamentDetail(
  t: TournamentRow,
  entries: TournamentEntryRow[],
  names: Map<string, string>,
  viewerUserId: string,
  viewerRole: "admin" | "player"
): TournamentDetail {
  const isParticipant = entries.some((e) => e.user_id === viewerUserId);
  const seeChips = viewerRole === "admin" || isParticipant;

  return {
    id: t.id,
    name: t.name,
    status: t.status,
    buyInChips: Number(t.buy_in_chips),
    startingStack: Number(t.starting_stack),
    maxPlayers: t.max_players,
    blindSchedule: t.blind_schedule,
    config: t.config,
    prizePool: Number(t.prize_pool),
    currentLevel: t.current_level,
    levelEndsAt: t.level_ends_at,
    tableId: t.table_id,
    entries: entries.map((e) => ({
      userId: e.user_id,
      name: names.get(e.user_id) ?? "?",
      status: e.status,
      chips: seeChips ? Number(e.chips) : 0,
      place: e.place,
      rebuys: e.rebuys,
      prize: Number(e.prize),
    })),
  };
}
