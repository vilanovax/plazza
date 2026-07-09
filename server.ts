/**
 * Custom Next.js server with an attached Socket.IO instance.
 *
 * The poker engine is server-authoritative: all shuffling, card dealing and
 * action validation happen here, never in the browser. Clients only ever
 * receive the public game state plus their own hole cards. This is the
 * foundation of the anti-cheat model.
 */
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

  httpServer.listen(port, hostname, () => {
    // eslint-disable-next-line no-console
    console.log(`> Poker PWA ready on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal server error:", err);
  process.exit(1);
});
