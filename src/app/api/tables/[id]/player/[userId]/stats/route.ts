import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

// Per-table statistics for one player (any seated viewer may look these up).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  return handler(async () => {
    await requireSession();
    const { id, userId } = await params;
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
