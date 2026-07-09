import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { sanitizeProfile, EMPTY_PROFILE, type ProfileFields } from "@/lib/profile/presets";

function toClient(displayName: string, p: ProfileFields) {
  return {
    displayName,
    avatar: p.avatar,
    tagline: p.tagline,
    title: p.title,
    favoriteCards: p.favorite_cards,
    cardBack: p.card_back,
    chipColor: p.chip_color,
    emotes: p.emotes,
    statsPublic: p.stats_public,
  };
}

export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const [user, row] = await Promise.all([repo.getUserById(session.sub), repo.getProfile(session.sub)]);
    const p: ProfileFields = row ?? { ...EMPTY_PROFILE };
    return json({ profile: toClient(user?.display_name ?? "", p) });
  });
}

export async function PUT(req: Request) {
  return handler(async () => {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));

    // Display name is edited on the user row; everything else is cosmetic.
    if (typeof body.displayName === "string") {
      const name = body.displayName.trim().slice(0, 40);
      if (name.length < 1) return error("نام نمایشی نمی‌تواند خالی باشد");
      await repo.setDisplayName(session.sub, name);
    }

    const fields = sanitizeProfile(body);
    const saved = await repo.upsertProfile(session.sub, fields);
    const user = await repo.getUserById(session.sub);
    return json({ profile: toClient(user?.display_name ?? "", saved) });
  });
}
