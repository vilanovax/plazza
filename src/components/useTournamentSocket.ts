"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { TournamentDetail } from "@/lib/tournament/detail";

export interface TournamentSocket {
  detail: TournamentDetail | null;
  connected: boolean;
  error: string | null;
  clearError: () => void;
}

export function useTournamentSocket(tournamentId: string): TournamentSocket {
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);

    const socket = io({ path: "/api/socket", withCredentials: true, transports: ["websocket", "polling"] });
    sockRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_tournament", { tournamentId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) =>
      setError(e.message === "unauthorized" ? "احراز هویت ناموفق" : "اتصال برقرار نشد")
    );
    socket.on("tournament_detail", (d: TournamentDetail | null) => {
      if (d === null) setError("تورنومنت یافت نشد");
      else {
        setDetail(d);
        setError(null);
      }
    });
    socket.on("action_error", ({ message }: { message: string }) => setError(message));

    return () => {
      socket.disconnect();
      sockRef.current = null;
    };
  }, [tournamentId]);

  const clearError = useCallback(() => setError(null), []);

  return { detail, connected, error, clearError };
}
