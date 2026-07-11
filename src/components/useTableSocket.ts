"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicGameState, PlayerAction } from "@/lib/poker/types";
import type { TournamentTableBanner } from "@/lib/tournament/tableBanner";

export interface TopupResult {
  // The server only ever emits an authoritative outcome (a duplicate retry gets
  // the original's cached result), so there is no separate "duplicate" status.
  status: "approved" | "pending";
  amount: number;
  requestId?: string;
}

export interface TableSocket {
  state: PublicGameState | null;
  tourney: TournamentTableBanner | null;
  connected: boolean;
  error: string | null;
  clearError: () => void;
  topupResult: TopupResult | null;
  clearTopupResult: () => void;
  sit: (seatIndex: number, buyIn: number) => void;
  leaveSeat: () => void;
  act: (action: PlayerAction) => void;
  topup: (amount: number, requestId: string) => void;
  showCards: () => void;
  sitOut: (out: boolean) => void;
  setReady: (ready: boolean) => void;
  requestExtraTime: () => void;
  kick: (seatIndex: number, userId: string) => void;
  ban: (userId: string) => void;
  rebuy: () => void;
  forfeitTournament: () => void;
  chat: (text: string) => void;
}

export function useTableSocket(tableId: string, invite?: string): TableSocket {
  const [state, setState] = useState<PublicGameState | null>(null);
  const [tourney, setTourney] = useState<TournamentTableBanner | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topupResult, setTopupResult] = useState<TopupResult | null>(null);
  const sockRef = useRef<Socket | null>(null);
  // Highest broadcast seq applied, so a delayed/out-of-order "state" is dropped.
  const lastSeq = useRef<number | null>(null);

  useEffect(() => {
    const socket = io({ path: "/api/socket", withCredentials: true, transports: ["websocket", "polling"] });
    sockRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // The server's seq resets on restart, so forget it on every (re)connect.
      lastSeq.current = null;
      socket.emit("join", { tableId, invite });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => setError(e.message === "unauthorized" ? "احراز هویت ناموفق" : "اتصال برقرار نشد"));
    socket.on("state", (s: PublicGameState) => {
      // Keep only the newest state; drop a stale or out-of-order broadcast.
      if (typeof s.seq === "number") {
        if (lastSeq.current !== null && s.seq <= lastSeq.current) return;
        lastSeq.current = s.seq;
      }
      setState(s);
    });
    socket.on("tournament_update", (t: TournamentTableBanner | null) => setTourney(t));
    socket.on("action_error", ({ message }: { message: string }) => setError(message));
    socket.on("topup_result", (r: TopupResult) => setTopupResult(r));

    return () => {
      socket.disconnect();
      sockRef.current = null;
    };
  }, [tableId, invite]);

  const sit = useCallback((seatIndex: number, buyIn: number) => sockRef.current?.emit("sit", { tableId, seatIndex, buyIn }), [tableId]);
  const leaveSeat = useCallback(() => sockRef.current?.emit("leave_seat", { tableId }), [tableId]);
  const act = useCallback((action: PlayerAction) => sockRef.current?.emit("action", { tableId, action }), [tableId]);
  const topup = useCallback((amount: number, requestId: string) => sockRef.current?.emit("topup", { tableId, amount, requestId }), [tableId]);
  const showCards = useCallback(() => sockRef.current?.emit("show_cards", { tableId }), [tableId]);
  const sitOut = useCallback((out: boolean) => sockRef.current?.emit("sit_out", { tableId, out }), [tableId]);
  const setReady = useCallback((ready: boolean) => sockRef.current?.emit("ready", { tableId, ready }), [tableId]);
  const requestExtraTime = useCallback(() => sockRef.current?.emit("extra_time", { tableId }), [tableId]);
  const kick = useCallback((seatIndex: number, userId: string) => sockRef.current?.emit("kick", { tableId, seatIndex, userId }), [tableId]);
  const ban = useCallback((userId: string) => sockRef.current?.emit("ban", { tableId, userId }), [tableId]);
  const rebuy = useCallback(() => sockRef.current?.emit("rebuy", { tableId }), [tableId]);
  const forfeitTournament = useCallback(() => sockRef.current?.emit("forfeit_tournament", { tableId }), [tableId]);
  const chat = useCallback((text: string) => sockRef.current?.emit("chat", { tableId, text }), [tableId]);
  const clearError = useCallback(() => setError(null), []);
  const clearTopupResult = useCallback(() => setTopupResult(null), []);

  return { state, tourney, connected, error, clearError, topupResult, clearTopupResult, sit, leaveSeat, act, topup, showCards, sitOut, setReady, requestExtraTime, kick, ban, rebuy, forfeitTournament, chat };
}
