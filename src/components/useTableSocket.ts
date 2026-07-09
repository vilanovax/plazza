"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicGameState, PlayerAction } from "@/lib/poker/types";

export interface TableSocket {
  state: PublicGameState | null;
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
  chat: (text: string) => void;
}

export function useTableSocket(tableId: string): TableSocket {
  const [state, setState] = useState<PublicGameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ path: "/api/socket", withCredentials: true, transports: ["websocket", "polling"] });
    sockRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", { tableId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => setError(e.message === "unauthorized" ? "احراز هویت ناموفق" : "اتصال برقرار نشد"));
    socket.on("state", (s: PublicGameState) => setState(s));
    socket.on("action_error", ({ message }: { message: string }) => setError(message));

    return () => {
      socket.disconnect();
      sockRef.current = null;
    };
  }, [tableId]);

  const sit = useCallback((seatIndex: number, buyIn: number) => sockRef.current?.emit("sit", { tableId, seatIndex, buyIn }), [tableId]);
  const leaveSeat = useCallback(() => sockRef.current?.emit("leave_seat", { tableId }), [tableId]);
  const act = useCallback((action: PlayerAction) => sockRef.current?.emit("action", { tableId, action }), [tableId]);
  const topup = useCallback((amount: number) => sockRef.current?.emit("topup", { tableId, amount }), [tableId]);
  const showCards = useCallback(() => sockRef.current?.emit("show_cards", { tableId }), [tableId]);
  const sitOut = useCallback((out: boolean) => sockRef.current?.emit("sit_out", { tableId, out }), [tableId]);
  const requestExtraTime = useCallback(() => sockRef.current?.emit("extra_time", { tableId }), [tableId]);
  const kick = useCallback((seatIndex: number, userId: string) => sockRef.current?.emit("kick", { tableId, seatIndex, userId }), [tableId]);
  const rebuy = useCallback(() => sockRef.current?.emit("rebuy", { tableId }), [tableId]);
  const chat = useCallback((text: string) => sockRef.current?.emit("chat", { tableId, text }), [tableId]);
  const clearError = useCallback(() => setError(null), []);

  return { state, connected, error, clearError, sit, leaveSeat, act, topup, showCards, sitOut, requestExtraTime, kick, rebuy, chat };
}
