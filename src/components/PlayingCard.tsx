"use client";
import { rankOf, suitOf, RANKS, SUIT_SYMBOLS, type Card } from "@/lib/poker/cards";

const RED_SUITS = new Set([1, 2]); // diamonds, hearts

export function PlayingCard({ card, small, hidden }: { card?: Card; small?: boolean; hidden?: boolean }) {
  const w = small ? 34 : 46;
  const h = small ? 48 : 64;

  if (hidden || card == null) {
    return (
      <div
        style={{
          width: w,
          height: h,
          borderRadius: 7,
          background: "repeating-linear-gradient(45deg,#7d1d2b,#7d1d2b 6px,#8f2333 6px,#8f2333 12px)",
          border: "1px solid #d9b45b55",
          boxShadow: "0 2px 6px rgba(0,0,0,.35)",
        }}
      />
    );
  }

  const r = RANKS[rankOf(card)];
  const s = suitOf(card);
  const red = RED_SUITS.has(s);

  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 7,
        background: "#f6f7f9",
        border: "1px solid #cfd6de",
        boxShadow: "0 2px 6px rgba(0,0,0,.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: red ? "#d21b30" : "#14181d",
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: small ? 15 : 20 }}>{r}</span>
      <span style={{ fontSize: small ? 15 : 20 }}>{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}
