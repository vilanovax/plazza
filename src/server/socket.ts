/**
 * Socket.IO wiring. Every connection is authenticated from the session cookie
 * in the handshake; unauthenticated sockets are rejected. Clients send intents
 * (sit/leave/action/topup) and receive personalised `state` broadcasts.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import { sessionFromCookieHeader } from "../lib/auth";
import { InvalidActionError } from "../lib/poker/engine";
import type { PlayerAction } from "../lib/poker/types";
import { gameManager } from "./gameManager";
import { tournamentManager } from "./tournamentManager";
import * as repo from "../lib/repo";
import { rateLimit } from "../lib/rateLimit";
import { claim, recordResult, releaseClaim } from "../lib/idempotency";

interface SocketData {
  userId: string;
  username: string;
  role: "admin" | "player";
  tableId?: string;
  tournamentId?: string;
}

function fail(socket: Socket, err: unknown) {
  const message = err instanceof InvalidActionError ? err.message : "خطای سرور";
  if (!(err instanceof InvalidActionError)) console.error("socket error:", err);
  socket.emit("action_error", { message });
}

export function registerSocketHandlers(io: SocketIOServer): void {
  gameManager.setIo(io);
  tournamentManager.init();
  // Rebuild live tournament state (timers, blinds, dealing) after a restart.
  void tournamentManager.resumeRunning();

  // Authenticate the handshake.
  io.use(async (socket, nextFn) => {
    const session = await sessionFromCookieHeader(socket.handshake.headers.cookie);
    if (!session) return nextFn(new Error("unauthorized"));
    const data = socket.data as SocketData;
    data.userId = session.sub;
    data.username = session.username;
    data.role = session.role;
    nextFn();
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;

    socket.on("join", async ({ tableId, invite }: { tableId: string; invite?: string }) => {
      try {
        // Private tables are invite-only: verify the code BEFORE joining the
        // room or touching the current table, so an unauthorized attempt can't
        // see state or disturb the table the socket is already on.
        const row = await repo.getTable(tableId);
        if (!row || row.status !== "open") throw new InvalidActionError("میز یافت نشد");
        if (row.is_private && data.role !== "admin" && (!row.invite_code || invite !== row.invite_code)) {
          throw new InvalidActionError("این میز خصوصی است؛ برای ورود به لینک دعوت نیاز دارید");
        }
        if (data.tableId && data.tableId !== tableId) {
          gameManager.unregisterSocket(data.tableId, socket);
          void socket.leave(`table:${data.tableId}`);
        }
        await gameManager.ensureLoaded(tableId);
        data.tableId = tableId;
        socket.join(`table:${tableId}`);
        gameManager.registerSocket(tableId, socket);
        gameManager.setConnected(tableId, data.userId, true);
        await gameManager.refreshProfile(tableId, data.userId);
        await tournamentManager.pushTableUpdateToSocket(tableId, socket);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("join_tournament", async ({ tournamentId }: { tournamentId: string }) => {
      try {
        if (data.tournamentId && data.tournamentId !== tournamentId) {
          tournamentManager.unregisterTournamentSocket(data.tournamentId, socket);
          void socket.leave(`tournament:${data.tournamentId}`);
        }
        const t = await repo.getTournament(tournamentId);
        if (!t) throw new InvalidActionError("تورنومنت یافت نشد");
        data.tournamentId = tournamentId;
        socket.join(`tournament:${tournamentId}`);
        tournamentManager.registerTournamentSocket(tournamentId, socket);
        await tournamentManager.pushDetailToSocket(tournamentId, socket);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("sit", async ({ tableId, seatIndex, buyIn }: { tableId: string; seatIndex: number; buyIn: number }) => {
      try {
        // Must have joined this table first (which enforces the private-table
        // invite check) before taking a seat.
        if (data.tableId !== tableId) throw new InvalidActionError("ابتدا به میز بپیوندید");
        await gameManager.sit(tableId, data.userId, seatIndex, Math.floor(buyIn));
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("leave_seat", async ({ tableId }: { tableId: string }) => {
      try {
        await gameManager.leave(tableId, data.userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("action", async ({ tableId, action }: { tableId: string; action: PlayerAction }) => {
      try {
        await gameManager.act(tableId, data.userId, action);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("show_cards", async ({ tableId }: { tableId: string }) => {
      try {
        await gameManager.showCards(tableId, data.userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("sit_out", async ({ tableId, out }: { tableId: string; out: boolean }) => {
      try {
        await gameManager.sitOut(tableId, data.userId, out === true);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("extra_time", async ({ tableId }: { tableId: string }) => {
      try {
        await gameManager.requestExtraTime(tableId, data.userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    // Admin-only: remove a player from the table (verified by expected userId).
    socket.on("kick", async ({ tableId, seatIndex, userId }: { tableId: string; seatIndex: number; userId: string }) => {
      try {
        await gameManager.kick(tableId, data.role, seatIndex, userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("rebuy", async ({ tableId }: { tableId: string }) => {
      try {
        await tournamentManager.rebuyByTable(tableId, data.userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("forfeit_tournament", async ({ tableId }: { tableId: string }) => {
      try {
        await tournamentManager.forfeitByTable(tableId, data.userId);
      } catch (err) {
        fail(socket, err);
      }
    });

    // Top-up: applied immediately if self-top-up is enabled, else queued for admin.
    socket.on("topup", async ({ tableId, amount, requestId }: { tableId: string; amount: number; requestId?: string }) => {
      // Set once we've claimed the idempotency key, so a failure below can
      // release it and let a genuine retry (same requestId) through.
      let claimKey: string | null = null;
      try {
        const amt = Math.floor(amount);
        if (amt <= 0) throw new InvalidActionError("مبلغ نامعتبر است");
        // Per-user throttle FIRST: bounds how fast a user can hit this handler
        // regardless of amount/requestId (both client-controlled), so neither
        // the rate-limit map nor the idempotency map can be flooded.
        const userGate = rateLimit(`topup:${data.userId}`, 5, 10_000);
        if (!userGate.ok) throw new InvalidActionError("درخواست‌های زیاد؛ کمی صبر کنید");
        // True idempotency: the client sends a stable requestId per top-up
        // intent. The first delivery processes and caches its outcome; a retry
        // that arrives after completion gets the SAME authoritative result back;
        // a duplicate that races the original while it's still in flight is
        // dropped, because the original will emit the outcome. This removes the
        // duplicate-vs-original ack race entirely.
        type TopupOutcome = { status: "approved" | "pending"; amount: number };
        if (typeof requestId === "string" && requestId) {
          const key = `topup:${data.userId}:${requestId}`;
          const c = claim<TopupOutcome>(key, 60_000);
          if (c.state === "done") {
            socket.emit("topup_result", { ...c.result, requestId });
            return;
          }
          if (c.state === "in_flight") return; // the original delivery emits the result
          claimKey = key; // "new" — we own it
        }
        // Load the runtime ONCE up front and reuse it for both the tournament
        // guard and the seat lookup. Reading getRuntime() twice around an await
        // is a TOCTOU hole: an unloaded table skips the guard, then a concurrent
        // load makes the seat appear and the "queue for admin" branch (which has
        // no tournament check) would enqueue an illegal top-up.
        const rt = await gameManager.ensureLoaded(tableId);
        // Tournaments never take bank-funded top-ups (only rebuy).
        if (rt.isTournament) throw new InvalidActionError("در تورنومنت فقط ری‌بای ممکن است");
        const settings = await repo.getSettings();
        if (amt < settings.topup_min || amt > settings.topup_max) {
          throw new InvalidActionError(`مبلغ باید بین ${settings.topup_min} و ${settings.topup_max} باشد`);
        }
        const seat = rt.game.seats.find((s) => s.userId === data.userId);
        if (!seat) throw new InvalidActionError("شما سر این میز نیستید");
        let outcome: TopupOutcome;
        if (settings.allow_self_topup) {
          await gameManager.topUp(tableId, data.userId, amt);
          outcome = { status: "approved", amount: amt };
        } else {
          await repo.createTopup(data.userId, tableId, seat.seatIndex, amt);
          outcome = { status: "pending", amount: amt };
        }
        // Cache the authoritative outcome so a later retry reads it back.
        if (claimKey) recordResult(claimKey, outcome, 60_000);
        socket.emit("topup_result", { ...outcome, requestId });
      } catch (err) {
        // The top-up didn't apply — free the idempotency key so the user can
        // genuinely retry the same intent.
        if (claimKey) releaseClaim(claimKey);
        fail(socket, err);
      }
    });

    socket.on("chat", async (payload: { tableId?: string; text?: unknown } | null) => {
      try {
        const tableId = payload?.tableId;
        const text = payload?.text;
        if (typeof text !== "string") throw new InvalidActionError("پیام نامعتبر است");
        // Only players who have joined THIS table may post to its feed.
        if (!tableId || data.tableId !== tableId) throw new InvalidActionError("ابتدا به میز بپیوندید");
        // Throttle to keep the feed usable: 5 messages per 5 seconds per user.
        const gate = rateLimit(`chat:${data.userId}`, 5, 5000);
        if (!gate.ok) throw new InvalidActionError("پیام‌های زیاد؛ کمی صبر کنید");
        await gameManager.chat(tableId, data.userId, text);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("disconnect", () => {
      if (data.tournamentId) {
        tournamentManager.unregisterTournamentSocket(data.tournamentId, socket);
      }
      if (data.tableId) {
        gameManager.unregisterSocket(data.tableId, socket);
        gameManager.setConnected(data.tableId, data.userId, false);
        gameManager.broadcast(data.tableId);
      }
    });
  });
}
