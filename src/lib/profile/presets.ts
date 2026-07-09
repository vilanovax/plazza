/**
 * Allowlisted cosmetic options for player profiles + validators. Everything a
 * player can set is constrained to a preset so nothing arbitrary (URLs, markup)
 * reaches the DB or other players' screens.
 */
import { RANKS, SUITS } from "../poker/cards";

/** Emoji avatars a player may choose from. */
export const AVATARS = [
  "🐺", "🦈", "🦅", "🐉", "🦁", "🐯", "🐸", "🦊", "🐙", "🦂",
  "👑", "🃏", "🎩", "💎", "🔥", "⚡", "🌟", "🍀", "🧊", "🧠",
] as const;

/** Card-back themes (id → display colour). */
export const CARD_BACKS: Array<{ id: string; color: string; name: string }> = [
  { id: "classic", color: "#b0203a", name: "کلاسیک" },
  { id: "ocean", color: "#0a7d6b", name: "اقیانوس" },
  { id: "night", color: "#1e2a44", name: "شب" },
  { id: "gold", color: "#b8860b", name: "طلایی" },
  { id: "violet", color: "#6a3d9a", name: "بنفش" },
];

/** Personal chip colours (hex). */
export const CHIP_COLORS = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#f39c12", "#16a085", "#2c3e50"] as const;

/** Emotes a player may pin (quick-send at the table). */
export const EMOTES = [
  "👍", "😂", "😎", "😱", "🤔", "😭", "🔥", "💪",
  "🍀", "🤯", "👏", "🙈", "🃏", "💰", "🧊", "🧠",
] as const;

/** Ready-made quick-chat phrases players can send with one tap. */
export const QUICK_CHAT = [
  "سلام!",
  "خوش‌شانسی!",
  "دست خوب بود 👏",
  "بلوف بود؟ 😏",
  "کال می‌کنم",
  "فولد!",
  "آل‌این! 🔥",
  "عجله نکن ⏳",
  "خداحافظ 👋",
  "دوباره بازی؟",
] as const;

export const TAGLINE_MAX = 60;
export const TITLE_MAX = 30;
export const MAX_FAVORITE_CARDS = 2;
export const MAX_EMOTES = 6;

/** All 52 valid card codes (rank+suit, e.g. "As", "7c"). */
export const VALID_CARDS: ReadonlySet<string> = new Set(
  RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`))
);

export interface ProfileInput {
  avatar?: unknown;
  tagline?: unknown;
  title?: unknown;
  favoriteCards?: unknown;
  cardBack?: unknown;
  chipColor?: unknown;
  emotes?: unknown;
  statsPublic?: unknown;
}

export interface ProfileFields {
  avatar: string;
  tagline: string;
  title: string;
  favorite_cards: string[];
  card_back: string;
  chip_color: string;
  emotes: string[];
  stats_public: boolean;
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function pickFrom(v: unknown, allowed: ReadonlySet<string> | readonly string[]): string {
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  return typeof v === "string" && set.has(v) ? v : "";
}

/** Coerce raw client input into safe, allowlisted profile fields. */
export function sanitizeProfile(input: ProfileInput): ProfileFields {
  const favRaw = Array.isArray(input.favoriteCards) ? input.favoriteCards : [];
  const favorite_cards = [...new Set(favRaw.filter((c): c is string => typeof c === "string" && VALID_CARDS.has(c)))].slice(
    0,
    MAX_FAVORITE_CARDS
  );
  const emoteSet = new Set<string>(EMOTES);
  const emotesRaw = Array.isArray(input.emotes) ? input.emotes : [];
  const emotes = [...new Set(emotesRaw.filter((e): e is string => typeof e === "string" && emoteSet.has(e)))].slice(0, MAX_EMOTES);
  return {
    avatar: pickFrom(input.avatar, new Set<string>(AVATARS)),
    tagline: cleanText(input.tagline, TAGLINE_MAX),
    title: cleanText(input.title, TITLE_MAX),
    favorite_cards,
    card_back: pickFrom(input.cardBack, CARD_BACKS.map((c) => c.id)),
    chip_color: pickFrom(input.chipColor, new Set<string>(CHIP_COLORS)),
    emotes,
    stats_public: input.statsPublic !== false, // default public
  };
}

export const EMPTY_PROFILE: ProfileFields = {
  avatar: "",
  tagline: "",
  title: "",
  favorite_cards: [],
  card_back: "",
  chip_color: "",
  emotes: [],
  stats_public: true,
};
