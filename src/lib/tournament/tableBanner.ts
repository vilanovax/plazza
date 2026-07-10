import type { TournamentEntryRow, TournamentRow } from "../models";
import { playableLevel } from "./types";

export interface TournamentTableBanner {
  id: string;
  name: string;
  status: string;
  level: number;
  sb: number;
  bb: number;
  ante: number;
  prizePool: number;
  playersLeft: number;
  totalPlayers: number;
  levelEndsAt: string | null;
  onBreak: boolean;
  lateRegOpen: boolean;
  buyInChips: number;
  canRebuy: boolean;
}

export function buildTableBanner(
  t: TournamentRow,
  entries: TournamentEntryRow[],
  viewerUserId: string | null,
  lateRegOpen: boolean
): TournamentTableBanner {
  const active = entries.filter((e) => e.status === "active");
  const levelIdx = Math.min(Math.max(1, t.current_level), t.blind_schedule.length) - 1;
  const level = t.blind_schedule[levelIdx];
  const me = viewerUserId ? entries.find((e) => e.user_id === viewerUserId) : undefined;
  const canRebuy =
    t.status === "running" &&
    t.config.rebuyAllowed &&
    playableLevel(t.blind_schedule, t.current_level) <= t.config.rebuyThroughLevel &&
    me?.status === "active" &&
    Number(me.chips) <= 0 &&
    (t.config.rebuyMaxCount < 0 || (me?.rebuys ?? 0) < t.config.rebuyMaxCount);

  return {
    id: t.id,
    name: t.name,
    status: t.status,
    level: playableLevel(t.blind_schedule, t.current_level),
    sb: level?.sb ?? t.blind_schedule[0]?.sb ?? 0,
    bb: level?.bb ?? t.blind_schedule[0]?.bb ?? 0,
    ante: level?.ante ?? 0,
    prizePool: Number(t.prize_pool),
    playersLeft: active.length,
    totalPlayers: entries.length,
    levelEndsAt: t.level_ends_at,
    onBreak: level?.isBreak === true,
    lateRegOpen,
    buyInChips: Number(t.buy_in_chips),
    canRebuy,
  };
}
