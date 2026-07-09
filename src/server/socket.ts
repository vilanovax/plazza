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
import * as repo from "../lib/repo";

interface SocketData {
  userId: string;
  username: string;
  role: "admin" | "player";
  tableId?: string;
}

function fail(socket: Socket, err: unknown) {
  const message = err instanceof InvalidActionError ? err.message : "خطای سرور";
  if (!(err instanceof InvalidActionError)) console.error("socket error:", err);
  socket.emit("action_error", { message });
}

export function registerSocketHandlers(io: SocketIOServer): void {
  gameManager.setIo(io);

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

    socket.on("join", async ({ tableId }: { tableId: string }) => {
      try {
        await gameManager.ensureLoaded(tableId);
        data.tableId = tableId;
        socket.join(`table:${tableId}`);
        gameManager.setConnected(tableId, data.userId, true);
        await gameManager.broadcast(tableId);
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("sit", async ({ tableId, seatIndex, buyIn }: { tableId: string; seatIndex: number; buyIn: number }) => {
      try {
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

    // Top-up: applied immediately if self-top-up is enabled, else queued for admin.
    socket.on("topup", async ({ tableId, amount }: { tableId: string; amount: number }) => {
      try {
        const amt = Math.floor(amount);
        if (amt <= 0) throw new InvalidActionError("مبلغ نامعتبر است");
        const settings = await repo.getSettings();
        if (amt < settings.topup_min || amt > settings.topup_max) {
          throw new InvalidActionError(`مبلغ باید بین ${settings.topup_min} و ${settings.topup_max} باشد`);
        }
        const seat = gameManager.getRuntime(tableId)?.game.seats.find((s) => s.userId === data.userId);
        if (settings.allow_self_topup) {
          await gameManager.topUp(tableId, data.userId, amt);
          socket.emit("topup_result", { status: "approved", amount: amt });
        } else {
          await repo.createTopup(data.userId, tableId, seat?.seatIndex ?? null, amt);
          socket.emit("topup_result", { status: "pending", amount: amt });
        }
      } catch (err) {
        fail(socket, err);
      }
    });

    socket.on("disconnect", () => {
      if (data.tableId) {
        gameManager.setConnected(data.tableId, data.userId, false);
        void gameManager.broadcast(data.tableId);
      }
    });
  });
}
