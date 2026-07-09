import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { sanitizeProfile, EMPTY_PROFILE, type ProfileFields, type ProfileInput } from "@/lib/profile/presets";

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

/** Map a stored profile to the camelCase input shape (for partial-update merges). */
function toInput(p: ProfileFields): ProfileInput {
  return {
    avatar: p.avatar, tagline: p.tagline, title: p.title, favoriteCards: p.favorite_cards,
    cardBack: p.card_back, chipColor: p.chip_color, emotes: p.emotes, statsPublic: p.stats_public,
  };
}

/** Strip control/format/invisible characters so names can't be blank-looking or spoof others. */
function cleanDisplayName(raw: string): string {
  return raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const [user, row] = await Promise.all([repo.getUserById(session.sub), repo.getProfile(session.sub)]);
    if (!user) return error("کاربر یافت نشد", 401);
    const p: ProfileFields = row ?? { ...EMPTY_PROFILE };
    return json({ profile: toClient(user.display_name, p) });
  });
}

export async function PUT(req: Request) {
  return handler(async () => {
    const session = await requireSession();
    const user = await repo.getUserById(session.sub);
    if (!user) return error("کاربر یافت نشد", 401);

    const raw = await req.json().catch(() => ({}));
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    // Display name is edited on the user row; everything else is cosmetic.
    if (typeof body.displayName === "string") {
      const name = cleanDisplayName(body.displayName);
      if (name.length < 1) return error("نام نمایشی نامعتبر است");
      await repo.setDisplayName(session.sub, name);
    }

    // Merge over the existing profile so an omitted field is preserved rather
    // than silently cleared (a partial payload must not wipe other fields).
    const current = await repo.getProfile(session.sub);
    const base = current ? toInput(current) : {};
    const fields = sanitizeProfile({ ...base, ...(body as ProfileInput) });
    const saved = await repo.upsertProfile(session.sub, fields);
    const fresh = await repo.getUserById(session.sub);
    return json({ profile: toClient(fresh?.display_name ?? user.display_name, saved) });
  });
}
