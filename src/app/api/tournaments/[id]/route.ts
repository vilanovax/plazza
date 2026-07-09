import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    const t = await repo.getTournament(id);
    if (!t) return error("تورنومنت یافت نشد", 404);
    const entries = await repo.listEntries(id);
    const users = await repo.getUsersByIds(entries.map((e) => e.user_id));
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    // Live stack sizes are only exposed to the admin and to players actually in
    // the tournament — a spectator shouldn't see everyone's exact chip counts.
    const isParticipant = entries.some((e) => e.user_id === session.sub);
    const seeChips = session.role === "admin" || isParticipant;
    return json({
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
    });
  });
}
