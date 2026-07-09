import { handler, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { tournamentManager } from "@/server/tournamentManager";
import { playableLevel } from "@/lib/tournament/types";

// Live tournament summary for the table view (null if the table isn't one).
export async function GET(_req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { tableId } = await params;
    const t = await repo.getTournamentByTable(tableId);
    if (!t) return json({ tournament: null });

    const entries = await repo.listEntries(t.id);
    const active = entries.filter((e) => e.status === "active");
    const level = t.blind_schedule[Math.min(Math.max(1, t.current_level), t.blind_schedule.length) - 1];
    const me = entries.find((e) => e.user_id === session.sub);
    const canRebuy =
      t.status === "running" &&
      t.config.rebuyAllowed &&
      t.current_level <= t.config.rebuyThroughLevel &&
      me?.status === "active" &&
      Number(me.chips) <= 0 &&
      (t.config.rebuyMaxCount < 0 || (me?.rebuys ?? 0) < t.config.rebuyMaxCount);

    return json({
      tournament: {
        id: t.id,
        name: t.name,
        status: t.status,
        level: playableLevel(t.blind_schedule, t.current_level), // playable level (breaks excluded)
        sb: level?.sb ?? t.blind_schedule[0]?.sb ?? 0,
        bb: level?.bb ?? t.blind_schedule[0]?.bb ?? 0,
        ante: level?.ante ?? 0,
        prizePool: Number(t.prize_pool),
        playersLeft: active.length,
        totalPlayers: entries.length,
        levelEndsAt: t.level_ends_at,
        onBreak: level?.isBreak === true,
        lateRegOpen: tournamentManager.lateRegOpen(t),
        payouts: t.config.payouts,
        buyInChips: Number(t.buy_in_chips),
        canRebuy,
      },
    });
  });
}
