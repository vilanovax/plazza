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
    const isSelf = session.sub === userId;
    const isAdmin = session.role === "admin";
    const callerSeated = seats.some((s) => s.user_id === session.sub);
    const targetSeated = seats.some((s) => s.user_id === userId);
    // The caller must be at the table (or self/admin). The *target* must also be
    // at this table (or be the caller/admin) — this endpoint is table-scoped, so
    // it must not leak an arbitrary user's global profile.
    if (!(isSelf || isAdmin || callerSeated)) return error("دسترسی ندارید", 403);
    if (!(isSelf || isAdmin || targetSeated)) return error("کاربر یافت نشد", 404);

    const [user, profile] = await Promise.all([repo.getUserById(userId), repo.getProfile(userId)]);
    if (!user) return error("کاربر یافت نشد", 404);

    // Cosmetic profile is always shown; numeric stats are hidden when the player
    // opted out (unless the viewer is that player or an admin).
    const canSeeStats = isSelf || isAdmin || (profile?.stats_public ?? true);
    const base = {
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
    };
    if (!canSeeStats) return json(base);

    // Only run the (heavier) aggregation when the numbers will actually be shown.
    const stats = await repo.getPlayerTableStats(id, userId);
    const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;
    return json({
      ...base,
      handsPlayed: stats.handsPlayed,
      handsWon: stats.handsWon,
      winRate,
      buyInCount: stats.buyInCount,
      totalBought: stats.totalBought,
      net: stats.net,
    });
  });
}
