"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PublicGameState } from "@/lib/poker/types";
import {
  sound,
  subscribeMuted,
  getMutedSnapshot,
  getMutedServerSnapshot,
  setMutedPref,
} from "@/lib/client/sounds";

const BETTING = new Set(["preflop", "flop", "turn", "river"]);

/**
 * Drives all table sounds from game-state transitions:
 *  - your turn, new hand (shuffle), each dealt street, chips/check/fold for
 *    other players, a win fanfare, and a ticking warning in the last 30% of
 *    the think timer. Returns a mute toggle persisted to localStorage.
 *
 * The very first state received (page load / reconnect) only seeds the
 * baseline — it never plays sounds for events that already happened.
 */
export function useTableSounds(state: PublicGameState | null, viewerSeat: number | null) {
  // Read the mute preference without any hydration mismatch (server = false).
  const muted = useSyncExternalStore(subscribeMuted, getMutedSnapshot, getMutedServerSnapshot);

  const prev = useRef({ handNo: 0, community: 0, turn: null as number | null, action: "", phase: "" });
  const seeded = useRef(false);

  // Keep the audio engine's mute flag in sync + unlock on the first gesture.
  useEffect(() => {
    sound.setMuted(muted);
    const unlock = () => sound.ensure();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [muted]);

  const toggleMute = useCallback(() => {
    const next = !getMutedSnapshot();
    setMutedPref(next);
    if (!next) sound.ensure();
  }, []);

  // Event-driven sounds.
  useEffect(() => {
    if (!state) return;
    const p = prev.current;

    // First state after (re)connect: seed the baseline silently.
    if (!seeded.current) {
      seeded.current = true;
      p.handNo = state.handNo;
      p.community = state.community.length;
      p.turn = state.currentTurnSeat;
      p.phase = state.phase;
      p.action = state.lastAction
        ? `${state.handNo}:${state.lastAction.seatIndex}:${state.lastAction.type}:${state.lastAction.amount}`
        : "";
      return;
    }

    if (state.handNo > p.handNo) {
      sound.newHand();
      const dealt = state.seats.filter((s) => s.hasCards).length;
      if (dealt > 0) sound.dealCards(Math.min(dealt, 9));
    }
    if (state.community.length > p.community) {
      sound.dealCards(state.community.length - p.community);
    }

    const myTurn = state.currentTurnSeat === viewerSeat && BETTING.has(state.phase);
    const wasMyTurn = p.turn === viewerSeat && p.turn !== null;
    if (myTurn && !wasMyTurn) sound.turn();

    const la = state.lastAction;
    const actKey = la ? `${state.handNo}:${la.seatIndex}:${la.type}:${la.amount}` : "";
    if (actKey && actKey !== p.action) {
      // Any action that leaves the actor all-in gets the dramatic sound — a
      // call/bet/raise that empties the stack has its raw type, not "allin".
      const wentAllIn = !!la && (la.type === "allin" || state.seats[la.seatIndex]?.status === "allin");
      if (wentAllIn) {
        sound.allin(); // plays for everyone at the table, including the actor
      } else if (la && la.seatIndex !== viewerSeat) {
        if (la.type === "fold") sound.fold();
        else if (la.type === "check") sound.check();
        else if (["call", "bet", "raise"].includes(la.type)) sound.chips();
      }
      p.action = actKey;
    }

    if (state.phase === "hand_complete" && p.phase !== "hand_complete") {
      const won = state.lastResult?.pots.some((pot) => pot.winners.some((w) => w.seatIndex === viewerSeat));
      if (won) sound.win();
    }

    p.handNo = state.handNo;
    p.community = state.community.length;
    p.turn = state.currentTurnSeat;
    p.phase = state.phase;
  }, [state, viewerSeat]);

  // Ticking warning during the final 30% of the think timer (viewer's turn).
  const deadline = state?.actionDeadline;
  const thinkMs = (state?.config.thinkTimeSec ?? 0) * 1000;
  const myTurnNow = !!state && state.currentTurnSeat === viewerSeat && BETTING.has(state.phase);
  useEffect(() => {
    if (!myTurnNow || !deadline || thinkMs <= 0) return;
    const threshold = thinkMs * 0.3;
    let lastSec = -1;
    const id = setInterval(() => {
      const remaining = deadline - Date.now();
      if (remaining > 0 && remaining <= threshold) {
        const sec = Math.ceil(remaining / 1000);
        if (sec !== lastSec) {
          lastSec = sec;
          sound.tick();
        }
      }
    }, 200);
    return () => clearInterval(id);
  }, [myTurnNow, deadline, thinkMs]);

  return { muted, toggleMute };
}
