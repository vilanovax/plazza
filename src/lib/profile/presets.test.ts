import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeProfile,
  AVATARS,
  CARD_BACKS,
  CHIP_COLORS,
  EMOTES,
  TAGLINE_MAX,
  MAX_FAVORITE_CARDS,
  MAX_EMOTES,
} from "./presets";

test("sanitizeProfile keeps allowlisted values", () => {
  const p = sanitizeProfile({
    avatar: AVATARS[0],
    title: "سلطان",
    tagline: "بلوف تخصص منه",
    favoriteCards: ["7c", "2d"],
    cardBack: CARD_BACKS[1].id,
    chipColor: CHIP_COLORS[0],
    emotes: [EMOTES[0], EMOTES[1]],
    statsPublic: true,
  });
  assert.equal(p.avatar, AVATARS[0]);
  assert.equal(p.title, "سلطان");
  assert.deepEqual(p.favorite_cards, ["7c", "2d"]);
  assert.equal(p.card_back, CARD_BACKS[1].id);
  assert.equal(p.chip_color, CHIP_COLORS[0]);
  assert.deepEqual(p.emotes, [EMOTES[0], EMOTES[1]]);
  assert.equal(p.stats_public, true);
});

test("sanitizeProfile rejects non-allowlisted values", () => {
  const p = sanitizeProfile({
    avatar: "<script>",
    cardBack: "evil",
    chipColor: "javascript:alert(1)",
    favoriteCards: ["ZZ", "99x", "Ah"],
    emotes: ["👍", "💀"],
  });
  assert.equal(p.avatar, "", "bad avatar dropped");
  assert.equal(p.card_back, "", "bad card back dropped");
  assert.equal(p.chip_color, "", "bad chip colour dropped");
  assert.deepEqual(p.favorite_cards, ["Ah"], "only the valid card kept");
  assert.deepEqual(p.emotes, ["👍"], "disallowed emote dropped");
});

test("sanitizeProfile caps array lengths and dedupes", () => {
  const p = sanitizeProfile({
    favoriteCards: ["7c", "2d", "As", "Kh", "7c"], // 5 with a dup
    emotes: [...EMOTES, ...EMOTES], // way over the cap, all dups
  });
  assert.equal(p.favorite_cards.length, MAX_FAVORITE_CARDS);
  assert.deepEqual(p.favorite_cards, ["7c", "2d"]);
  assert.equal(p.emotes.length, MAX_EMOTES);
  assert.equal(new Set(p.emotes).size, p.emotes.length, "emotes deduped");
});

test("sanitizeProfile trims/caps free text and defaults stats_public to true", () => {
  const long = "x".repeat(200);
  const p = sanitizeProfile({ tagline: `  ${long}  ` });
  assert.equal(p.tagline.length, TAGLINE_MAX);
  assert.equal(p.stats_public, true, "omitted statsPublic defaults to public");
  assert.equal(sanitizeProfile({ statsPublic: false }).stats_public, false);
});

test("sanitizeProfile tolerates non-array / wrong-typed inputs", () => {
  const p = sanitizeProfile({ favoriteCards: "7c" as unknown, emotes: 5 as unknown, avatar: 42 as unknown });
  assert.deepEqual(p.favorite_cards, []);
  assert.deepEqual(p.emotes, []);
  assert.equal(p.avatar, "");
});
