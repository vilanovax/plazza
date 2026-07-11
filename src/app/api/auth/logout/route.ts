import { randomUUID } from "node:crypto";
import { handler, json } from "@/lib/api";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

export async function POST(req: Request) {
  return handler(async () => {
    const session = await getSession();
    await clearSessionCookie();
    if (session) {
      await repo.writeAudit({
        correlationId: randomUUID(), actorId: session.sub, action: "auth.logout",
        targetType: "user", targetId: session.sub, ip: clientIp(req),
      });
    }
    return json({ ok: true });
  });
}
