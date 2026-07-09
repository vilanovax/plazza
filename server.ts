/**
 * Custom Next.js server with an attached Socket.IO instance.
 *
 * The poker engine is server-authoritative: all shuffling, card dealing and
 * action validation happen here, never in the browser. Clients only ever
 * receive the public game state plus their own hole cards. This is the
 * foundation of the anti-cheat model.
 */
import "./src/server/polyfill"; // must precede any Next import
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { registerSocketHandlers } from "./src/server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    path: "/api/socket",
    cors: { origin: false },
    // Keep transports lean; polling fallback stays available for restrictive networks.
    transports: ["websocket", "polling"],
  });

  registerSocketHandlers(io);

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Set PORT to a free port.`);
    } else {
      console.error("HTTP server error:", err);
    }
    process.exit(1);
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Poker PWA ready on http://${hostname}:${port} (dev=${dev})`);
  });

  // Graceful shutdown: stop accepting connections, close sockets, then exit.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down...`);
    io.close();
    httpServer.close(() => process.exit(0));
    // Hard stop if connections don't drain promptly.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
