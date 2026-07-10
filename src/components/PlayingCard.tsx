"use client";
import { rankOf, suitOf, RANKS, SUIT_SYMBOLS, type Card } from "@/lib/poker/cards";
import { cardBackColor } from "@/lib/profile/presets";

const RED_SUITS = new Set([1, 2]); // diamonds, hearts

export function PlayingCard({
  card,
  small,
  hidden,
  cardBack,
}: {
  card?: Card;
  small?: boolean;
  hidden?: boolean;
  cardBack?: string;
}) {
  const className = [
    "playing-card",
    small && "playing-card--small",
    hidden || card == null ? "playing-card--hidden" : "playing-card--face",
    !hidden && card != null && RED_SUITS.has(suitOf(card)) && "playing-card--red",
  ]
    .filter(Boolean)
    .join(" ");

  if (hidden || card == null) {
    return (
      <div
        className={className}
        aria-hidden
        style={{ "--card-back": cardBackColor(cardBack) } as React.CSSProperties}
      />
    );
  }

  const r = RANKS[rankOf(card)];
  const s = suitOf(card);

  return (
    <div className={className}>
      <span className="playing-card-rank">{r}</span>
      <span className="playing-card-suit">{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}
