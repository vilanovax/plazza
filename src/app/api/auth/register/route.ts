import { randomUUID } from "node:crypto";
import { handler, error, json } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

export async function POST(req: Request) {
  return handler(async () => {
    const { username, password, displayName } = await req.json();
    if (!username || !password) return error("نام کاربری و رمز عبور لازم است");
    if (String(password).length < 6) return error("رمز عبور باید حداقل ۶ کاراکتر باشد");

    // Throttle mass account creation: 10 registrations/hour per IP. Generous
    // enough for a group of friends behind one NAT, tight enough to stop a
    // scripted flood of throwaway accounts.
    const ip = clientIp(req);
    const gate = rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
    if (!gate.ok) return error(`تلاش‌های زیاد؛ ${gate.retryAfter} ثانیه بعد دوباره تلاش کنید`, 429);

    const settings = await repo.getSettings();
    if (!settings.allow_self_register) return error("ثبت‌نام خودکار غیرفعال است؛ با مدیر تماس بگیرید", 403);

    if (await repo.getUserByUsername(username)) return error("این نام کاربری قبلاً ثبت شده است", 409);

    const hash = await hashPassword(String(password));
    const user = await repo.createUser(String(username), hash, String(displayName || username), "player");
    await setSessionCookie({ sub: user.id, username: user.username, role: user.role });
    await repo.writeAudit({ correlationId: randomUUID(), actorId: user.id, action: "auth.register",
      targetType: "user", targetId: user.id, metadata: { username: user.username }, ip });
    return json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  });
}
