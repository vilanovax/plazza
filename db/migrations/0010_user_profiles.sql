-- Per-player profile: cosmetic identity + a stats-visibility toggle. Kept in a
-- 1:1 side table so future additions (medals, achievements) don't bloat `users`.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar         TEXT NOT NULL DEFAULT '',       -- an allowlisted emoji
  tagline        TEXT NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 60),
  title          TEXT NOT NULL DEFAULT '' CHECK (char_length(title)   <= 30),
  favorite_cards TEXT[] NOT NULL DEFAULT '{}',   -- up to 2 card codes (e.g. {7c,2d})
  card_back      TEXT NOT NULL DEFAULT '',       -- allowlisted card-back theme id
  chip_color     TEXT NOT NULL DEFAULT '',       -- allowlisted chip colour
  emotes         TEXT[] NOT NULL DEFAULT '{}',   -- pinned quick-emotes
  stats_public   BOOLEAN NOT NULL DEFAULT TRUE,  -- may others see my stats?
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bound the arrays so a client can't stuff unbounded data.
  CONSTRAINT user_profiles_fav_len CHECK (array_length(favorite_cards, 1) IS NULL OR array_length(favorite_cards, 1) <= 2),
  CONSTRAINT user_profiles_emotes_len CHECK (array_length(emotes, 1) IS NULL OR array_length(emotes, 1) <= 6)
);
