import { randomUUID } from "node:crypto";
import { handler, error, json } from "@/lib/api";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

export async function POST(req: Request) {
  return handler(async () => {
    const { username, password } = await req.json();
    if (!username || !password) return error("نام کاربری و رمز عبور لازم است");

    // Throttle brute-force / bcrypt-CPU abuse: 10 attempts / minute per IP+user.
    const ip = clientIp(req);
    const cid = randomUUID();
    const gate = rateLimit(`login:${ip}:${String(username).toLowerCase()}`, 10, 60_000);
    if (!gate.ok) return error(`تلاش‌های زیاد؛ ${gate.retryAfter} ثانیه بعد دوباره تلاش کنید`, 429);

    const failAudit = (reason: string, actorId?: string) =>
      repo.writeAudit({ correlationId: cid, actorId, action: "auth.login", targetType: "user",
        metadata: { result: "fail", reason, username: String(username) }, ip });

    const user = await repo.getUserByUsername(String(username));
    if (!user || !user.is_active) {
      await failAudit(user ? "inactive" : "no_user");
      return error("نام کاربری یا رمز عبور نادرست است", 401);
    }

    const hash = await repo.getPasswordHash(user.id);
    if (!hash || !(await verifyPassword(String(password), hash))) {
      await failAudit("bad_password", user.id);
      return error("نام کاربری یا رمز عبور نادرست است", 401);
    }
    await setSessionCookie({ sub: user.id, username: user.username, role: user.role });
    await repo.writeAudit({ correlationId: cid, actorId: user.id, action: "auth.login", targetType: "user",
      targetId: user.id, metadata: { result: "success" }, ip });
    return json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  });
}
