import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireSession();
    const { id } = await params;
    const t = await repo.getTournament(id);
    if (!t) return error("تورنومنت یافت نشد", 404);
    const [entries, users] = await Promise.all([repo.listEntries(id), repo.listUsers()]);
    const names = new Map(users.map((u) => [u.id, u.display_name]));
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
      tableId: t.table_id,
      entries: entries.map((e) => ({
        userId: e.user_id,
        name: names.get(e.user_id) ?? "?",
        status: e.status,
        chips: Number(e.chips),
        place: e.place,
        rebuys: e.rebuys,
        prize: Number(e.prize),
      })),
    });
  });
}
