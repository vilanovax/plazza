import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { deriveHonors } from "@/lib/profile/honors";

// Public profile view: cosmetics + honors are always visible to any signed-in
// user; the numeric lifetime stats are gated by the owner's stats_public flag
// (self/admin always see them).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    const [user, profile] = await Promise.all([repo.getUserById(id), repo.getProfile(id)]);
    if (!user) return error("کاربر یافت نشد", 404);

    const canSeeStats = session.sub === id || session.role === "admin" || (profile?.stats_public ?? true);
    const base = {
      userId: user.id,
      displayName: user.display_name,
      avatar: profile?.avatar ?? "",
      title: profile?.title ?? "",
      tagline: profile?.tagline ?? "",
      favoriteCards: profile?.favorite_cards ?? [],
      cardBack: profile?.card_back ?? "",
      chipColor: profile?.chip_color ?? "",
      statsPublic: canSeeStats,
    };
    if (!canSeeStats) return json({ profile: base });

    const stats = await repo.getGlobalPlayerStats(id);
    const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;
    return json({ profile: { ...base, stats: { ...stats, winRate }, honors: deriveHonors(stats) } });
  });
}
