"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicGameState, PlayerAction } from "@/lib/poker/types";
import type { TournamentTableBanner } from "@/lib/tournament/tableBanner";

export interface TableSocket {
  state: PublicGameState | null;
  tourney: TournamentTableBanner | null;
  connected: boolean;
  error: string | null;
  clearError: () => void;
  sit: (seatIndex: number, buyIn: number) => void;
  leaveSeat: () => void;
  act: (action: PlayerAction) => void;
  topup: (amount: number) => void;
  showCards: () => void;
  sitOut: (out: boolean) => void;
  requestExtraTime: () => void;
  kick: (seatIndex: number, userId: string) => void;
  rebuy: () => void;
  forfeitTournament: () => void;
  chat: (text: string) => void;
}

export function useTableSocket(tableId: string, invite?: string): TableSocket {
  const [state, setState] = useState<PublicGameState | null>(null);
  const [tourney, setTourney] = useState<TournamentTableBanner | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ path: "/api/socket", withCredentials: true, transports: ["websocket", "polling"] });
    sockRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", { tableId, invite });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => setError(e.message === "unauthorized" ? "احراز هویت ناموفق" : "اتصال برقرار نشد"));
    socket.on("state", (s: PublicGameState) => setState(s));
    socket.on("tournament_update", (t: TournamentTableBanner | null) => setTourney(t));
    socket.on("action_error", ({ message }: { message: string }) => setError(message));

    return () => {
      socket.disconnect();
      sockRef.current = null;
    };
  }, [tableId, invite]);

  const sit = useCallback((seatIndex: number, buyIn: number) => sockRef.current?.emit("sit", { tableId, seatIndex, buyIn }), [tableId]);
  const leaveSeat = useCallback(() => sockRef.current?.emit("leave_seat", { tableId }), [tableId]);
  const act = useCallback((action: PlayerAction) => sockRef.current?.emit("action", { tableId, action }), [tableId]);
  const topup = useCallback((amount: number) => sockRef.current?.emit("topup", { tableId, amount }), [tableId]);
  const showCards = useCallback(() => sockRef.current?.emit("show_cards", { tableId }), [tableId]);
  const sitOut = useCallback((out: boolean) => sockRef.current?.emit("sit_out", { tableId, out }), [tableId]);
  const requestExtraTime = useCallback(() => sockRef.current?.emit("extra_time", { tableId }), [tableId]);
  const kick = useCallback((seatIndex: number, userId: string) => sockRef.current?.emit("kick", { tableId, seatIndex, userId }), [tableId]);
  const rebuy = useCallback(() => sockRef.current?.emit("rebuy", { tableId }), [tableId]);
  const forfeitTournament = useCallback(() => sockRef.current?.emit("forfeit_tournament", { tableId }), [tableId]);
  const chat = useCallback((text: string) => sockRef.current?.emit("chat", { tableId, text }), [tableId]);
  const clearError = useCallback(() => setError(null), []);

  return { state, tourney, connected, error, clearError, sit, leaveSeat, act, topup, showCards, sitOut, requestExtraTime, kick, rebuy, forfeitTournament, chat };
}
