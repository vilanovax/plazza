import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

// Per-table statistics for one player. Access is restricted to the player
// themselves, admins, or someone currently seated at that table — and we check
// authorization BEFORE any user lookup so this can't be used to enumerate users.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  return handler(async () => {
    const session = await requireSession();
    const { id, userId } = await params;

    const seats = await repo.listSeats(id);
    const callerSeated = seats.some((s) => s.user_id === session.sub);
    const authorized = session.sub === userId || session.role === "admin" || callerSeated;
    if (!authorized) return error("دسترسی ندارید", 403);

    const user = await repo.getUserById(userId);
    if (!user) return error("کاربر یافت نشد", 404);
    const stats = await repo.getPlayerTableStats(id, userId);
    const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;
    return json({
      displayName: user.display_name,
      handsPlayed: stats.handsPlayed,
      handsWon: stats.handsWon,
      winRate,
      buyInCount: stats.buyInCount,
      totalBought: stats.totalBought,
      net: stats.net,
    });
  });
}
