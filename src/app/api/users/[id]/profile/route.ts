import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { deriveHonors } from "@/lib/profile/honors";
import { CATEGORY_NAMES_FA, type HandCategory } from "@/lib/poker/evaluator";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public profile view: cosmetics + honors are always visible to any signed-in
// user; the numeric lifetime stats are gated by the owner's stats_public flag
// (self/admin always see them).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    // Validate the id shape before hitting the DB so a bad segment is a clean
    // 404, not a Postgres UUID cast error.
    if (!UUID_RE.test(id)) return error("کاربر یافت نشد", 404);

    const [user, profile] = await Promise.all([repo.getUserById(id), repo.getProfile(id)]);
    if (!user) return error("کاربر یافت نشد", 404);

    // Compare against the canonical DB id (UUIDs are case-insensitive in PG).
    const canSeeStats = session.sub === user.id || session.role === "admin" || (profile?.stats_public ?? true);

    // Stats are always computed so honors can be derived for everyone; only the
    // numeric block is withheld when the owner has made stats private.
    const stats = await repo.getGlobalPlayerStats(id);
    const honors = deriveHonors(stats);
    const base = {
      userId: user.id,
      displayName: user.display_name,
      avatar: profile?.avatar ?? "",
      title: profile?.title ?? "",
      tagline: profile?.tagline ?? "",
      favoriteCards: profile?.favorite_cards ?? [],
      cardBack: profile?.card_back ?? "",
      chipColor: profile?.chip_color ?? "",
      // statsVisible = whether THIS viewer may see the numbers; statsPublic =
      // the owner's actual privacy preference (distinct concepts).
      statsVisible: canSeeStats,
      statsPublic: profile?.stats_public ?? true,
      honors,
    };
    if (!canSeeStats) return json({ profile: base });

    const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;
    const bestHandName = stats.bestHandRank == null ? null : CATEGORY_NAMES_FA[stats.bestHandRank as HandCategory];
    return json({ profile: { ...base, stats: { ...stats, winRate, bestHandName } } });
  });
}
