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

    const [user, profile] = await Promise.all([repo.getUserById(userId), repo.getProfile(userId)]);
    if (!user) return error("کاربر یافت نشد", 404);

    // Cosmetic profile is always shown; numeric stats are hidden when the player
    // opted out (unless the viewer is that player or an admin).
    const canSeeStats = session.sub === userId || session.role === "admin" || (profile?.stats_public ?? true);
    const stats = await repo.getPlayerTableStats(id, userId);
    const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;
    return json({
      displayName: user.display_name,
      profile: {
        avatar: profile?.avatar ?? "",
        title: profile?.title ?? "",
        tagline: profile?.tagline ?? "",
        favoriteCards: profile?.favorite_cards ?? [],
        cardBack: profile?.card_back ?? "",
        chipColor: profile?.chip_color ?? "",
      },
      statsPublic: canSeeStats,
      ...(canSeeStats
        ? {
            handsPlayed: stats.handsPlayed,
            handsWon: stats.handsWon,
            winRate,
            buyInCount: stats.buyInCount,
            totalBought: stats.totalBought,
            net: stats.net,
          }
        : {}),
    });
  });
}
